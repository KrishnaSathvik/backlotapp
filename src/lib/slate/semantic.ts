import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import OpenAI from 'openai';
import { contentItems, ideas, slateEmbeddings } from '../../db/schema.ts';
import type { ChannelRecord } from './types.ts';

/**
 * Meaning-based search with OpenAI embeddings stored in Postgres (no vector database).
 *
 * - Generated server-side; every read and write is scoped to the signed-in uid.
 * - Kept in sync lazily: before a search, any post or idea whose text changed is
 *   re-embedded (content hash), and embeddings of deleted records are removed. The delete
 *   routes also remove them immediately.
 * - Bounded: at most `maxCorpus` records per type per creator are compared in memory
 *   (256-dimension vectors, ~1 MB per 1,000 records), at most `maxEmbedPerSearch` new
 *   embeddings per search, and a short timeout. Above the cap, or on any error, search
 *   falls back to text only. Reassess (e.g. pgvector) before raising maxCorpus a lot.
 * - Claude has no embedding model, so when OpenAI is unavailable search is text only.
 */

type Db = PgDatabase<any, any>;
export type Embedder = (texts: string[], signal: AbortSignal) => Promise<number[][]>;

export interface SemanticOptions {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  maxCorpus?: number;
  maxEmbedPerSearch?: number;
  timeoutMs?: number;
  /** Minimum cosine similarity for a semantic match to count. */
  minSimilarity?: number;
  /** Tests inject a fake embedder. */
  embed?: Embedder;
}

export interface SemanticHit {
  id: number;
  similarity: number;
}

export interface PostFilter {
  channel?: ChannelRecord;
  status?: string;
  platform?: string;
}

export interface SemanticIndex {
  readonly model: string;
  searchPosts(uid: string, query: string, filter: PostFilter, limit: number): Promise<SemanticHit[] | null>;
  searchIdeas(uid: string, query: string, filter: { channel?: ChannelRecord; converted?: boolean }, limit: number): Promise<SemanticHit[] | null>;
  /** Removes stored embeddings for deleted records (also done lazily during search). */
  forget(uid: string, type: 'post' | 'idea', ids: number[]): Promise<void>;
}

export const SEMANTIC_DEFAULTS = {
  model: 'text-embedding-3-small',
  dimensions: 256,
  maxCorpus: 1000,
  maxEmbedPerSearch: 200,
  timeoutMs: 5000,
  minSimilarity: 0.35,
} as const;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const postText = (p: { title: string; tags: string[]; caption: string; notes: string }) => [p.title, p.tags.join(', '), p.caption, p.notes].filter(Boolean).join('\n').slice(0, 4000);
const ideaText = (i: { title: string; tags: string[]; notes: string; linkTitle: string }) => [i.title, i.tags.join(', '), i.notes, i.linkTitle].filter(Boolean).join('\n').slice(0, 4000);

export function createSemanticIndex(db: Db, opts: SemanticOptions = {}): SemanticIndex {
  const o = { ...SEMANTIC_DEFAULTS, ...opts };
  const client = o.apiKey ? new OpenAI({ apiKey: o.apiKey, maxRetries: 0 }) : null;
  const embed: Embedder | null =
    o.embed ??
    (client
      ? async (texts, signal) => {
          const res = await client.embeddings.create({ model: o.model, input: texts, dimensions: o.dimensions }, { signal });
          return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
        }
      : null);
  const hashOf = (text: string) => createHash('sha256').update(`${o.model}|${o.dimensions}|${text}`).digest('hex');

  /** Brings stored embeddings in line with the source rows; returns id → vector. */
  async function sync(uid: string, type: 'post' | 'idea', docs: { id: number; text: string }[], signal: AbortSignal) {
    const stored = await db
      .select({ id: slateEmbeddings.id, targetId: slateEmbeddings.targetId, hash: slateEmbeddings.contentHash, vector: slateEmbeddings.vector })
      .from(slateEmbeddings)
      .where(and(eq(slateEmbeddings.userUid, uid), eq(slateEmbeddings.targetType, type)));
    const byTarget = new Map(stored.map((s) => [s.targetId, s]));
    const live = new Set(docs.map((d) => d.id));
    const orphans = stored.filter((s) => !live.has(s.targetId)).map((s) => s.id);
    if (orphans.length) await db.delete(slateEmbeddings).where(and(eq(slateEmbeddings.userUid, uid), inArray(slateEmbeddings.id, orphans)));

    const vectors = new Map<number, number[]>();
    const stale: { id: number; text: string; hash: string }[] = [];
    for (const d of docs) {
      const hash = hashOf(d.text);
      const s = byTarget.get(d.id);
      if (s && s.hash === hash) vectors.set(d.id, s.vector);
      else stale.push({ id: d.id, text: d.text, hash });
    }
    const batch = stale.slice(0, o.maxEmbedPerSearch);
    for (let i = 0; i < batch.length; i += 100) {
      const chunk = batch.slice(i, i + 100);
      const out = await embed!(chunk.map((c) => c.text), signal);
      const now = new Date();
      for (const [j, c] of chunk.entries()) {
        vectors.set(c.id, out[j]);
        await db
          .insert(slateEmbeddings)
          .values({ userUid: uid, targetType: type, targetId: c.id, model: o.model, contentHash: c.hash, vector: out[j], updatedAt: now })
          .onConflictDoUpdate({ target: [slateEmbeddings.userUid, slateEmbeddings.targetType, slateEmbeddings.targetId], set: { model: o.model, contentHash: c.hash, vector: out[j], updatedAt: now } });
      }
    }
    return vectors;
  }

  async function rank(uid: string, type: 'post' | 'idea', query: string, docs: { id: number; text: string; keep: boolean }[], limit: number): Promise<SemanticHit[] | null> {
    if (!embed) return null;
    if (docs.length > o.maxCorpus) {
      console.warn(`slate semantic: corpus over ${o.maxCorpus} ${type}s; using text search only`);
      return null;
    }
    const signal = AbortSignal.timeout(o.timeoutMs);
    try {
      const vectors = await sync(uid, type, docs, signal);
      const [q] = await embed([query.slice(0, 500)], signal);
      return docs
        .filter((d) => d.keep && vectors.has(d.id))
        .map((d) => ({ id: d.id, similarity: cosine(q, vectors.get(d.id)!) }))
        .filter((h) => h.similarity >= o.minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (err) {
      console.warn(`slate semantic unavailable: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`);
      return null;
    }
  }

  return {
    model: o.model,
    async searchPosts(uid, query, f, limit) {
      const rows = await db.select().from(contentItems).where(eq(contentItems.userUid, uid)).limit(o.maxCorpus + 1);
      const inChannel = (r: (typeof rows)[number]) => !f.channel || r.channelId === f.channel.id || (r.channelId === null && r.channelName === f.channel.name);
      return rank(
        uid,
        'post',
        query,
        rows.map((r) => ({ id: r.id, text: postText(r), keep: inChannel(r) && (!f.status || r.status === f.status) && (!f.platform || r.platform === f.platform) })),
        limit
      );
    },
    async searchIdeas(uid, query, f, limit) {
      const rows = await db.select().from(ideas).where(eq(ideas.userUid, uid)).limit(o.maxCorpus + 1);
      return rank(
        uid,
        'idea',
        query,
        rows.map((r) => ({
          id: r.id,
          text: ideaText(r),
          keep: (!f.channel || r.channelName === f.channel.name) && (f.converted === undefined || (r.convertedItemId !== null) === f.converted),
        })),
        limit
      );
    },
    async forget(uid, type, ids) {
      if (!ids.length) return;
      await db.delete(slateEmbeddings).where(and(eq(slateEmbeddings.userUid, uid), eq(slateEmbeddings.targetType, type), inArray(slateEmbeddings.targetId, ids)));
    },
  };
}

/**
 * Reciprocal-rank fusion of text and semantic results (k = 60). Records found by both rank
 * highest; semantic-only matches still need the similarity threshold to appear at all.
 */
export function fuse(text: number[], semantic: number[], limit: number, k = 60): number[] {
  const score = new Map<number, number>();
  text.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  semantic.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([id]) => id);
}
