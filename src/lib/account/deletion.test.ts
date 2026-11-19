import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.ts';
import {
  accountDeletions,
  channels,
  contentItems,
  ideas,
  slateActionEvents,
  slateActions,
  slateConversations,
  slateEmbeddings,
  slateMessages,
  slatePreferences,
  slateUsageLeases,
  users,
} from '../../db/schema.ts';
import { createLocalStore } from '../storage/local.ts';
import type { MediaStore } from '../storage/types.ts';
import { cleanupUploads, receiveChunk, type UploadPolicy } from '../storage/uploads.ts';
import { cleanupSlateData } from '../slate/cleanup.ts';
import { isAccountLockedError } from '../../db/account-guard.ts';
import {
  claimDueDeletion,
  deletionByStatusToken,
  deletionFor,
  hashStatusToken,
  processDueDeletions,
  purgeDeletionRecords,
  remainingData,
  requestAccountDeletion,
  runDeletion,
  statusView,
  type IdentityProvider,
} from './deletion.ts';

/** L2: account deletion job. Real SQL (PGlite), local store on a temp dir, fake Firebase. */

const client = new PGlite();
const db = drizzle(client, { schema });
let root = '';
let store: MediaStore;

before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const log = console.log;
  console.log = () => {};
  try {
    await (await pushSchema(schema, db as never)).apply();
    // The write guard (trigger) isn't part of db:push: apply the real migration file.
    await client.exec(await fsp.readFile(new URL('../../db/migrations/2026-11-23_account_deletions.sql', import.meta.url), 'utf8'));
  } finally {
    console.log = log;
  }
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'backlot-deletion-'));
  store = createLocalStore(root);
});
after(async () => {
  await client.close();
  await fsp.rm(root, { recursive: true, force: true });
});

class FakeIdentity implements IdentityProvider {
  users = new Set<string>();
  revoked: string[] = [];
  deleteFailures = 0;
  constructor(...uids: string[]) {
    uids.forEach((u) => this.users.add(u));
  }
  async revokeSessions(uid: string) {
    this.revoked.push(uid);
  }
  async deleteUser(uid: string) {
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw Object.assign(new Error('firebase down'), { code: 'auth/internal-error' });
    }
    this.users.delete(uid);
  }
  async exists(uid: string) {
    return this.users.has(uid);
  }
}

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...Array(300).fill(7)]);
const policy: UploadPolicy = { quotaBytes: 10_000_000, maxActive: 3, sessionTtlMs: 3_600_000 };
const T0 = new Date('2026-11-23T10:00:00Z');
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const silent = async <T>(fn: () => Promise<T>) => {
  const [w, e, i, l] = [console.warn, console.error, console.info, console.log];
  console.warn = console.error = console.info = console.log = () => {};
  try {
    return await fn();
  } finally {
    [console.warn, console.error, console.info, console.log] = [w, e, i, l];
  }
};

/** A creator with something in every table: channel, post, idea, files, uploads, Slate data. */
async function seed(uid: string) {
  await db.insert(users).values({ uid, email: `${uid}@example.com` });
  const [ch] = await db.insert(channels).values({ userUid: uid, name: 'Main', handle: '@main' }).returning();
  const up = (id: string, chunk: Uint8Array, total: number) =>
    receiveChunk(db, store, uid, { uploadId: id, offset: 0, totalSize: total, fileName: 'cover.png', mimeType: 'image/png', chunk }, policy, T0);
  const done = await up(`${uid}-cover`, PNG, PNG.length);
  assert.ok('asset' in done.body);
  const cover = done.body.asset;
  // An unfinished upload (half the bytes).
  assert.equal((await up(`${uid}-half`, PNG.subarray(0, 100), PNG.length)).status, 200);
  const [post] = await db
    .insert(contentItems)
    .values({ userUid: uid, title: 'Night walk', channelId: ch.id, channelName: 'Main', caption: 'secret caption', tags: ['tokyo'], notes: 'notes', coverAsset: cover })
    .returning();
  const [idea] = await db.insert(ideas).values({ userUid: uid, title: 'Idea', notes: 'idea notes', screenshotUrl: cover.url }).returning();
  await db.insert(contentItems).values({ userUid: uid, title: 'Adapted', repurposedFromPostId: post.id, sourceIdeaId: idea.id });
  const [conv] = await db
    .insert(slateConversations)
    .values({ publicId: `${uid}-c1`, userUid: uid, summary: 'condensed notes about earlier turns', summarizedThrough: 2, createdAt: T0, lastMessageAt: T0 })
    .returning();
  await db.insert(slateMessages).values([
    { conversationId: conv.id, userUid: uid, seq: 1, role: 'user', text: 'hello', createdAt: T0 },
    { conversationId: conv.id, userUid: uid, seq: 2, role: 'model', text: 'hi', createdAt: T0 },
  ]);
  await db.insert(slatePreferences).values({ userUid: uid, key: 'tone', value: 'dry' });
  await db.insert(slateEmbeddings).values({ userUid: uid, targetType: 'post', targetId: post.id, model: 'm', contentHash: 'h', vector: [0.1, 0.2], updatedAt: T0 });
  const [action] = await db
    .insert(slateActions)
    .values({ publicId: `${uid}-a1`, userUid: uid, kind: 'post_update', targetType: 'post', targetId: post.id, payload: { changes: { caption: 'x' } }, expiresAt: at(60 * 24) })
    .returning();
  await db.insert(slateActionEvents).values({ actionId: action.id, userUid: uid, event: 'proposed' });
  await db.insert(slateUsageLeases).values({ userUid: uid, startedAt: T0, expiresAt: at(3) });
  return { cover };
}

test('AD1. full deletion removes every record, file and the sign-in; other accounts are untouched', async () => {
  const identity = new FakeIdentity('u-alice', 'u-bob');
  const { cover } = await seed('u-alice');
  const bob = await seed('u-bob');
  assert.ok(await store.stat(cover.id), 'alice cover stored');
  const before = Object.keys(await remainingData(db, 'u-alice'));
  assert.equal(before.length, 13, `seeded every table: ${before}`);

  const job = await requestAccountDeletion(db, 'u-alice', { now: T0 });
  assert.equal(job.created, true);
  assert.equal(job.row.status, 'pending');
  assert.ok((await deletionFor(db, 'u-alice')) !== null, 'locked immediately');
  const again = await requestAccountDeletion(db, 'u-alice', { now: at(1) });
  assert.equal(again.created, false);
  assert.equal(again.row.id, job.row.id, 'repeat request returns the same job');
  assert.equal(await deletionByStatusToken(db, job.statusToken, { now: at(1) }), null, 'the older link is retired');

  // Grace period: nothing runs yet.
  assert.equal(await claimDueDeletion(db, at(1)), null);
  const result = await silent(() => processDueDeletions({ db, store, identity, now: () => at(4) }));
  assert.deepEqual(result, { completed: 1, retrying: 0 });

  assert.deepEqual(await remainingData(db, 'u-alice'), {}, 'no rows left for alice');
  assert.equal(await store.stat(cover.id), null, 'alice files deleted from storage');
  assert.equal(identity.users.has('u-alice'), false, 'sign-in deleted');
  assert.ok(identity.revoked.includes('u-alice'));

  assert.equal(Object.keys(await remainingData(db, 'u-bob')).length, 13, 'bob untouched');
  assert.ok(await store.stat(bob.cover.id), 'bob file untouched');
  assert.ok(identity.users.has('u-bob'));

  const done = (await deletionByStatusToken(db, again.statusToken, { now: at(5) }))!;
  assert.equal(done.status, 'completed');
  const view = statusView(done, 7);
  assert.equal(view.state, 'completed');
  assert.ok(view.contentRemoved && view.filesDeleted && view.signInRemoved && view.completedAt);
  assert.equal(view.storagePurgeBy, '2026-12-01', 'soft-delete window shown (rounded up to a day)');
  assert.deepEqual(Object.keys(view).sort(), ['completedAt', 'contentRemoved', 'delayed', 'filesDeleted', 'requestedAt', 'signInRemoved', 'state', 'storagePurgeBy']);
  const json = JSON.stringify(view);
  assert.ok(!json.includes('u-alice') && !json.includes(done.statusTokenHash), 'no uid or hash');
});

test('AD2. a failing step retries with backoff, never reports completion early, and resumes where it stopped', async () => {
  const identity = new FakeIdentity('u-carol');
  await seed('u-carol');
  identity.deleteFailures = 2;
  const job = await requestAccountDeletion(db, 'u-carol', { now: T0, graceMs: 0 });

  let run = await silent(() => processDueDeletions({ db, store, identity, now: () => T0 }));
  assert.deepEqual(run, { completed: 0, retrying: 1 });
  let row = (await deletionFor(db, 'u-carol'))!;
  assert.equal(row.status, 'running', 'not completed');
  assert.equal(row.lastError, 'delete_sign_in:auth/internal-error', 'error code only');
  assert.ok(row.steps.delete_workspace && row.steps.delete_files && !row.steps.delete_sign_in);
  assert.equal(statusView(row, 7).state, 'in_progress');
  assert.equal(row.nextAttemptAt.getTime(), at(1).getTime(), 'first retry after 1 minute');
  const firstFilesDone = row.steps.delete_files;

  // Not due yet.
  assert.deepEqual(await silent(() => processDueDeletions({ db, store, identity, now: () => at(0.5) })), { completed: 0, retrying: 0 });
  run = await silent(() => processDueDeletions({ db, store, identity, now: () => at(1) }));
  assert.deepEqual(run, { completed: 0, retrying: 1 });
  row = (await deletionFor(db, 'u-carol'))!;
  assert.equal(row.nextAttemptAt.getTime(), at(1 + 5).getTime(), 'second retry after 5 more minutes');

  run = await silent(() => processDueDeletions({ db, store, identity, now: () => at(6) }));
  assert.deepEqual(run, { completed: 1, retrying: 0 });
  row = (await deletionFor(db, 'u-carol'))!;
  assert.equal(row.status, 'completed');
  assert.equal(row.attempts, 3);
  assert.equal(row.steps.delete_files, firstFilesDone, 'finished steps are not redone');
  assert.equal(row.id, job.row.id);
});

test('AD3. a write that lands after its step ran is caught by the final check and removed', async () => {
  const identity = new FakeIdentity('u-dave');
  await seed('u-dave');
  await requestAccountDeletion(db, 'u-dave', { now: T0, graceMs: 0 });
  const job = (await claimDueDeletion(db, T0))!;

  // A Slate reply that was already in flight writes a message after delete_slate ran. The write
  // guard would refuse it (AD7); here it's off for that one write, as on a database without the
  // trigger, to show the final check still catches it.
  const lateStore: MediaStore = {
    ...store,
    async delete(key) {
      await store.delete(key);
      await client.exec('alter table slate_messages disable trigger backlot_account_guard');
      try {
        await db.insert(slateMessages).values({ conversationId: 999, userUid: 'u-dave', seq: 9, role: 'model', text: 'late', createdAt: T0 }).onConflictDoNothing();
      } finally {
        await client.exec('alter table slate_messages enable trigger backlot_account_guard');
      }
    },
  };
  const first = await silent(() => runDeletion({ db, store: lateStore, identity, now: () => T0 }, job));
  assert.equal(first.completed, false);
  assert.match(first.error!, /^verify:data remains: slate_messages=1/);
  let row = (await deletionFor(db, 'u-dave'))!;
  assert.ok(!row.steps.delete_slate, 'sent back to the step that clears it');
  assert.equal(row.status, 'running');

  const second = await silent(() => processDueDeletions({ db, store, identity, now: () => at(2) }));
  assert.deepEqual(second, { completed: 1, retrying: 0 });
  assert.deepEqual(await remainingData(db, 'u-dave'), {});
  row = (await deletionFor(db, 'u-dave'))!;
  assert.equal(row.status, 'completed');
});

test('AD4. two workers never run the same job; a crashed worker’s lease expires and the job continues', async () => {
  const identity = new FakeIdentity('u-erin');
  await seed('u-erin');
  await requestAccountDeletion(db, 'u-erin', { now: T0, graceMs: 0 });
  const [a, b] = await Promise.all([claimDueDeletion(db, T0), claimDueDeletion(db, T0)]);
  assert.equal([a, b].filter(Boolean).length, 1, 'only one claim succeeds');
  // That worker "crashes" (never finishes). Before the lease ends, nobody else can take it.
  assert.equal(await claimDueDeletion(db, at(5)), null);
  const later = await claimDueDeletion(db, at(11));
  assert.ok(later, 'lease expired: job is claimable again');
  const r = await silent(() => runDeletion({ db, store, identity, now: () => at(11) }, later!));
  assert.equal(r.completed, true);
});

test('AD5. completed records are kept for the record period, then purged; in-progress ones never are', async () => {
  await requestAccountDeletion(db, 'u-frank', { now: T0 });
  const [completedBefore] = await db.select().from(accountDeletions).where(eq(accountDeletions.userUid, 'u-alice'));
  assert.equal(completedBefore.status, 'completed');
  assert.equal(await purgeDeletionRecords(db, { now: at(60 * 24 * 29), recordDays: 30 }), 0);
  const purged = await purgeDeletionRecords(db, { now: at(60 * 24 * 365), recordDays: 30 });
  assert.ok(purged >= 4);
  assert.ok(await deletionFor(db, 'u-frank'), 'pending job kept');
  assert.equal(await deletionFor(db, 'u-alice'), null);
});

test('AD6. status tokens: only the hash is stored, malformed tokens are refused, and links expire with the record', async () => {
  const { row, statusToken } = await requestAccountDeletion(db, 'u-gina', { now: T0, graceMs: 0 });
  assert.match(statusToken, /^[A-Za-z0-9_-]{43}$/, '256-bit base64url token');
  assert.equal(row.statusTokenHash, hashStatusToken(statusToken));
  const [stored] = await db.select().from(accountDeletions).where(eq(accountDeletions.userUid, 'u-gina'));
  assert.ok(!JSON.stringify(stored).includes(statusToken), 'token itself is not stored');
  assert.equal((await deletionByStatusToken(db, statusToken))?.id, row.id);

  assert.equal(await deletionByStatusToken(db, "x' or 1=1 --"), null);
  assert.equal(await deletionByStatusToken(db, 'short'), null);
  assert.equal(await deletionByStatusToken(db, row.statusTokenHash), null, 'the hash is not a token');
  assert.equal(await deletionByStatusToken(db, String(row.id)), null, 'the job id is not a token');
  assert.equal(await deletionByStatusToken(db, 'u-gina'), null, 'the uid is not a token');

  await silent(() => processDueDeletions({ db, store, identity: new FakeIdentity(), now: () => T0 }));
  assert.ok(await deletionByStatusToken(db, statusToken, { now: at(60 * 24 * 29), recordDays: 30 }), 'works during the record period');
  assert.equal(await deletionByStatusToken(db, statusToken, { now: at(60 * 24 * 31), recordDays: 30 }), null, 'expired after it, even before the purge');
});

test('AD7. the write guard refuses inserts and updates for a locked account on every path, but not deletes or other accounts', async () => {
  await seed('u-hal');
  await seed('u-ivy');
  const [post] = await db.select().from(contentItems).where(eq(contentItems.userUid, 'u-hal')).limit(1);
  await requestAccountDeletion(db, 'u-hal', { now: T0 });

  const refused = async (what: string, fn: () => Promise<unknown>) => {
    await assert.rejects(fn, (err: unknown) => isAccountLockedError(err), `${what} refused`);
  };
  await refused('profile upsert', () => db.insert(users).values({ uid: 'u-hal', email: 'x' }).onConflictDoNothing());
  await refused('post edit', () => db.update(contentItems).set({ title: 'changed' }).where(eq(contentItems.id, post.id)));
  await refused('new idea', () => db.insert(ideas).values({ userUid: 'u-hal', title: 'late idea' }));
  await refused('late Slate message', () => db.insert(slateMessages).values({ conversationId: 1, userUid: 'u-hal', seq: 50, role: 'model', text: 'late', createdAt: T0 }));
  await refused('suggested change', () =>
    db.insert(slateActions).values({ publicId: 'late-a', userUid: 'u-hal', kind: 'post_update', targetType: 'post', targetId: post.id, payload: {}, expiresAt: at(60) })
  );
  await refused('search index', () => db.insert(slateEmbeddings).values({ userUid: 'u-hal', targetType: 'idea', targetId: 999, model: 'm', contentHash: 'h', vector: [0], updatedAt: T0 }));
  await refused('usage lease', () => db.insert(slateUsageLeases).values({ userUid: 'u-hal', startedAt: T0, expiresAt: at(3) }));
  // Upload finalization: the last chunk of the unfinished upload can't create a file row.
  const PNG_REST = PNG.subarray(100);
  await refused('upload finalization', () =>
    receiveChunk(db, store, 'u-hal', { uploadId: 'u-hal-half', offset: 100, totalSize: PNG.length, fileName: 'cover.png', mimeType: 'image/png', chunk: PNG_REST }, policy, T0)
  );

  // Other accounts keep working, and deletes are allowed (that's how the job removes data).
  await db.update(contentItems).set({ title: 'still fine' }).where(eq(contentItems.userUid, 'u-ivy'));
  await db.delete(slatePreferences).where(eq(slatePreferences.userUid, 'u-hal'));

  // Daily maintenance still runs with a locked account present (it leaves that account to the job).
  await db.update(slateActions).set({ expiresAt: at(-1) }).where(eq(slateActions.userUid, 'u-ivy'));
  await client.exec("alter table slate_actions disable trigger backlot_account_guard; update slate_actions set expires_at = '2026-11-23T09:00:00' where user_uid = 'u-hal'; alter table slate_actions enable trigger backlot_account_guard;");
  const cleaned = await cleanupSlateData(db, { now: T0 });
  assert.equal(cleaned.expired, 1, 'only the unlocked account’s action expired');
  await db.update(slateUsageLeases).set({ releasedAt: T0 }).where(eq(slateUsageLeases.userUid, 'u-ivy'));
  const uploads = await cleanupUploads(db, store, at(60 * 24));
  assert.ok(uploads.aborted >= 1, 'the unlocked account’s abandoned upload is cleaned');

  // And the job still deletes everything.
  await silent(() => processDueDeletions({ db, store, identity: new FakeIdentity('u-hal'), now: () => at(60 * 24) }));
  assert.deepEqual(await remainingData(db, 'u-hal'), {});
  assert.equal((await deletionFor(db, 'u-hal'))!.status, 'completed');
});

test('AD8. the write guard allows foreign-key cascades and a transaction-scoped operator bypass, and nothing else', async () => {
  await seed('u-jo');
  const [source] = await db.select().from(contentItems).where(eq(contentItems.userUid, 'u-jo')).limit(1);
  const [adapted] = await db
    .insert(contentItems)
    .values({ userUid: 'u-jo', title: 'adapted', platform: source.platform, repurposedFromPostId: source.id })
    .returning();
  await requestAccountDeletion(db, 'u-jo', { now: T0 });

  // Deleting the source post sets the adapted post's link to null: an UPDATE made by the
  // foreign-key action, part of the delete. It must not be refused.
  await db.delete(contentItems).where(eq(contentItems.id, source.id));
  const [after] = await db.select().from(contentItems).where(eq(contentItems.id, adapted.id));
  assert.equal(after.repurposedFromPostId, null);

  // Operators can lift the guard for one transaction (migrations, restores); it ends with it.
  await client.exec(`begin; set local backlot.account_guard = 'off'; update content_items set title = 'backfilled' where id = ${adapted.id}; commit;`);
  const [backfilled] = await db.select().from(contentItems).where(eq(contentItems.id, adapted.id));
  assert.equal(backfilled.title, 'backfilled');
  await assert.rejects(
    () => db.update(contentItems).set({ title: 'app write' }).where(eq(contentItems.id, adapted.id)),
    (err: unknown) => isAccountLockedError(err),
    'outside that transaction the guard is back'
  );
});
