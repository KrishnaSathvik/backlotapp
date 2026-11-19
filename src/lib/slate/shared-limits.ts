import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { slateBreakerState, slateUsageLeases } from '../../db/schema.ts';
import type { CircuitBreaker } from './breaker.ts';
import { errorKind, opsEvent } from '../ops-log.ts';

/**
 * Slate's request limits and circuit-breaker state shared by every Cloud Run instance,
 * stored in the Postgres database Backlot already uses (no new infrastructure).
 *
 * Usage leases (one row per Slate request):
 * - Acquire runs in one transaction holding a per-user advisory lock, so two instances
 *   can't both take the last slot. It counts the user's requests in the window (quota)
 *   and their unreleased, unexpired leases (concurrency), then inserts a lease.
 * - Release stamps released_at. A request whose instance crashed or lost the connection
 *   never releases, so every lease also expires (default 150 s, longer than any reply's
 *   deadline): an abandoned request can't hold a concurrency slot forever.
 * - If the database is unreachable, Slate fails closed: the request is refused with a
 *   short "try again" message rather than falling back to per-instance counters, which
 *   would multiply the allowed quota and concurrency by the number of instances.
 *
 * Circuit breaker: each instance keeps its fast in-process breaker, and shares outcomes.
 * Capacity failures are counted in slate_breaker_state; when the shared count reaches the
 * threshold within the window, the provider is marked open until a shared time and every
 * instance adopts that before routing. Each instance still sends at most one half-open
 * probe of its own after the cooldown.
 */

type Db = PgDatabase<any, any>;

export type AcquireResult =
  | { ok: true; release: () => Promise<void>; shared: boolean }
  | { ok: false; reason: 'busy' }
  | { ok: false; reason: 'rate'; retryAfterSec: number }
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'image_quota'; retryAfterSec: number }
  | { ok: false; reason: 'daily_quota'; retryAfterSec: number };

export interface LimitOptions {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  /** How long an unreleased lease counts as active. */
  leaseTtlMs?: number;
  /** Messages with an image allowed per user per 24 hours. */
  maxImagesPerDay?: number;
  /** All Slate messages allowed per user per rolling 24 hours (a spending ceiling). */
  maxRequestsPerDay?: number;
  now?: () => Date;
}

export const DEFAULT_LEASE_TTL_MS = 150_000;
/** Default daily ceiling per account (SLATE_DAILY_MESSAGE_LIMIT overrides). */
export const DEFAULT_DAILY_REQUESTS = 200;

export function dailyLimitFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.SLATE_DAILY_MESSAGE_LIMIT);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_DAILY_REQUESTS;
}

export class SharedUsageLimiter {
  private db: Db;
  readonly opts: Required<LimitOptions>;

  constructor(db: Db, opts: LimitOptions) {
    this.db = db;
    this.opts = { leaseTtlMs: DEFAULT_LEASE_TTL_MS, maxImagesPerDay: 30, maxRequestsPerDay: DEFAULT_DAILY_REQUESTS, now: () => new Date(), ...opts };
  }

  async acquire(uid: string, kind: 'chat' | 'image' = 'chat'): Promise<AcquireResult> {
    const { maxRequests, windowMs, maxConcurrent, leaseTtlMs, maxImagesPerDay, maxRequestsPerDay } = this.opts;
    const now = this.opts.now();
    const windowStart = new Date(now.getTime() - windowMs);
    const outcome = await this.db.transaction(async (tx) => {
      // Serializes acquires for this user across instances until the transaction ends.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`slate-usage:${uid}`}, 0))`);
      const [active] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(slateUsageLeases)
        .where(and(eq(slateUsageLeases.userUid, uid), isNull(slateUsageLeases.releasedAt), gt(slateUsageLeases.expiresAt, now)));
      if (active.n >= maxConcurrent) return { ok: false as const, reason: 'busy' as const };

      const [recent] = await tx
        .select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${slateUsageLeases.startedAt})::text` })
        .from(slateUsageLeases)
        .where(and(eq(slateUsageLeases.userUid, uid), gt(slateUsageLeases.startedAt, windowStart)));
      if (recent.n >= maxRequests) {
        const oldest = recent.oldest ? new Date(`${recent.oldest.replace(' ', 'T')}Z`).getTime() : now.getTime();
        return { ok: false as const, reason: 'rate' as const, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now.getTime()) / 1000)) };
      }
      const dayStart = new Date(now.getTime() - 86_400_000);
      const [daily] = await tx
        .select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${slateUsageLeases.startedAt})::text` })
        .from(slateUsageLeases)
        .where(and(eq(slateUsageLeases.userUid, uid), gt(slateUsageLeases.startedAt, dayStart)));
      if (daily.n >= maxRequestsPerDay) {
        const oldest = daily.oldest ? new Date(`${daily.oldest.replace(' ', 'T')}Z`).getTime() : now.getTime();
        return { ok: false as const, reason: 'daily_quota' as const, retryAfterSec: Math.max(60, Math.ceil((oldest + 86_400_000 - now.getTime()) / 1000)) };
      }
      if (kind === 'image') {
        const [images] = await tx
          .select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${slateUsageLeases.startedAt})::text` })
          .from(slateUsageLeases)
          .where(and(eq(slateUsageLeases.userUid, uid), eq(slateUsageLeases.kind, 'image'), gt(slateUsageLeases.startedAt, dayStart)));
        if (images.n >= maxImagesPerDay) {
          const oldest = images.oldest ? new Date(`${images.oldest.replace(' ', 'T')}Z`).getTime() : now.getTime();
          return { ok: false as const, reason: 'image_quota' as const, retryAfterSec: Math.max(60, Math.ceil((oldest + 86_400_000 - now.getTime()) / 1000)) };
        }
      }
      const [lease] = await tx
        .insert(slateUsageLeases)
        .values({ userUid: uid, startedAt: now, expiresAt: new Date(now.getTime() + leaseTtlMs), kind })
        .returning({ id: slateUsageLeases.id });
      return { ok: true as const, id: lease.id };
    });
    if (!outcome.ok) return outcome;
    let released = false;
    return {
      ok: true,
      shared: true,
      release: async () => {
        if (released) return;
        released = true;
        await this.db
          .update(slateUsageLeases)
          .set({ releasedAt: this.opts.now() })
          .where(and(eq(slateUsageLeases.id, outcome.id), isNull(slateUsageLeases.releasedAt)));
      },
    };
  }

  /** Housekeeping: drops leases older than the quota window (they no longer count). */
  async prune(olderThanMs = this.opts.windowMs * 2): Promise<number> {
    const cutoff = new Date(this.opts.now().getTime() - olderThanMs);
    const rows = await this.db.delete(slateUsageLeases).where(lt(slateUsageLeases.startedAt, cutoff)).returning({ id: slateUsageLeases.id });
    return rows.length;
  }
}

/**
 * Fails closed: if the shared store can't be reached, the request is refused
 * ('unavailable') instead of being counted per instance, so a database outage can't
 * multiply AI cost or concurrency. Errors are logged at most once a minute.
 */
export class FailClosedUsageLimiter {
  private shared: SharedUsageLimiter;
  private lastWarn = 0;

  constructor(shared: SharedUsageLimiter) {
    this.shared = shared;
  }

  async acquire(uid: string, kind: 'chat' | 'image' = 'chat'): Promise<AcquireResult> {
    try {
      return await this.shared.acquire(uid, kind);
    } catch (err) {
      const t = Date.now();
      if (t - this.lastWarn > 60_000) {
        this.lastWarn = t;
        opsEvent('slate.limits_unavailable', { error: errorKind(err) }, 'ERROR');
      }
      return { ok: false, reason: 'unavailable' };
    }
  }
}

/* ---------------- shared circuit-breaker state ---------------- */

export class SharedBreakerState {
  private db: Db;
  private threshold: number;
  private windowMs: number;
  private cooldownMs: number;
  private now: () => Date;

  constructor(db: Db, opts: { threshold?: number; windowMs?: number; cooldownMs?: number; now?: () => Date } = {}) {
    this.db = db;
    this.threshold = opts.threshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? (() => new Date());
  }

  /** Adopts providers other instances found failing. Never throws. */
  async syncInto(local: CircuitBreaker, providerIds: string[]): Promise<void> {
    try {
      const now = this.now();
      const rows = await this.db.select().from(slateBreakerState).where(gt(slateBreakerState.openUntil, now));
      for (const r of rows) if (providerIds.includes(r.provider) && r.openUntil) local.adoptOpen(r.provider, r.openUntil.getTime());
    } catch {
      // Shared state unavailable: the local breaker still works on its own.
    }
  }

  /** Records one capacity failure; opens the provider for everyone at the threshold. Never throws. */
  async recordFailure(provider: string): Promise<'counted' | 'opened' | 'unavailable'> {
    try {
      const now = this.now();
      return await this.db.transaction(async (tx) => {
        await tx.insert(slateBreakerState).values({ provider, failures: 0 }).onConflictDoNothing();
        const [row] = await tx.select().from(slateBreakerState).where(eq(slateBreakerState.provider, provider)).for('update');
        const fresh = !row.windowStartedAt || now.getTime() - row.windowStartedAt.getTime() >= this.windowMs;
        const failures = fresh ? 1 : row.failures + 1;
        if (failures >= this.threshold) {
          await tx
            .update(slateBreakerState)
            .set({ failures: 0, windowStartedAt: null, openUntil: new Date(now.getTime() + this.cooldownMs), updatedAt: now })
            .where(eq(slateBreakerState.provider, provider));
          return 'opened' as const;
        }
        await tx
          .update(slateBreakerState)
          .set({ failures, windowStartedAt: fresh ? now : row.windowStartedAt, updatedAt: now })
          .where(eq(slateBreakerState.provider, provider));
        return 'counted' as const;
      });
    } catch {
      return 'unavailable';
    }
  }

  /** A successful reply closes the provider for everyone. Never throws. */
  async recordSuccess(provider: string): Promise<void> {
    try {
      await this.db
        .update(slateBreakerState)
        .set({ failures: 0, windowStartedAt: null, openUntil: null, updatedAt: this.now() })
        .where(eq(slateBreakerState.provider, provider));
    } catch {
      // Ignored; see syncInto.
    }
  }
}
