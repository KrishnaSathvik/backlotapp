import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.ts';
import { contentItems, slateEmbeddings } from '../../db/schema.ts';
import { createSemanticIndex, fuse, type Embedder } from './semantic.ts';
import { correctTypos, editDistance, searchTerms, tsQueryText } from './search.ts';
import { runBenchmark, seedBench } from './search-bench.ts';
import { createDbSlateStore } from './store-db.ts';
import { executeTool, TOOL_LIMITS } from './tools.ts';

/** M5.1: text search quality, typo handling and the embeddings index (fake embedder, real SQL). */

const client = new PGlite();
const db = drizzle(client, { schema });
const store = createDbSlateStore(db);
before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const log = console.log;
  console.log = () => {};
  try {
    await (await pushSchema(schema, db as never)).apply();
  } finally {
    console.log = log;
  }
});
after(() => client.close());

/** Deterministic toy embedder: words hashed into 32 dims, so shared words mean similar vectors. */
function fakeEmbedder(calls: string[][] = []): Embedder {
  return async (texts) => {
    calls.push(texts);
    return texts.map((t) => {
      const v = new Array(32).fill(0);
      for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 32;
        v[h] += 1;
      }
      return v;
    });
  };
}

test('S1. text search benchmark stays at or above its measured floor (no network)', async () => {
  const seeded = await seedBench(db, 'bench-uid');
  const r = await runBenchmark(store, 'bench-uid', seeded, { method: 'text' });
  // Measured 87.2% / 0.842 at M5.1; typos and word forms must stay perfect.
  assert.ok(r.recallAt5 >= 0.87, `Recall@5 ${r.recallAt5}`);
  assert.ok(r.mrr >= 0.84, `MRR ${r.mrr}`);
  assert.equal(r.byKind.typo.recallAt5, 1);
  assert.equal(r.byKind.inflection.recallAt5, 1);
  assert.equal(r.byKind.filter.recallAt5, 1);
});

test('S2. query terms, full-text query text and typo correction', () => {
  assert.deepEqual(searchTerms('the video about my Colour grading'), ['color', 'grading']);
  assert.deepEqual(searchTerms('the one'), ['the', 'one'], 'all-filler queries keep their words');
  assert.equal(tsQueryText(['walking', "it's", 'pour-over']), 'walking:* | its:* | pourover:*');
  assert.equal(editDistance('podcats', 'podcast'), 1, 'transposition counts once');
  const vocab = ['tokyo', 'espresso', 'podcast', 'iceland', 'typography', 'latte', 'trick'];
  assert.deepEqual(correctTypos(['tokio', 'expresso', 'lattte'], vocab).terms, ['tokyo', 'espresso', 'latte']);
  assert.deepEqual(correctTypos(['tax'], vocab).corrected, {}, 'short words are never "corrected"');
  assert.deepEqual(correctTypos(['typo'], vocab).corrected, {}, 'a prefix of a known word is left alone');
});

test('S3. embeddings: created once, re-embedded only when text changes, removed with the record', async () => {
  const uid = 'sem-alice';
  const [a] = await db.insert(contentItems).values({ userUid: uid, title: 'Rainy window ambience', caption: 'rain on glass for sleep', tags: ['rain'] }).returning();
  const [b] = await db.insert(contentItems).values({ userUid: uid, title: 'Espresso tamping', caption: 'even pressure', tags: ['coffee'] }).returning();
  const calls: string[][] = [];
  const idx = createSemanticIndex(db, { embed: fakeEmbedder(calls), minSimilarity: 0.1 });
  const hits = await idx.searchPosts(uid, 'rain sleep sounds', {}, 5);
  assert.equal(hits?.[0].id, a.id);
  assert.equal(calls[0].length, 2, 'both posts embedded on first use');
  await idx.searchPosts(uid, 'coffee', {}, 5);
  assert.equal(calls[2].length, 1, 'second search embeds only the query');
  await db.update(contentItems).set({ caption: 'brand new caption' }).where(eq(contentItems.id, b.id));
  await idx.searchPosts(uid, 'coffee', {}, 5);
  assert.deepEqual(calls[3].length, 1, 'only the changed post is re-embedded');
  await db.delete(contentItems).where(eq(contentItems.id, b.id));
  await idx.searchPosts(uid, 'coffee', {}, 5);
  const left = await db.select().from(slateEmbeddings).where(eq(slateEmbeddings.userUid, uid));
  assert.deepEqual(left.map((e) => e.targetId), [a.id], 'embedding of the deleted post was removed');
  await idx.forget(uid, 'post', [a.id]);
  assert.equal((await db.select().from(slateEmbeddings).where(eq(slateEmbeddings.userUid, uid))).length, 0);
});

test("S4. embeddings never cross users, and filters apply", async () => {
  const [mine] = await db.insert(contentItems).values({ userUid: 'sem-u1', title: 'Coffee latte art', status: 'ready' }).returning();
  await db.insert(contentItems).values({ userUid: 'sem-u2', title: 'Coffee latte art BOB-PRIVATE', status: 'ready' });
  const idx = createSemanticIndex(db, { embed: fakeEmbedder(), minSimilarity: 0.1 });
  const hits = await idx.searchPosts('sem-u1', 'coffee latte', {}, 10);
  assert.deepEqual(hits?.map((h) => h.id), [mine.id]);
  assert.deepEqual(await idx.searchPosts('sem-u1', 'coffee latte', { status: 'posted' }, 10), []);
  const rows = await db.select().from(slateEmbeddings).where(and(eq(slateEmbeddings.userUid, 'sem-u1')));
  assert.ok(rows.every((r) => r.userUid === 'sem-u1'));
});

test('S5. limits and fallback: over the corpus cap, without a key, or on errors, search is text only', async () => {
  await db.insert(contentItems).values([1, 2, 3].map((n) => ({ userUid: 'sem-big', title: `Post ${n}` })));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await createSemanticIndex(db, { embed: fakeEmbedder(), maxCorpus: 2 }).searchPosts('sem-big', 'post', {}, 5), null);
    assert.equal(await createSemanticIndex(db, {}).searchPosts('sem-big', 'post', {}, 5), null, 'no key: unavailable');
    const failing = createSemanticIndex(db, { embed: async () => Promise.reject(new Error('429')) });
    assert.equal(await failing.searchPosts('sem-big', 'post', {}, 5), null);
    // The tool still answers with text search and says so.
    const out = await executeTool('search_posts', { query: 'post' }, { uid: 'sem-big', store, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars }, semantic: failing });
    assert.equal(JSON.parse(out.output).match, 'keyword');
  } finally {
    console.warn = warn;
  }
});

test('S6. fusion ranks records found by both methods first', () => {
  assert.deepEqual(fuse([1, 2, 3], [3, 4], 3), [3, 1, 2]);
  assert.deepEqual(fuse([], [7, 8], 5), [7, 8]);
});
