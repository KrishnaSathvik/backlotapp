import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../db/schema.ts';
import { channels, contentItems, ideas, slatePreferences } from '../../db/schema.ts';
import { deletePreference, listPreferenceRecords, savePreference, updatePreferenceValue } from './preferences-db.ts';
import { createDbSlateStore, likePattern } from './store-db.ts';
import { executeTool, TOOL_LIMITS } from './tools.ts';

/**
 * Runs Slate's real Drizzle SQL against an in-process Postgres (PGlite), with the
 * schema created by drizzle-kit's push (same as `npm run db:push`).
 */

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const client = new PGlite();
const db = drizzle(client, { schema });
const store = createDbSlateStore(db);
let mainId = 0;
let designId = 0;
let bobChannelId = 0;

before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const silence = console.log;
  console.log = () => {};
  try {
    const { apply } = await pushSchema(schema, db as never);
    await apply();
  } finally {
    console.log = silence;
  }
  [{ id: mainId }] = await db.insert(channels).values({ userUid: ALICE, name: 'Main Studio', handle: '@mainstudio' }).returning();
  [{ id: designId }] = await db.insert(channels).values({ userUid: ALICE, name: 'Design Feed', handle: '' }).returning();
  [{ id: bobChannelId }] = await db.insert(channels).values({ userUid: BOB, name: 'Bob Cooks', handle: '' }).returning();
  await db.insert(contentItems).values([
    { userUid: ALICE, title: 'Tokyo After Dark — Night Walk', channelId: mainId, channelName: 'Main Studio', status: 'editing', caption: '45 minutes of neon and rain in Shibuya.', tags: ['tokyo', 'nightwalk'], targetDate: '2026-11-22' },
    { userUid: ALICE, title: 'Podcast Setup', channelId: mainId, channelName: 'Main Studio', status: 'idea', targetDate: '2026-12-02', caption: '100% honest mic review' },
    { userUid: ALICE, title: 'Golden Ridge', channelId: designId, channelName: 'Design Feed', status: 'posted', postDate: '2026-11-12', caption: 'Sunrise in Tokyo hills' },
    { userUid: ALICE, title: 'Legacy row without channel id', channelId: null, channelName: 'Design Feed', status: 'ready', targetDate: '2026-11-20' },
    { userUid: BOB, title: 'Tokyo ramen secrets', channelId: bobChannelId, channelName: 'Bob Cooks', caption: 'BOB-PRIVATE tokyo' },
  ]);
  await db.insert(ideas).values([
    { userUid: ALICE, title: 'AI agents explained', notes: 'For creators', channelName: 'Main Studio' },
    { userUid: ALICE, title: 'Agents vs assistants', notes: 'Comparison', convertedItemId: 2 },
    { userUid: BOB, title: 'Bob agents', notes: 'BOB-PRIVATE' },
  ]);
});

after(async () => {
  await client.close();
});

test('SQL search: finds own posts, ranks title matches first, never returns another user', async () => {
  const rows = await store.searchPosts(ALICE, { terms: ['tokyo'], limit: 10 });
  assert.deepEqual(rows.map((r) => r.title), ['Tokyo After Dark — Night Walk', 'Golden Ridge']);
  const bob = await store.searchPosts(BOB, { terms: ['tokyo'], limit: 10 });
  assert.deepEqual(bob.map((r) => r.title), ['Tokyo ramen secrets']);
});

test('SQL search: LIKE wildcards in user text are literal', async () => {
  assert.equal(likePattern('100%_\\'), '%100\\%\\_\\\\%');
  const literal = await store.searchPosts(ALICE, { terms: ['100%'], limit: 10 });
  assert.deepEqual(literal.map((r) => r.title), ['Podcast Setup']);
  const wildcardOnly = await store.searchPosts(ALICE, { terms: ['%'], limit: 10 });
  assert.deepEqual(wildcardOnly.map((r) => r.title), ['Podcast Setup'], '"%" matches only a literal percent sign');
});

test('SQL search: channel filter covers id and legacy name-only rows; stage filter applies', async () => {
  const design = await store.searchPosts(ALICE, { terms: ['legacy', 'golden'], channel: { id: designId, name: 'Design Feed', handle: '' }, limit: 10 });
  assert.deepEqual(design.map((r) => r.title).sort(), ['Golden Ridge', 'Legacy row without channel id']);
  const posted = await store.searchPosts(ALICE, { terms: ['tokyo'], status: 'posted', limit: 10 });
  assert.deepEqual(posted.map((r) => r.title), ['Golden Ridge']);
});

test('SQL ideas: open vs converted, scoped to the user', async () => {
  const open = await store.searchIdeas(ALICE, { terms: ['agents'], converted: false, limit: 10 });
  assert.deepEqual(open.map((i) => i.title), ['AI agents explained']);
  const converted = await store.searchIdeas(ALICE, { terms: ['agents'], converted: true, limit: 10 });
  assert.deepEqual(converted.map((i) => i.title), ['Agents vs assistants']);
});

test('SQL upcoming: soonest real date first, undated last, posted excluded; counts per channel', async () => {
  const up = await store.listPosts(ALICE, { order: 'upcoming', limit: 10 });
  assert.deepEqual(up.map((p) => p.targetDate), ['2026-11-20', '2026-11-22', '2026-12-02']);
  const counts = await store.channelPostCounts(ALICE, await store.listChannels(ALICE));
  assert.equal(counts.get(mainId), 2);
  assert.equal(counts.get(designId), 2, 'includes the legacy name-only row');
});

test("SQL tools end to end: another user's ids and channels are not found", async () => {
  const ctx = { uid: ALICE, store, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } };
  const [bobPost] = await store.searchPosts(BOB, { terms: ['ramen'], limit: 1 });
  const foreign = await executeTool('get_post_details', { post_id: bobPost.id }, ctx);
  const missing = await executeTool('get_post_details', { post_id: 999999 }, ctx);
  assert.equal(foreign.output, missing.output);
  const chan = await executeTool('search_posts', { query: 'tokyo', channel_id: bobChannelId }, ctx);
  assert.match(chan.output, /not_found/);
});

test('preferences: save, upsert by scope, channel override, update, delete, ownership', async () => {
  const g = await savePreference(db, ALICE, { key: 'emoji_usage', value: 'None', channelId: null, source: 'user' });
  assert.ok(g.ok && g.value.value === 'none');
  const again = await savePreference(db, ALICE, { key: 'emoji_usage', value: 'minimal', channelId: null, source: 'slate_confirmed' });
  assert.ok(again.ok && g.ok && again.value.id === g.value.id, 'same scope + key replaces, not duplicates');
  const ch = await savePreference(db, ALICE, { key: 'emoji_usage', value: 'lots', channelId: mainId, source: 'user' });
  assert.ok(ch.ok);
  assert.equal((await listPreferenceRecords(db, ALICE)).length, 2);

  // Another user's channel can't be targeted.
  const foreignChannel = await savePreference(db, ALICE, { key: 'tone', value: 'calm', channelId: bobChannelId, source: 'user' });
  assert.deepEqual(foreignChannel, { ok: false, status: 404, error: 'That channel isn’t in your Backlot.' });

  // Invalid values never reach the database.
  const invalid = await savePreference(db, ALICE, { key: 'emoji_usage', value: 'tons', channelId: null, source: 'user' });
  assert.equal(invalid.ok, false);

  // Bob can't see, update or delete Alice's preference.
  assert.ok(ch.ok);
  if (!ch.ok) return;
  assert.equal((await listPreferenceRecords(db, BOB)).length, 0);
  assert.equal((await updatePreferenceValue(db, BOB, ch.value.id, 'none')).ok, false);
  assert.equal((await deletePreference(db, BOB, ch.value.id)).ok, false);

  // The store sees what tools will use, and channel overrides global.
  const ctx = { uid: ALICE, store, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } };
  const forMain = JSON.parse((await executeTool('get_creator_preferences', { channel_id: mainId }, ctx)).output);
  assert.deepEqual(forMain.preferences, [{ key: 'emoji_usage', value: 'lots', applies: 'this channel' }]);
  const global = JSON.parse((await executeTool('get_creator_preferences', {}, ctx)).output);
  assert.deepEqual(global.preferences, [{ key: 'emoji_usage', value: 'minimal', applies: 'all channels' }]);

  const upd = await updatePreferenceValue(db, ALICE, ch.value.id, 'none');
  assert.ok(upd.ok && upd.value.value === 'none' && upd.value.source === 'user');
  assert.equal((await deletePreference(db, ALICE, ch.value.id)).ok, true);
  assert.equal((await listPreferenceRecords(db, ALICE)).length, 1);
});

test('the unique index rejects a duplicate scope + key written directly', async () => {
  await db.insert(slatePreferences).values({ userUid: 'uid-x', channelId: null, key: 'tone', value: 'calm' });
  await assert.rejects(db.insert(slatePreferences).values({ userUid: 'uid-x', channelId: null, key: 'tone', value: 'bold' }));
});
