import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';

/**
 * Scheduled housekeeping for Slate data (run daily via POST /api/internal/cleanup).
 *
 * 1. Pending actions past their expiry are marked expired (and audited).
 * 2. Closed actions (applied, dismissed, expired, conflict, failed) are deleted
 *    `actionRetentionDays` after their decision. Their payload holds proposed content,
 *    so they don't outlive the retention period.
 * 3. Audit events (ids, versions, outcomes; no content) are kept `auditRetentionDays`.
 * 4. Usage leases older than a day are dropped.
 *
 * Every selection uses FOR UPDATE SKIP LOCKED: an action that is being applied right now
 * holds its row lock, so cleanup skips it instead of waiting or deleting it. Pending,
 * unexpired actions are never touched.
 */

type Db = PgDatabase<any, any>;

export interface CleanupOptions {
  now?: Date;
  actionRetentionDays?: number;
  auditRetentionDays?: number;
}

export interface CleanupResult {
  expired: number;
  deletedActions: number;
  deletedEvents: number;
  deletedLeases: number;
}

const DAY = 86_400_000;

export function cleanupOptionsFromEnv(env: Record<string, string | undefined> = process.env): CleanupOptions {
  const days = (v: string | undefined, fallback: number, min: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min ? n : fallback;
  };
  return {
    actionRetentionDays: days(env.SLATE_ACTION_RETENTION_DAYS, 30, 1),
    auditRetentionDays: days(env.SLATE_AUDIT_RETENTION_DAYS, 180, 1),
  };
}

const count = (r: unknown) => (Array.isArray(r) ? r.length : ((r as { rows?: unknown[] }).rows?.length ?? 0));

export async function cleanupSlateData(db: Db, opts: CleanupOptions = {}): Promise<CleanupResult> {
  const now = opts.now ?? new Date();
  const actionCutoff = new Date(now.getTime() - (opts.actionRetentionDays ?? 30) * DAY);
  const auditCutoff = new Date(now.getTime() - (opts.auditRetentionDays ?? 180) * DAY);
  const leaseCutoff = new Date(now.getTime() - DAY);
  const ts = (d: Date) => d.toISOString();

  return db.transaction(async (tx) => {
    const expired = await tx.execute(sql`
      with stale as (
        select id from slate_actions
        where status = 'pending' and expires_at <= ${ts(now)}::timestamp
          -- accounts being deleted are left to the deletion job (the write guard refuses updates)
          and not exists (select 1 from account_deletions d where d.user_uid = slate_actions.user_uid)
        for update skip locked
      ), marked as (
        update slate_actions a set status = 'expired', decided_at = ${ts(now)}::timestamp
        from stale where a.id = stale.id
        returning a.id, a.user_uid
      )
      insert into slate_action_events (action_id, user_uid, event, detail, created_at)
      select id, user_uid, 'expired', '{"by":"cleanup"}'::jsonb, ${ts(now)}::timestamp from marked
      returning action_id`);

    const deletedActions = await tx.execute(sql`
      delete from slate_actions where id in (
        select id from slate_actions
        where status in ('applied', 'dismissed', 'expired', 'conflict', 'failed')
          and coalesce(decided_at, expires_at) < ${ts(actionCutoff)}::timestamp
        for update skip locked
      ) returning id`);

    const deletedEvents = await tx.execute(sql`
      delete from slate_action_events where created_at < ${ts(auditCutoff)}::timestamp returning id`);

    const deletedLeases = await tx.execute(sql`
      delete from slate_usage_leases where started_at < ${ts(leaseCutoff)}::timestamp returning id`);

    return { expired: count(expired), deletedActions: count(deletedActions), deletedEvents: count(deletedEvents), deletedLeases: count(deletedLeases) };
  });
}
