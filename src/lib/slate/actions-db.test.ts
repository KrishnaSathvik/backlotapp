import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.ts';
import { channels, contentItems, ideas, slateActionEvents, slateActions } from '../../db/schema.ts';
import { convertIdeaVersioned, readExpectedVersion, updateIdeaVersioned, updatePostVersioned } from '../content-mutations.ts';
import { applyAction, dismissAction, getActions, persistDrafts } from './actions-db.ts';
import { ACTION_TTL_MS, type ActionDraft } from './actions.ts';
import { createDbSlateStore } from './store-db.ts';
import { executeTool, TOOL_LIMITS } from './tools.ts';

/**
 * Versioning and Slate's action executor against real SQL (PGlite, schema from drizzle push).
 * All data here is disposable test data.
 */

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const client = new PGlite();
const db = drizzle(client, { schema });
const store = createDbSlateStore(db);
let channelId = 0;

before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const log = console.log;
  console.log = () => {};
  try {
    await (await pushSchema(schema, db as never)).apply();
  } finally {
    console.log = log;
  }
  [{ id: channelId }] = await db.insert(channels).values({ userUid: ALICE, name: 'Main Studio', handle: '@main' }).returning();
});
after(() => client.close());

async function newPost(over: Partial<typeof contentItems.$inferInsert> = {}) {
  const [p] = await db.insert(contentItems).values({ userUid: ALICE, title: 'Tokyo After Dark', caption: 'Original caption', channelId, channelName: 'Main Studio', status: 'editing', targetDate: '2026-11-22', ...over }).returning();
  return p;
}
const getPost = async (id: number) => (await db.select().from(contentItems).where(eq(contentItems.id, id)))[0];
const events = async (actionPublicId: string) => {
  const [a] = await db.select().from(slateActions).where(eq(slateActions.publicId, actionPublicId));
  return (await db.select().from(slateActionEvents).where(eq(slateActionEvents.actionId, a.id)).orderBy(slateActionEvents.id)).map((e) => e.event);
};
const captionDraft = (p: { id: number; title: string; version: number; caption: string }, caption: string): ActionDraft => ({
  kind: 'post_update',
  target: { type: 'post', id: p.id, title: p.title },
  baseVersion: p.version,
  changes: { caption },
  before: { caption: p.caption },
  summary: 'Update caption',
  reason: '',
});

/** Runs a plain SQL script one statement at a time (comment lines dropped). */
async function runScript(pg: PGlite, text: string) {
  const body = text
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  for (const stmt of body.split(';').map((s) => s.trim()).filter(Boolean)) await pg.query(stmt);
}

/* ---------------- versioning (manual edits use the same code) ---------------- */

test('V1. new rows start at version 1; each real change adds 1; a no-op save does not', async () => {
  const p = await newPost();
  assert.equal(p.version, 1);
  const r1 = await updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Second' });
  assert.ok(r1.kind === 'updated' && r1.row.version === 2 && r1.row.caption === 'Second');
  const noop = await updatePostVersioned(db, ALICE, p.id, 2, { caption: 'Second', title: 'Tokyo After Dark' });
  assert.equal(noop.kind, 'unchanged');
  assert.equal((await getPost(p.id)).version, 2);
});

test('V2. a stale version is a conflict and never overwrites newer work', async () => {
  const p = await newPost();
  await updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Edited in tab A' });
  const stale = await updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Edited in tab B' });
  assert.equal(stale.kind, 'conflict');
  assert.ok(stale.kind === 'conflict' && stale.current.caption === 'Edited in tab A' && stale.current.version === 2);
  assert.equal((await getPost(p.id)).caption, 'Edited in tab A');
});

test('V3. two writers racing from the same version: exactly one wins', async () => {
  const p = await newPost();
  const results = await Promise.all([
    updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Writer 1' }),
    updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Writer 2' }),
  ]);
  assert.deepEqual(results.map((r) => r.kind).sort(), ['conflict', 'updated']);
  assert.equal((await getPost(p.id)).version, 2);
});

test("V4. another user's post is not found, never a conflict (no information leak)", async () => {
  const p = await newPost();
  assert.deepEqual(await updatePostVersioned(db, BOB, p.id, 1, { caption: 'x' }), { kind: 'not_found' });
  assert.deepEqual(await updatePostVersioned(db, BOB, p.id, 99, { caption: 'x' }), { kind: 'not_found' });
});

test('V5. expectedVersion is required (428); the rollout window is dated and expires by itself; bad values are 400', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.deepEqual(readExpectedVersion({}, {}, now), { ok: false, status: 428, error: 'Backlot was updated. Refresh the page to keep editing.', code: 'version_required' });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(readExpectedVersion({}, { BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL: '2026-11-27' }, now), { ok: true, version: null });
    assert.equal(readExpectedVersion({}, { BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL: '2026-11-19' }, now).ok, false, 'past date: off');
    assert.equal(readExpectedVersion({}, { BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL: '2027-06-01' }, now).ok, false, 'more than 30 days out: refused');
    assert.equal(readExpectedVersion({}, { BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL: 'true' }, now).ok, false, 'not a date: off');
    assert.equal(readExpectedVersion({}, { BACKLOT_ALLOW_UNVERSIONED_WRITES: 'true' }, now).ok, false, 'the old boolean flag does nothing');
  } finally {
    console.warn = warn;
  }
  assert.equal(readExpectedVersion({ expectedVersion: '2' }, {}).ok, false);
  assert.equal(readExpectedVersion({ expectedVersion: 0 }, {}).ok, false);
  assert.deepEqual(readExpectedVersion({ expectedVersion: 3 }, {}), { ok: true, version: 3 });
});

test('V6. ideas are versioned too; a stale idea edit is a conflict', async () => {
  const [i] = await db.insert(ideas).values({ userUid: ALICE, title: 'Idea v' }).returning();
  const ok = await updateIdeaVersioned(db, ALICE, i.id, 1, { notes: 'more' });
  assert.ok(ok.kind === 'updated' && ok.row.version === 2);
  assert.equal((await updateIdeaVersioned(db, ALICE, i.id, 1, { notes: 'stale' })).kind, 'conflict');
});

test('V7. idea conversion: transactional, keeps sourceIdeaId, idempotent, and version-checked', async () => {
  const [i] = await db.insert(ideas).values({ userUid: ALICE, title: 'Convert me', notes: 'n' }).returning();
  // A stale view of an unconverted idea is refused and creates nothing.
  await updateIdeaVersioned(db, ALICE, i.id, 1, { notes: 'edited' });
  const stale = await convertIdeaVersioned(db, ALICE, i.id, 1);
  assert.equal(stale.kind, 'conflict');
  assert.equal((await db.select().from(contentItems).where(eq(contentItems.sourceIdeaId, i.id))).length, 0);

  const first = await convertIdeaVersioned(db, ALICE, i.id, 2);
  assert.ok(first.kind === 'created');
  assert.equal(first.item.sourceIdeaId, i.id);
  assert.equal(first.idea.convertedItemId, first.item.id);
  assert.equal(first.idea.version, 3);
  // Already converted: the existing post comes back, whatever version the caller had.
  const again = await convertIdeaVersioned(db, ALICE, i.id, 1);
  assert.ok(again.kind === 'existing' && again.item.id === first.item.id);
  assert.equal((await db.select().from(contentItems).where(eq(contentItems.sourceIdeaId, i.id))).length, 1);
  assert.deepEqual(await convertIdeaVersioned(db, BOB, i.id, 3), { kind: 'not_found' });
});

/* ---------------- executor ---------------- */

test('A1. approve → applied once with a version bump; a repeat apply is idempotent', async () => {
  const p = await newPost();
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'Slate caption')]);
  assert.equal(action.status, 'pending');
  assert.equal((await getPost(p.id)).caption, 'Original caption', 'persisting a proposal changes nothing');

  const r = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(r.ok && r.item?.caption === 'Slate caption' && r.item.version === 2);
  assert.equal(r.ok && r.action.status, 'applied');
  const again = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(again.ok && again.alreadyApplied);
  assert.equal((await getPost(p.id)).version, 2, 'not applied twice');
  assert.deepEqual(await events(action.id), ['proposed', 'applied', 'already_applied']);
});

test('A2. the post changed after the proposal: 409, nothing overwritten, action marked out of date', async () => {
  const p = await newPost();
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'Slate caption')]);
  await updatePostVersioned(db, ALICE, p.id, 1, { caption: 'Creator edit' });
  const r = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(!r.ok && r.status === 409 && r.code === 'version_conflict');
  assert.equal((await getPost(p.id)).caption, 'Creator edit');
  assert.equal((await getActions(db, ALICE, [action.id]))[0].status, 'conflict');
  const retry = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(!retry.ok && retry.status === 409);
});

test("A3. another user can't see, apply or dismiss the action", async () => {
  const p = await newPost();
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'Slate caption')]);
  assert.deepEqual(await getActions(db, BOB, [action.id]), []);
  const r = await applyAction(db, BOB, action.id, undefined);
  assert.ok(!r.ok && r.status === 404);
  assert.ok(!(await dismissAction(db, BOB, action.id)).ok);
  assert.equal((await getPost(p.id)).caption, 'Original caption');
  assert.equal((await getActions(db, ALICE, [action.id]))[0].status, 'pending');
});

test('A4. expired and dismissed actions cannot be applied', async () => {
  const p = await newPost();
  const past = new Date(Date.now() - ACTION_TTL_MS - 60_000);
  const [old] = await persistDrafts(db, ALICE, [captionDraft(p, 'Old suggestion')], past);
  assert.equal((await getActions(db, ALICE, [old.id]))[0].status, 'expired');
  const r = await applyAction(db, ALICE, old.id, undefined);
  assert.ok(!r.ok && r.status === 410);

  const [d] = await persistDrafts(db, ALICE, [captionDraft(p, 'Another')]);
  assert.ok((await dismissAction(db, ALICE, d.id)).ok);
  const after = await applyAction(db, ALICE, d.id, undefined);
  assert.ok(!after.ok && after.code === 'dismissed');
  assert.equal((await getPost(p.id)).caption, 'Original caption');
});

test('A5. creator edits apply to proposed fields only; anything else is rejected and nothing changes', async () => {
  const p = await newPost();
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'Slate caption')]);
  for (const bad of [{ title: 'Sneaky' }, { caption: 'x'.repeat(5001) }, { targetId: 99 }, ['caption']]) {
    const r = await applyAction(db, ALICE, action.id, bad);
    assert.ok(!r.ok && r.status === 400, JSON.stringify(bad));
  }
  assert.equal((await getActions(db, ALICE, [action.id]))[0].status, 'pending');
  const ok = await applyAction(db, ALICE, action.id, { caption: 'My tweak of Slate’s caption' });
  assert.ok(ok.ok && ok.item?.caption === 'My tweak of Slate’s caption' && ok.item.title === 'Tokyo After Dark');
  assert.deepEqual(await events(action.id), ['proposed', 'edited', 'applied']);
});

test('A6. an error mid-apply rolls everything back; the action stays pending and can be retried', async () => {
  const p = await newPost();
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'Slate caption')]);
  const crash = () => {
    throw new Error('crash');
  };
  await assert.rejects(applyAction(db, ALICE, action.id, undefined, new Date(), { afterWrite: crash }));
  const after = await getPost(p.id);
  assert.deepEqual([after.caption, after.version], ['Original caption', 1]);
  assert.equal((await getActions(db, ALICE, [action.id]))[0].status, 'pending');
  assert.deepEqual(await events(action.id), ['proposed']);
  assert.ok((await applyAction(db, ALICE, action.id, undefined)).ok);
});

test('A7. stage and date actions use the same version check', async () => {
  const p = await newPost();
  const [stage, date] = await persistDrafts(db, ALICE, [
    { kind: 'stage_change', target: { type: 'post', id: p.id, title: p.title }, baseVersion: 1, changes: { status: 'ready' }, before: { status: 'editing' }, summary: 'Move to Ready', reason: '' },
    { kind: 'target_date', target: { type: 'post', id: p.id, title: p.title }, baseVersion: 1, changes: { targetDate: '2026-11-30' }, before: { targetDate: '2026-11-22' }, summary: 'Set date', reason: '' },
  ]);
  assert.ok((await applyAction(db, ALICE, stage.id, undefined)).ok);
  // Both were proposed at version 1; the first one moved the post to version 2.
  const second = await applyAction(db, ALICE, date.id, undefined);
  assert.ok(!second.ok && second.status === 409);
  const now = await getPost(p.id);
  assert.deepEqual([now.status, now.targetDate, now.version], ['ready', '2026-11-22', 2]);
});

test('A8. new drafts: created as Planned, channel re-checked at apply time', async () => {
  const [tmpChannel] = await db.insert(channels).values({ userUid: ALICE, name: 'Temp', handle: '' }).returning();
  const [action] = await persistDrafts(db, ALICE, [
    { kind: 'post_create', target: null, baseVersion: null, draft: { title: 'Shibuya BTS', platform: 'youtube_shorts', channelId: tmpChannel.id, channelName: 'Temp', caption: '', tags: ['bts'], notes: '', targetDate: '2026-12-01' }, summary: 'New draft', reason: '' },
  ]);
  await db.delete(channels).where(eq(channels.id, tmpChannel.id));
  const r = await applyAction(db, ALICE, action.id, { caption: 'Added before applying' });
  assert.ok(r.ok && r.item);
  assert.deepEqual([r.item!.status, r.item!.channelId, r.item!.caption, r.item!.version, r.item!.userUid], ['idea', null, 'Added before applying', 1, ALICE]);
  assert.equal(r.ok && r.action.resultPostId, r.item!.id);
});

test('A9. idea conversion action keeps sourceIdeaId and never duplicates a manual conversion', async () => {
  const [i] = await db.insert(ideas).values({ userUid: ALICE, title: 'AI agents explained' }).returning();
  const [action] = await persistDrafts(db, ALICE, [{ kind: 'idea_convert', target: { type: 'idea', id: i.id, title: i.title }, baseVersion: 1, summary: 'Turn into post', reason: '' }]);
  const manual = await convertIdeaVersioned(db, ALICE, i.id, 1);
  assert.ok(manual.kind === 'created');
  const r = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(r.ok && r.item?.id === manual.item.id, 'returns the post the creator already made');
  assert.equal((await db.select().from(contentItems).where(eq(contentItems.sourceIdeaId, i.id))).length, 1);
});

test('A10. batch: each change applies on its own; one stale post fails without affecting the others', async () => {
  const posts = [await newPost({ title: 'B1' }), await newPost({ title: 'B2' }), await newPost({ title: 'B3' })];
  const drafts = posts.map((p, n) => ({ ...captionDraft(p, `Batch ${n}`), batchKey: 'k' }));
  const actions = await persistDrafts(db, ALICE, drafts);
  assert.equal(new Set(actions.map((a) => a.batchId)).size, 1);
  await updatePostVersioned(db, ALICE, posts[1].id, 1, { caption: 'Edited meanwhile' });
  const results = [];
  for (const a of actions) results.push(await applyAction(db, ALICE, a.id, undefined));
  assert.deepEqual(results.map((r) => r.ok), [true, false, true]);
  assert.deepEqual((await Promise.all(posts.map((p) => getPost(p.id)))).map((p) => p.caption), ['Batch 0', 'Edited meanwhile', 'Batch 2']);
});

test('A11. the audit trail records ids, versions and outcomes, never content', async () => {
  const p = await newPost({ caption: 'PRIVATE-CAPTION-TEXT' });
  const [action] = await persistDrafts(db, ALICE, [captionDraft(p, 'PRIVATE-NEW-CAPTION')]);
  await applyAction(db, ALICE, action.id, { caption: 'PRIVATE-EDIT' });
  const [row] = await db.select().from(slateActions).where(eq(slateActions.publicId, action.id));
  const log = await db.select().from(slateActionEvents).where(and(eq(slateActionEvents.actionId, row.id), eq(slateActionEvents.userUid, ALICE)));
  assert.doesNotMatch(JSON.stringify(log), /PRIVATE/);
  const applied = log.find((e) => e.event === 'applied')!;
  assert.deepEqual([applied.detail.baseVersion, applied.detail.newVersion, applied.detail.fields], [1, 2, ['caption']]);
});

test('A12. end to end with real SQL: a model tool proposes, the creator applies', async () => {
  const p = await newPost({ title: 'Latte Art', status: 'ready' });
  const ctx = { uid: ALICE, store, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } };
  const outcome = await executeTool('propose_target_date', { post_id: p.id, target_date: '2026-11-26' }, ctx);
  assert.equal((await getPost(p.id)).targetDate, '2026-11-22', 'the tool wrote nothing');
  const [action] = await persistDrafts(db, ALICE, outcome.actions!);
  assert.equal(action.kind, 'target_date');
  const r = await applyAction(db, ALICE, action.id, undefined);
  assert.ok(r.ok);
  assert.deepEqual([(await getPost(p.id)).targetDate, (await getPost(p.id)).version], ['2026-11-26', 2]);
  // A foreign post id from the model never becomes an action.
  const [bobPost] = await db.insert(contentItems).values({ userUid: BOB, title: 'Bob' }).returning();
  const foreign = await executeTool('propose_target_date', { post_id: bobPost.id, target_date: '2026-11-26' }, ctx);
  assert.equal(foreign.actions, undefined);
});

/* ---------------- migration ---------------- */

test('M1. the SQL migration upgrades existing tables in place: rows become version 1; safe to re-run', async () => {
  const old = new PGlite();
  try {
    await runScript(old, `
      CREATE TABLE content_items (id serial PRIMARY KEY, user_uid text NOT NULL, title text NOT NULL);
      CREATE TABLE ideas (id serial PRIMARY KEY, user_uid text NOT NULL, title text NOT NULL);
      INSERT INTO content_items (user_uid, title) VALUES ('u', 'a'), ('u', 'b');
      INSERT INTO ideas (user_uid, title) VALUES ('u', 'i');
    `);
    const migration = readFileSync(new URL('../../db/migrations/2026-11-18_versions_and_slate_actions.sql', import.meta.url), 'utf8');
    await runScript(old, migration);
    await runScript(old, migration);
    const items = await old.query<{ version: number }>('SELECT version FROM content_items ORDER BY id');
    assert.deepEqual(items.rows.map((r) => r.version), [1, 1]);
    assert.equal((await old.query<{ version: number }>('SELECT version FROM ideas')).rows[0].version, 1);
    await old.query(`INSERT INTO content_items (user_uid, title) VALUES ('u', 'c')`);
    assert.equal((await old.query<{ version: number }>(`SELECT version FROM content_items WHERE title = 'c'`)).rows[0].version, 1);
    assert.equal((await old.query('SELECT 1 FROM slate_actions')).rows.length, 0);
  } finally {
    await old.close();
  }
});
