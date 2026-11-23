import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { channels, contentItems, ideas, slatePreferences } from '../../db/schema.ts';
import type { ChannelRecord, IdeaRecord, PostRecord, SlateStore } from './types.ts';
import { normalizeStatus } from '../content-logic.ts';
import { tsQueryText } from './search.ts';

/**
 * Postgres implementation of SlateStore (read-only). Every query is filtered by
 * user_uid and parameterized through Drizzle. Created from a db handle so tests
 * can run the same SQL against an in-process Postgres (PGlite).
 */

type Db = PgDatabase<any, any>;

type PostRow = typeof contentItems.$inferSelect;
type IdeaRow = typeof ideas.$inferSelect;

const info = (a: { name: string; mimeType: string; size: number } | null | undefined) => (a ? { name: a.name, type: a.mimeType, sizeKb: Math.round(a.size / 1024) } : null);

const toPost = (r: PostRow): PostRecord => ({
  id: r.id,
  title: r.title,
  platform: r.platform,
  channelId: r.channelId ?? null,
  channelName: r.channelName,
  status: normalizeStatus(r.status),
  caption: r.caption,
  tags: Array.isArray(r.tags) ? r.tags : [],
  notes: r.notes,
  postDate: r.postDate,
  targetDate: r.targetDate,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
  sourceIdeaId: r.sourceIdeaId ?? null,
  repurposedFromPostId: r.repurposedFromPostId ?? null,
  media: {
    cover: info(r.coverAsset),
    video: info(r.videoAsset),
    slides: (r.slides ?? []).map((s) => info(s)!),
    references: (r.attachedReferences ?? []).map((x) => ({ title: x.title, note: x.note, url: x.url })),
  },
});

const toIdea = (r: IdeaRow): IdeaRecord => ({
  id: r.id,
  title: r.title,
  platform: r.platform,
  channelName: r.channelName,
  notes: r.notes,
  linkUrl: r.linkUrl,
  linkDomain: r.linkDomain,
  tags: Array.isArray(r.tags) ? r.tags : [],
  targetDate: r.targetDate,
  convertedItemId: r.convertedItemId ?? null,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  hasScreenshot: !!r.screenshotUrl,
});

/** Posts belong to a channel by id, or by name for older rows without an id. */
function postInChannel(channel: ChannelRecord): SQL {
  return or(eq(contentItems.channelId, channel.id), and(isNull(contentItems.channelId), eq(contentItems.channelName, channel.name)))!;
}

/** `%term%` with LIKE wildcards in the user's text escaped (backslash is Postgres' default escape). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Full-text document for a post: title (A), tags (B), caption and notes (C), English
 * stemming. Computed per query over the creator's own rows; at Backlot's per-creator scale
 * (hundreds of posts) that is fast without an index. If libraries grow to many thousands,
 * add an expression GIN index on the same expression.
 */
const postDoc = sql`(setweight(to_tsvector('english', ${contentItems.title}), 'A') || setweight(to_tsvector('english', ${contentItems.tags}::text), 'B') || setweight(to_tsvector('english', ${contentItems.caption} || ' ' || ${contentItems.notes}), 'C'))`;
const ideaDoc = sql`(setweight(to_tsvector('english', ${ideas.title}), 'A') || setweight(to_tsvector('english', ${ideas.tags}::text), 'B') || setweight(to_tsvector('english', ${ideas.notes} || ' ' || ${ideas.linkTitle}), 'C'))`;

/** Text relevance: full-text rank (stemmed) plus weighted substring matches (for words inside tags like "nightwalk"). */
function textScore(doc: SQL, terms: string[], fields: { col: SQL; weight: number }[]): SQL<number> {
  const tsq = tsQueryText(terms);
  const fts = tsq ? sql`(ts_rank(${doc}, to_tsquery('english', ${tsq})) * 10)` : sql`(0::real)`;
  // Substring matching skips very short words (noise), unless there's nothing else to match on,
  // e.g. "100%" or "%", which are matched literally (wildcards escaped).
  const long = terms.filter((t) => t.length >= 3);
  const subs = long.length ? long : tsq ? [] : terms;
  return subs.length ? sql<number>`(${fts} + ${score(subs, fields)})` : sql<number>`${fts}`;
}

/** Weighted keyword score: sum over terms of weight × (field matches). Parameterized. */
function score(terms: string[], fields: { col: SQL; weight: number }[]): SQL<number> {
  const parts = terms.flatMap((t) => fields.map((f) => sql`(case when ${f.col} ilike ${likePattern(t)} then ${f.weight} else 0 end)`));
  return sql<number>`(${sql.join(parts, sql` + `)})`;
}

export function createDbSlateStore(db: Db): SlateStore {
  return {
    async getPost(uid, id) {
      const [row] = await db.select().from(contentItems).where(and(eq(contentItems.id, id), eq(contentItems.userUid, uid))).limit(1);
      return row ? toPost(row) : null;
    },

    async getIdea(uid, id) {
      const [row] = await db.select().from(ideas).where(and(eq(ideas.id, id), eq(ideas.userUid, uid))).limit(1);
      return row ? toIdea(row) : null;
    },

    async getChannel(uid, id) {
      const [row] = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.userUid, uid))).limit(1);
      return row ? { id: row.id, name: row.name, handle: row.handle } : null;
    },

    async listChannels(uid) {
      const rows = await db.select().from(channels).where(eq(channels.userUid, uid)).orderBy(asc(channels.name), asc(channels.id)).limit(50);
      return rows.map((r) => ({ id: r.id, name: r.name, handle: r.handle }));
    },

    async listPosts(uid, q) {
      const filters: SQL[] = [eq(contentItems.userUid, uid)];
      if (q.channel) filters.push(postInChannel(q.channel));
      if (q.excludeId !== undefined) filters.push(ne(contentItems.id, q.excludeId));
      if (q.order === 'upcoming') filters.push(ne(contentItems.status, 'posted'));
      const order =
        q.order === 'upcoming'
          ? [sql`case when ${contentItems.targetDate} = '' then 1 else 0 end`, asc(contentItems.targetDate), asc(contentItems.id)]
          : [desc(contentItems.updatedAt), desc(contentItems.id)];
      const rows = await db
        .select()
        .from(contentItems)
        .where(and(...filters))
        .orderBy(...order)
        .limit(Math.min(q.limit, 50));
      return rows.map(toPost);
    },

    async listIdeas(uid, q) {
      const filters: SQL[] = [eq(ideas.userUid, uid)];
      if (q.channel) filters.push(eq(ideas.channelName, q.channel.name));
      if (q.openOnly) filters.push(isNull(ideas.convertedItemId));
      const rows = await db
        .select()
        .from(ideas)
        .where(and(...filters))
        .orderBy(desc(ideas.createdAt), desc(ideas.id))
        .limit(Math.min(q.limit, 50));
      return rows.map(toIdea);
    },

    async countPostsByStatus(uid, channel) {
      const filters: SQL[] = [eq(contentItems.userUid, uid)];
      if (channel) filters.push(postInChannel(channel));
      const rows = await db
        .select({ status: contentItems.status, n: count() })
        .from(contentItems)
        .where(and(...filters))
        .groupBy(contentItems.status);
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    },

    async searchPosts(uid, q) {
      if (!q.terms.length) return [];
      // The channel name isn't scored: it matched every post in "Main Studio" for "studio".
      const s = textScore(postDoc, q.terms, [
        { col: sql`${contentItems.title}`, weight: 3 },
        { col: sql`${contentItems.tags}::text`, weight: 2 },
        { col: sql`${contentItems.caption}`, weight: 1 },
        { col: sql`${contentItems.notes}`, weight: 1 },
      ]);
      const filters: SQL[] = [eq(contentItems.userUid, uid), sql`${s} > 0`];
      if (q.channel) filters.push(postInChannel(q.channel));
      if (q.status === 'idea') filters.push(inArray(contentItems.status, ['idea', 'scripting', 'editing']));
      else if (q.status) filters.push(eq(contentItems.status, q.status));
      if (q.platform) filters.push(eq(contentItems.platform, q.platform));
      const rows = await db
        .select()
        .from(contentItems)
        .where(and(...filters))
        .orderBy(desc(s), desc(contentItems.updatedAt), desc(contentItems.id))
        .limit(Math.min(q.limit, 20));
      return rows.map(toPost);
    },

    async searchIdeas(uid, q) {
      if (!q.terms.length) return [];
      const s = textScore(ideaDoc, q.terms, [
        { col: sql`${ideas.title}`, weight: 3 },
        { col: sql`${ideas.tags}::text`, weight: 2 },
        { col: sql`${ideas.notes}`, weight: 1 },
        { col: sql`${ideas.linkTitle}`, weight: 1 },
        { col: sql`${ideas.linkDomain}`, weight: 1 },
      ]);
      const filters: SQL[] = [eq(ideas.userUid, uid), sql`${s} > 0`];
      if (q.channel) filters.push(eq(ideas.channelName, q.channel.name));
      if (q.converted === true) filters.push(isNotNull(ideas.convertedItemId));
      if (q.converted === false) filters.push(isNull(ideas.convertedItemId));
      const rows = await db
        .select()
        .from(ideas)
        .where(and(...filters))
        .orderBy(desc(s), desc(ideas.createdAt), desc(ideas.id))
        .limit(Math.min(q.limit, 20));
      return rows.map(toIdea);
    },

    async channelPostCounts(uid, list) {
      const rows = await db
        .select({ channelId: contentItems.channelId, channelName: contentItems.channelName, n: count() })
        .from(contentItems)
        .where(eq(contentItems.userUid, uid))
        .groupBy(contentItems.channelId, contentItems.channelName);
      const out = new Map<number, number>();
      for (const c of list) {
        const n = rows
          .filter((r) => r.channelId === c.id || (r.channelId === null && r.channelName === c.name))
          .reduce((sum, r) => sum + Number(r.n), 0);
        out.set(c.id, n);
      }
      return out;
    },

    async calendarPosts(uid, q) {
      const filters: SQL[] = [
        eq(contentItems.userUid, uid),
        or(ne(contentItems.status, 'posted'), and(ne(contentItems.postDate, ''), sql`${contentItems.postDate} >= ${q.postedSince}`))!,
      ];
      if (q.channel) filters.push(postInChannel(q.channel));
      const rows = await db
        .select()
        .from(contentItems)
        .where(and(...filters))
        .orderBy(asc(contentItems.id))
        .limit(300);
      return rows.map(toPost);
    },

    async snapshot(uid, q) {
      const postFilters: SQL[] = [eq(contentItems.userUid, uid)];
      if (q.channel) postFilters.push(postInChannel(q.channel));
      const ideaFilters: SQL[] = [eq(ideas.userUid, uid)];
      if (q.channel) ideaFilters.push(eq(ideas.channelName, q.channel.name));
      const [posts, ideaRows] = await Promise.all([
        db.select().from(contentItems).where(and(...postFilters)).orderBy(desc(contentItems.updatedAt), desc(contentItems.id)).limit(500),
        db.select().from(ideas).where(and(...ideaFilters)).orderBy(desc(ideas.createdAt), desc(ideas.id)).limit(300),
      ]);
      return { posts: posts.map(toPost), ideas: ideaRows.map(toIdea) };
    },

    async vocabulary(uid) {
      const rows = await db.execute(sql`
        select distinct w from (
          select regexp_split_to_table(lower(${contentItems.title} || ' ' || ${contentItems.tags}::text || ' ' || ${contentItems.caption} || ' ' || ${contentItems.notes}), '[^[:alnum:]]+') as w
          from ${contentItems} where ${contentItems.userUid} = ${uid}
          union all
          select regexp_split_to_table(lower(${ideas.title} || ' ' || ${ideas.tags}::text || ' ' || ${ideas.notes}), '[^[:alnum:]]+') as w
          from ${ideas} where ${ideas.userUid} = ${uid}
        ) words where length(w) >= 3 limit 5000`);
      const list = Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows;
      return (list as { w: string }[]).map((r) => r.w);
    },

    async listPreferences(uid) {
      const rows = await db
        .select()
        .from(slatePreferences)
        .where(eq(slatePreferences.userUid, uid))
        .orderBy(asc(slatePreferences.key), asc(slatePreferences.id))
        .limit(200);
      return rows.map((r) => ({ id: r.id, channelId: r.channelId ?? null, key: r.key, value: r.value, source: r.source, updatedAt: r.updatedAt.toISOString() }));
    },
  };
}
