import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import * as schema from '../../db/schema.ts';
import { contentItems, ideas, uploadedFiles } from '../../db/schema.ts';
import { applyAction, persistDrafts } from './actions-db.ts';
import { buildContinuity, topicsOf } from './continuity-insights.ts';
import { IMAGE_LIMITS, loadSlateImage, parseImageRequest } from './images.ts';
import { parseChatRequest } from './request.ts';
import { SharedUsageLimiter } from './shared-limits.ts';
import { createDbSlateStore } from './store-db.ts';
import { ALL_TOOL_DEFINITIONS, executeTool, TOOL_LIMITS } from './tools.ts';
import { ALICE, BOB, idea, MemoryStore, post } from './test-fixtures.ts';

/** Milestone 5: repurposing, creative continuity, images and their limits. */

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
const ctx = (uid: string, s = store) => ({ uid, store: s, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } });

/* ---------------- M5.2 repurposing ---------------- */

test('R1. propose_repurpose builds up to five reviewable drafts that keep their source, and saves nothing', async () => {
  const [src] = await db.insert(contentItems).values({ userUid: ALICE, title: 'Tokyo After Dark', caption: 'Neon and rain', status: 'posted' }).returning();
  const before = (await db.select().from(contentItems).where(eq(contentItems.userUid, ALICE))).length;
  const r = await executeTool(
    'propose_repurpose',
    {
      source_post_id: src.id,
      drafts: [
        { platform: 'youtube_shorts', title: 'Tokyo in 30 seconds', caption: 'Rain, neon, 2am.' },
        { platform: 'instagram_carousel', title: 'Tokyo after dark, 8 frames', notes: 'Slide 1: Shibuya crossing' },
      ],
    },
    ctx(ALICE)
  );
  assert.equal(r.ok, true);
  assert.equal(r.actions?.length, 2);
  assert.ok(r.actions!.every((d) => d.kind === 'post_create' && d.draft?.repurposedFromPostId === src.id && d.batchKey));
  assert.match(r.actions![0].summary, /Shorts draft adapted from “Tokyo After Dark”/);
  assert.equal((await db.select().from(contentItems).where(eq(contentItems.userUid, ALICE))).length, before, 'nothing saved by the tool');
});

test('R2. repurposing validates its source and drafts', async () => {
  const [bobPost] = await db.insert(contentItems).values({ userUid: BOB, title: 'Bob' }).returning();
  const bad: unknown[] = [
    { drafts: [{ platform: 'tiktok', title: 'x' }] },
    { source_post_id: 1, source_idea_id: 1, drafts: [{ platform: 'tiktok', title: 'x' }] },
    { source_post_id: bobPost.id, drafts: [{ platform: 'tiktok', title: 'x' }] },
    { source_post_id: 1, drafts: Array.from({ length: 6 }, () => ({ platform: 'tiktok', title: 'x' })) },
    { source_post_id: 1, drafts: [{ platform: 'myspace', title: 'x' }] },
    { source_post_id: 1, drafts: [{ platform: 'tiktok', title: 'x', status: 'posted' }] },
  ];
  for (const args of bad) assert.equal((await executeTool('propose_repurpose', args, ctx(ALICE))).ok, false, JSON.stringify(args));
  assert.match(ALL_TOOL_DEFINITIONS.find((t) => t.name === 'propose_repurpose')!.description, /suggestions, not rules/);
});

test('R3. applying keeps the link; a retried apply never duplicates; deleting the source keeps the draft', async () => {
  const [src] = await db.insert(contentItems).values({ userUid: ALICE, title: 'Source post' }).returning();
  const [i] = await db.insert(ideas).values({ userUid: ALICE, title: 'Source idea' }).returning();
  const fromPost = await executeTool('propose_repurpose', { source_post_id: src.id, drafts: [{ platform: 'tiktok', title: 'TikTok cut' }] }, ctx(ALICE));
  const fromIdea = await executeTool('propose_repurpose', { source_idea_id: i.id, drafts: [{ platform: 'instagram_reel', title: 'Reel cut' }] }, ctx(ALICE));
  const [a1] = await persistDrafts(db, ALICE, fromPost.actions!);
  const [a2] = await persistDrafts(db, ALICE, fromIdea.actions!);
  const r1 = await applyAction(db, ALICE, a1.id, undefined);
  const again = await applyAction(db, ALICE, a1.id, undefined);
  assert.ok(r1.ok && again.ok && again.alreadyApplied && again.item?.id === r1.item?.id);
  assert.equal((await db.select().from(contentItems).where(eq(contentItems.title, 'TikTok cut'))).length, 1);
  assert.equal(r1.ok && r1.item?.repurposedFromPostId, src.id);
  const r2 = await applyAction(db, ALICE, a2.id, undefined);
  assert.ok(r2.ok && r2.item?.sourceIdeaId === i.id && r2.item.repurposedFromPostId === null, 'an idea source uses sourceIdeaId');

  await db.delete(contentItems).where(eq(contentItems.id, src.id));
  const [draft] = await db.select().from(contentItems).where(eq(contentItems.id, r1.ok ? r1.item!.id : 0));
  assert.ok(draft, 'the adapted post survives');
  assert.equal(draft.repurposedFromPostId, null, 'ON DELETE SET NULL');
});

/* ---------------- M5.3 creative continuity ---------------- */

test('C1. continuity: recurring topics, series gaps, long-open ideas, stalled posts, related work — all from stored data', () => {
  const posts = [
    post(1, { title: 'Latte art basics', tags: ['coffee'], status: 'posted', postDate: '2026-09-01' }),
    post(2, { title: 'Espresso tamping', tags: ['coffee'], status: 'posted', postDate: '2026-09-15' }),
    post(3, { title: 'Pour over recipe', tags: ['coffee'], status: 'posted', postDate: '2026-10-13' }),
    post(4, { title: 'Cold brew', tags: ['coffee'], status: 'editing', updatedAt: '2026-10-01T10:00:00.000Z' }),
    post(5, { title: 'Desk tour', tags: ['setup'], status: 'scripting', updatedAt: '2026-11-15T10:00:00.000Z' }),
  ];
  const ideaList = [idea(10, { title: 'Hanoi coffee culture', tags: ['coffee'], createdAt: '2026-08-01T10:00:00.000Z' }), idea(11, { title: 'Font series', tags: ['typography'], createdAt: '2026-11-10T10:00:00.000Z' })];
  const { payload, refs } = buildContinuity(posts, ideaList, { today: '2026-11-17' });
  const coffee = payload.recurring_topics.find((t) => t.topic === 'coffee')!;
  assert.deepEqual([coffee.posted, coffee.in_progress, coffee.open_ideas, coffee.first_posted, coffee.last_posted], [3, 1, 1, '2026-09-01', '2026-10-13']);
  assert.deepEqual(payload.possible_series, [{ topic: 'coffee', posted: 3, average_gap_days: 21, days_since_last: 35 }]);
  assert.deepEqual(payload.long_open_ideas.items.map((i) => [i.ref, i.days_open]), [['idea:10', 108]]);
  assert.deepEqual(payload.stalled_posts.items.map((p) => [p.ref, p.days_unchanged]), [['post:4', 47]]);
  assert.ok(payload.related_unfinished_work.some((r) => r.topic === 'coffee' && r.unfinished.some((u) => u.ref === 'idea:10')));
  assert.match(payload.note, /no views, reach or engagement/);
  assert.ok(refs.includes('post:4') && refs.includes('idea:10'));
  assert.deepEqual(topicsOf('Five Font Pairings', ['#Typography']), ['typography', 'five', 'font', 'pairing']);
});

test('C2. get_creative_continuity is uid-scoped', async () => {
  const s = new MemoryStore()
    .addPost(ALICE, post(1, { title: 'Mine coffee', tags: ['coffee'] }))
    .addPost(BOB, post(2, { title: 'BOB-PRIVATE coffee', tags: ['coffee'] }));
  const r = await executeTool('get_creative_continuity', {}, { ...ctx(ALICE), store: s });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.output, /BOB-PRIVATE/);
  assert.equal(JSON.parse(r.output).based_on.posts, 1);
});

/* ---------------- M5.4 images ---------------- */

async function png(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#3355ff' } })
    .withExif({ IFD0: { Make: 'SecretCam', Copyright: 'GPS 37.7749,-122.4194' } })
    .jpeg()
    .toBuffer();
}

test('I1. image requests: only explicit, well-formed picks are accepted', () => {
  assert.equal(parseImageRequest(undefined), null);
  assert.deepEqual(parseImageRequest({ type: 'post', id: 3, slot: 'slide', index: 2 }), { type: 'post', id: 3, slot: 'slide', index: 2 });
  for (const bad of [{ type: 'post', id: 3, slot: 'screenshot' }, { type: 'idea', id: 1, slot: 'cover' }, { type: 'post', id: 3, slot: 'slide' }, { type: 'post', id: 3, slot: 'cover', url: '/api/files/x' }, { type: 'post', id: '3', slot: 'cover' }]) {
    assert.equal(parseImageRequest(bad), 'invalid', JSON.stringify(bad));
  }
  assert.throws(() => parseChatRequest({ message: 'hi', image: { type: 'post', id: 1, slot: 'cover', url: 'https://evil' } }), /Invalid image/);
  assert.equal(parseChatRequest({ message: 'hi', focus: { type: 'post', id: 1 } }).image, null, 'attaching a post sends no image');
});

test('I2. images: ownership checked, content decoded, downscaled, metadata stripped, inline only', async () => {
  const files = new Map<string, Buffer>();
  const read = async (key: string) => files.get(key) ?? Promise.reject(new Error('missing'));
  files.set('alice-cover.jpg', await png(3000, 2000));
  await db.insert(uploadedFiles).values({ userUid: ALICE, storageKey: 'alice-cover.jpg', fileName: 'c.jpg', mimeType: 'image/jpeg', sizeBytes: 1 });
  const cover = { id: 'c', name: 'c.jpg', url: '/api/files/alice-cover.jpg', mimeType: 'image/jpeg', size: 1 };
  const [p] = await db.insert(contentItems).values({ userUid: ALICE, title: 'With cover', coverAsset: cover }).returning();

  const ok = await loadSlateImage(db, ALICE, { type: 'post', id: p.id, slot: 'cover' }, read);
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.equal(ok.label, 'Cover of “With cover”');
  assert.ok(Math.max(ok.width, ok.height) <= IMAGE_LIMITS.maxSide);
  assert.equal(ok.part.image.mediaType, 'image/jpeg');
  assert.doesNotMatch(JSON.stringify(ok.part), /api\/files|https?:/, 'no URL is sent, only inline data');
  const meta = await sharp(Buffer.from(ok.part.image.data, 'base64')).metadata();
  assert.equal(meta.exif, undefined, 'camera and location metadata removed');

  // Another user can't use Alice's post, and Bob's post can't point at Alice's file.
  assert.equal((await loadSlateImage(db, BOB, { type: 'post', id: p.id, slot: 'cover' }, read)).ok, false);
  const [bobPost] = await db.insert(contentItems).values({ userUid: BOB, title: 'Borrowed', coverAsset: cover }).returning();
  const borrowed = await loadSlateImage(db, BOB, { type: 'post', id: bobPost.id, slot: 'cover' }, read);
  assert.deepEqual(borrowed, { ok: false, status: 404, error: 'That image isn’t available.' });

  // Not really an image.
  files.set('alice-fake.png', Buffer.from('<?php echo "not an image";'));
  await db.insert(uploadedFiles).values({ userUid: ALICE, storageKey: 'alice-fake.png', fileName: 'f.png', mimeType: 'image/png', sizeBytes: 1 });
  const [fake] = await db.insert(contentItems).values({ userUid: ALICE, title: 'Fake', coverAsset: { ...cover, url: '/api/files/alice-fake.png' } }).returning();
  assert.equal((await loadSlateImage(db, ALICE, { type: 'post', id: fake.id, slot: 'cover' }, read)).ok, false);

  // Too large on disk.
  const tooBig = async () => Promise.reject(Object.assign(new Error('big'), { code: 'TOO_LARGE' }));
  const big = await loadSlateImage(db, ALICE, { type: 'post', id: p.id, slot: 'cover' }, tooBig);
  assert.ok(!big.ok && big.status === 413);

  // A slide that doesn't exist.
  assert.equal((await loadSlateImage(db, ALICE, { type: 'post', id: p.id, slot: 'slide', index: 4 }, read)).ok, false);
});

test('I3. image messages have their own daily limit', async () => {
  let now = new Date('2026-11-17T10:00:00Z');
  const l = new SharedUsageLimiter(db, { maxRequests: 100, windowMs: 600_000, maxConcurrent: 5, maxImagesPerDay: 2, now: () => now });
  for (let i = 0; i < 2; i++) {
    const r = await l.acquire('img-user', 'image');
    assert.ok(r.ok);
    if (r.ok) await r.release();
  }
  const third = await l.acquire('img-user', 'image');
  assert.ok(!third.ok && third.reason === 'image_quota');
  assert.ok((await l.acquire('img-user', 'chat')).ok, 'plain chat still works');
  now = new Date('2026-11-18T10:01:00Z');
  assert.ok((await l.acquire('img-user', 'image')).ok, 'the limit resets after 24 hours');
});
