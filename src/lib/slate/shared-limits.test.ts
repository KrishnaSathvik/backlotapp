import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../db/schema.ts';
import { contentItems, slateActionEvents, slateActions, slateUsageLeases } from '../../db/schema.ts';
import { CircuitBreaker } from './breaker.ts';
import { dailyLimitFromEnv, FailClosedUsageLimiter, SharedBreakerState, SharedUsageLimiter } from './shared-limits.ts';
import { cleanupOptionsFromEnv, cleanupSlateData } from './cleanup.ts';
import { applyAction, persistDrafts } from './actions-db.ts';
import type { ActionDraft } from './actions.ts';

/**
 * Shared limits and cleanup. Logic runs on PGlite; true multi-connection behavior
 * (several app instances, row locks) runs on a real Postgres when TEST_DATABASE_URL is set.
 */

const client = new PGlite();
const db = drizzle(client, { schema });
const silent = async (fn: () => Promise<void>) => {
  const log = console.log;
  console.log = () => {};
  try {
    await fn();
  } finally {
    console.log = log;
  }
};
before(() => silent(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  await (await pushSchema(schema, db as never)).apply();
}));
after(() => client.close());

let clock = new Date('2026-11-17T12:00:00.000Z');
const now = () => clock;
const limits = { maxRequests: 3, windowMs: 600_000, maxConcurrent: 2, leaseTtlMs: 150_000, now };

test('L1. two instances share one concurrency limit and one quota', async () => {
  const a = new SharedUsageLimiter(db, limits);
  const b = new SharedUsageLimiter(db, limits);
  const r1 = await a.acquire('u1');
  const r2 = await b.acquire('u1');
  const r3 = await a.acquire('u1');
  assert.ok(r1.ok && r2.ok);
  assert.deepEqual(r3, { ok: false, reason: 'busy' }, 'the second instance saw the first one’s request');
  if (r1.ok) await r1.release();
  const r4 = await b.acquire('u1');
  assert.ok(r4.ok, 'a released slot is free on any instance');
  if (r2.ok) await r2.release();
  if (r4.ok) await r4.release();
  const r5 = await a.acquire('u1');
  assert.equal(r5.ok, false);
  assert.ok(!r5.ok && r5.reason === 'rate' && r5.retryAfterSec > 0 && r5.retryAfterSec <= 600, 'quota of 3 per window is shared');
  assert.ok((await a.acquire('u2')).ok, 'other users are unaffected');
});

test('L2. an abandoned request (never released) stops counting once its lease expires', async () => {
  const a = new SharedUsageLimiter(db, { ...limits, maxRequests: 100 });
  await a.acquire('crashy');
  await a.acquire('crashy');
  assert.deepEqual(await a.acquire('crashy'), { ok: false, reason: 'busy' });
  clock = new Date(clock.getTime() + 151_000);
  assert.ok((await a.acquire('crashy')).ok, 'expired leases no longer hold a slot');
});

test('L2b. the daily ceiling counts every message in a rolling 24 hours, across instances', async () => {
  const opts = { ...limits, maxRequests: 100, maxConcurrent: 100, maxRequestsPerDay: 3 };
  const a = new SharedUsageLimiter(db, opts);
  const b = new SharedUsageLimiter(db, opts);
  const start = clock;
  for (const l of [a, b, a]) {
    const r = await l.acquire('daily');
    assert.ok(r.ok);
    await r.release();
    clock = new Date(clock.getTime() + 60 * 60_000);
  }
  const refused = await b.acquire('daily', 'image');
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, 'daily_quota');
  assert.ok(!refused.ok && 'retryAfterSec' in refused && refused.retryAfterSec <= 21 * 3600, 'retry when the oldest message leaves the window');
  clock = new Date(start.getTime() + 24 * 3600_000 + 1000);
  assert.ok((await a.acquire('daily')).ok, 'the oldest one aged out');
  assert.equal(dailyLimitFromEnv({}), 200);
  assert.equal(dailyLimitFromEnv({ SLATE_DAILY_MESSAGE_LIMIT: '50' }), 50);
  assert.equal(dailyLimitFromEnv({ SLATE_DAILY_MESSAGE_LIMIT: '0' }), 200);
});

test('L3. release is idempotent and only releases its own lease', async () => {
  const a = new SharedUsageLimiter(db, { ...limits, maxRequests: 100 });
  const r1 = await a.acquire('rel');
  const r2 = await a.acquire('rel');
  assert.ok(r1.ok && r2.ok);
  if (!r1.ok || !r2.ok) return;
  await r1.release();
  await r1.release();
  const open = await db.select().from(slateUsageLeases).where(eq(slateUsageLeases.userUid, 'rel'));
  assert.equal(open.filter((l) => !l.releasedAt).length, 1);
});

test('L4. if the shared store is down, Slate fails closed instead of counting per instance', async () => {
  const broken = { transaction: async () => Promise.reject(new Error('connection refused')) } as never;
  const error = console.error;
  const lines: string[] = [];
  console.error = (m: string) => lines.push(m);
  try {
    const r = new FailClosedUsageLimiter(new SharedUsageLimiter(broken, limits));
    assert.deepEqual(await r.acquire('u'), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await r.acquire('u'), { ok: false, reason: 'unavailable' });
    assert.equal(lines.length, 1, 'logged once, not per request');
    const event = JSON.parse(lines[0]);
    assert.equal(event.event, 'slate.limits_unavailable');
    assert.equal(event.severity, 'ERROR');
    assert.ok(!lines[0].includes('connection refused'), 'error kind only, not the message');
  } finally {
    console.error = error;
  }
});

test('L5. breaker: failures from different instances add up, open the provider everywhere, success closes it', async () => {
  const sharedA = new SharedBreakerState(db, { now });
  const sharedB = new SharedBreakerState(db, { now });
  assert.equal(await sharedA.recordFailure('openai'), 'counted');
  assert.equal(await sharedB.recordFailure('openai'), 'counted');
  assert.equal(await sharedA.recordFailure('openai'), 'opened');
  const t = clock.getTime();
  const localC = new CircuitBreaker({ now: () => t });
  assert.equal(localC.state('openai'), 'closed');
  await sharedB.syncInto(localC, ['openai', 'anthropic']);
  assert.equal(localC.state('openai'), 'open', 'an instance that saw no failures adopts the shared state');
  assert.equal(localC.state('anthropic'), 'closed');
  await sharedB.recordSuccess('openai');
  const localD = new CircuitBreaker({ now: () => t });
  await sharedA.syncInto(localD, ['openai']);
  assert.equal(localD.state('openai'), 'closed');
});

test('L6. breaker: failures outside the window start a new count; store errors never throw', async () => {
  const s = new SharedBreakerState(db, { now });
  await s.recordFailure('anthropic');
  await s.recordFailure('anthropic');
  clock = new Date(clock.getTime() + 61_000);
  assert.equal(await s.recordFailure('anthropic'), 'counted');
  const broken = new SharedBreakerState({ transaction: async () => Promise.reject(new Error('down')), select: () => { throw new Error('down'); } } as never);
  assert.equal(await broken.recordFailure('openai'), 'unavailable');
  await broken.syncInto(new CircuitBreaker(), ['openai']);
});

/* ---------------- cleanup ---------------- */

const DAY = 86_400_000;
async function action(status: string, decidedDaysAgo: number | null, expiresInMs: number, base: Date) {
  const [p] = await db.insert(contentItems).values({ userUid: 'clean', title: `p-${status}` }).returning();
  const draft: ActionDraft = { kind: 'post_update', target: { type: 'post', id: p.id, title: p.title }, baseVersion: 1, changes: { caption: 'PRIVATE proposed' }, before: { caption: '' }, summary: 's', reason: '' };
  const [v] = await persistDrafts(db, 'clean', [draft], new Date(base.getTime() + expiresInMs - 86_400_000));
  await db
    .update(slateActions)
    .set({ status, decidedAt: decidedDaysAgo === null ? null : new Date(base.getTime() - decidedDaysAgo * DAY) })
    .where(eq(slateActions.publicId, v.id));
  return v.id;
}
const statusOf = async (id: string) => (await db.select().from(slateActions).where(eq(slateActions.publicId, id)))[0]?.status ?? 'deleted';

test('C1. cleanup: expires stale pending, deletes old closed actions, keeps recent and live ones', async () => {
  const base = new Date('2026-12-30T00:00:00.000Z');
  const live = await action('pending', null, 3_600_000, base); // expires in an hour
  const stale = await action('pending', null, -60_000, base); // expired a minute ago
  const oldApplied = await action('applied', 31, 0, base);
  const recentApplied = await action('applied', 2, 0, base);
  const oldDismissed = await action('dismissed', 45, 0, base);
  const oldConflict = await action('conflict', 40, 0, base);
  const r = await cleanupSlateData(db, { now: base, actionRetentionDays: 30, auditRetentionDays: 180 });
  assert.equal(await statusOf(live), 'pending');
  assert.equal(await statusOf(stale), 'expired', 'expired now, deleted only after the retention period');
  assert.equal(await statusOf(oldApplied), 'deleted');
  assert.equal(await statusOf(recentApplied), 'applied');
  assert.equal(await statusOf(oldDismissed), 'deleted');
  assert.equal(await statusOf(oldConflict), 'deleted');
  assert.ok(r.expired >= 1 && r.deletedActions >= 3);
  // The audit trail outlives the action, and holds no content.
  const events = await db.select().from(slateActionEvents);
  assert.ok(events.some((e) => e.event === 'expired'));
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE/);
  // A second run is a no-op for the same rows.
  const again = await cleanupSlateData(db, { now: base, actionRetentionDays: 30, auditRetentionDays: 180 });
  assert.equal(again.deletedActions, 0);
});

test('C2. cleanup: audit events older than their retention go; retention comes from env with safe fallbacks', async () => {
  const base = new Date('2027-08-01T00:00:00.000Z');
  const r = await cleanupSlateData(db, { now: base, actionRetentionDays: 30, auditRetentionDays: 180 });
  assert.ok(r.deletedEvents > 0);
  assert.deepEqual(cleanupOptionsFromEnv({ SLATE_ACTION_RETENTION_DAYS: '7', SLATE_AUDIT_RETENTION_DAYS: 'x' }), { actionRetentionDays: 7, auditRetentionDays: 180 });
  assert.deepEqual(cleanupOptionsFromEnv({ SLATE_ACTION_RETENTION_DAYS: '0' }), { actionRetentionDays: 30, auditRetentionDays: 180 });
});

/* ---------------- real Postgres: several instances, real row locks ---------------- */

const PG_URL = process.env.TEST_DATABASE_URL;

test('R1. real Postgres: 8 parallel acquires from 4 instances never exceed the concurrency limit', { skip: !PG_URL && 'set TEST_DATABASE_URL to run' }, async () => {
  const pools = Array.from({ length: 4 }, () => new pg.Pool({ connectionString: PG_URL, max: 3 }));
  try {
    const dbs = pools.map((p) => drizzlePg(p, { schema }));
    await silent(async () => {
      const { pushSchema } = await import('drizzle-kit/api');
      await (await pushSchema(schema, dbs[0] as never)).apply();
    });
    const uid = `race-${Date.now()}`;
    const limiters = dbs.map((d) => new SharedUsageLimiter(d, { maxRequests: 100, windowMs: 600_000, maxConcurrent: 2 }));
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => limiters[i % 4].acquire(uid)));
    assert.equal(results.filter((r) => r.ok).length, 2);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'busy').length, 6);
    await Promise.all(results.map((r) => (r.ok ? r.release() : null)));
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
});

test('R2. real Postgres: cleanup skips an action that is being applied at that moment', { skip: !PG_URL && 'set TEST_DATABASE_URL to run' }, async () => {
  const poolA = new pg.Pool({ connectionString: PG_URL, max: 2 });
  const poolB = new pg.Pool({ connectionString: PG_URL, max: 2 });
  try {
    const dbA = drizzlePg(poolA, { schema });
    const dbB = drizzlePg(poolB, { schema });
    const uid = `lock-${Date.now()}`;
    const [p] = await dbA.insert(contentItems).values({ userUid: uid, title: 'Locked' }).returning();
    const past = new Date(Date.now() - 2 * DAY);
    const [v] = await persistDrafts(dbA, uid, [{ kind: 'post_update', target: { type: 'post', id: p.id, title: 'Locked' }, baseVersion: 1, changes: { caption: 'new' }, before: { caption: '' }, summary: 's', reason: '' }], past);
    // The action is expired (proposed 2 days ago), and an apply is in flight holding its lock.
    let releaseApply!: () => void;
    const gate = new Promise<void>((r) => (releaseApply = r));
    let applyStarted!: () => void;
    const started = new Promise<void>((r) => (applyStarted = r));
    const applying = applyAction(dbA, uid, v.id, undefined, new Date(past.getTime() + 1000), {
      afterWrite: async () => {
        applyStarted();
        await gate;
      },
    });
    await started;
    const r = await cleanupSlateData(dbB, { now: new Date(), actionRetentionDays: 1 });
    assert.equal(r.expired, 0, 'the locked row was skipped, not expired');
    releaseApply();
    const result = await applying;
    assert.ok(result.ok, 'the apply finished normally');
    const [row] = await dbA.select().from(slateActions).where(eq(slateActions.publicId, v.id));
    assert.equal(row.status, 'applied');
  } finally {
    await poolA.end();
    await poolB.end();
  }
});
