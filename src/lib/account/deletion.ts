import crypto from 'node:crypto';
import path from 'node:path';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
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
  uploadedFiles,
  uploadSessions,
  users,
} from '../../db/schema.ts';
import type { MediaStore } from '../storage/types.ts';
import type { DeletionLedger } from './ledger.ts';
import { openSessionRef } from '../storage/session-ref.ts';
import { errorKind, opsEvent } from '../ops-log.ts';

/**
 * Self-serve account deletion (Launch L2).
 *
 * 1. Request: the signed-in creator confirms (fresh sign-in + typed confirmation). One
 *    `account_deletions` row is inserted. From that moment every authenticated route refuses the
 *    account (see requireUser), so nothing new can be read or written, and Firebase refresh
 *    tokens are revoked so no new sign-in tokens are issued.
 * 2. Grace period (default 3 minutes): requests already in flight when the lock went on (a Slate
 *    reply, a chunk upload) finish before the job starts. The final check below catches anything
 *    that still slips through.
 * 3. Job: a background worker (POST /api/internal/account-deletions, every few minutes) claims
 *    the job with a lease and runs each step in order. Every step is idempotent and its
 *    completion time is recorded, so a crash or error resumes at the step that didn't finish.
 *    Failures retry with backoff for as long as it takes; the job never gives up silently.
 * 4. Completion: only after a final check finds no rows left in any table and no Firebase user.
 *    The row then stays as a tombstone (uid, dates; no content) for the status page.
 *
 * The Firebase sign-in is removed near the end, after everything it could be used to reach is
 * gone. The job doesn't need it: it runs server-side, keyed by uid.
 */

type Db = PgDatabase<any, any>;

export interface IdentityProvider {
  /** Stops new ID tokens being issued. A missing user is not an error. */
  revokeSessions(uid: string): Promise<void>;
  /** Deletes the sign-in account. A missing user is not an error. */
  deleteUser(uid: string): Promise<void>;
  exists(uid: string): Promise<boolean>;
}

export interface DeletionDeps {
  db: Db;
  store: MediaStore;
  identity: IdentityProvider;
  /**
   * Out-of-database record of the request (src/lib/account/ledger.ts). Production always has
   * one (R2); without it the record_ledger step is a no-op.
   */
  ledger?: DeletionLedger | null;
  now?: () => Date;
}

export const STEPS = [
  'record_ledger',
  'revoke_sessions',
  'cancel_uploads',
  'delete_workspace',
  'delete_slate',
  'delete_files',
  'delete_sign_in',
  'delete_profile',
  'verify',
] as const;
export type StepName = (typeof STEPS)[number];

export type DeletionRow = typeof accountDeletions.$inferSelect;

const MINUTE = 60_000;
export const DEFAULT_GRACE_MS = 3 * MINUTE;
const LEASE_MS = 10 * MINUTE;
/** After this many failed attempts the status page says it's taking longer, and logs ask for attention. */
export const DELAYED_AFTER_ATTEMPTS = 4;
const FILE_BATCH = 200;
const FILE_CONCURRENCY = 8;

/** 1, 5, 15, 30, 60 minutes, then every 6 hours. */
export function backoffMs(attempts: number): number {
  const schedule = [1, 5, 15, 30, 60];
  return (schedule[attempts - 1] ?? 360) * MINUTE;
}

export class RemainingDataError extends Error {
  readonly remaining: Record<string, number>;
  constructor(remaining: Record<string, number>) {
    super(`data remains: ${Object.entries(remaining).map(([k, n]) => `${k}=${n}`).join(',')}`);
    this.remaining = remaining;
  }
}

/* ------------------------------------------------------------------ */
/* Request and gate                                                     */
/* ------------------------------------------------------------------ */

/* Status-page token. 32 random bytes (base64url, 43 characters), given only to the creator in
 * the status link. Only its SHA-256 is stored, so neither a database read nor the row id or uid
 * can be turned into a working link. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newStatusToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashStatusToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Starts (or returns the existing) deletion for this account. Idempotent: a double click or a
 * retried request returns the same job. Each call returns a fresh status token; on a repeat
 * request the new token replaces the old one (only the most recent link works), because the
 * old token can't be recovered from its hash.
 */
export async function requestAccountDeletion(
  db: Db,
  uid: string,
  opts: { now?: Date; graceMs?: number } = {}
): Promise<{ row: DeletionRow; statusToken: string; created: boolean }> {
  const now = opts.now ?? new Date();
  const statusToken = newStatusToken();
  const statusTokenHash = hashStatusToken(statusToken);
  const inserted = await db
    .insert(accountDeletions)
    .values({
      userUid: uid,
      statusTokenHash,
      status: 'pending',
      steps: {},
      attempts: 0,
      requestedAt: now,
      nextAttemptAt: new Date(now.getTime() + (opts.graceMs ?? DEFAULT_GRACE_MS)),
      updatedAt: now,
    })
    .onConflictDoNothing({ target: accountDeletions.userUid })
    .returning();
  if (inserted.length) return { row: inserted[0], statusToken, created: true };
  const [row] = await db
    .update(accountDeletions)
    .set({ statusTokenHash })
    .where(eq(accountDeletions.userUid, uid))
    .returning();
  return { row, statusToken, created: false };
}

/** The account's deletion job, if any. Any row (in progress or done) means the account is locked. */
export async function deletionFor(db: Db, uid: string): Promise<DeletionRow | null> {
  const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.userUid, uid)).limit(1);
  return row ?? null;
}

/**
 * Looks up a deletion by its status token. Malformed tokens are rejected before any query, and
 * a completed record stops answering after `recordDays` even if the daily purge hasn't run yet.
 */
export async function deletionByStatusToken(
  db: Db,
  token: string,
  opts: { now?: Date; recordDays?: number } = {}
): Promise<DeletionRow | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select()
    .from(accountDeletions)
    .where(eq(accountDeletions.statusTokenHash, hashStatusToken(token)))
    .limit(1);
  if (!row) return null;
  const now = opts.now ?? new Date();
  if (row.completedAt && now.getTime() - row.completedAt.getTime() > (opts.recordDays ?? 30) * 86_400_000) return null;
  return row;
}

/* ------------------------------------------------------------------ */
/* Status shown to the creator                                          */
/* ------------------------------------------------------------------ */

/**
 * What the signed-out status page gets: progress flags and a few dates. No uid, email, job id,
 * attempt count, error or content.
 */
export interface DeletionStatusView {
  /** scheduled: grace period · in_progress · completed */
  state: 'scheduled' | 'in_progress' | 'completed';
  requestedAt: string;
  contentRemoved: boolean;
  filesDeleted: boolean;
  /** Day (YYYY-MM-DD) until which deleted files may stay recoverable in storage soft delete (null: none). */
  storagePurgeBy: string | null;
  signInRemoved: boolean;
  completedAt: string | null;
  /** Retries have been needed; it's still going. */
  delayed: boolean;
}

export function statusView(row: DeletionRow, softDeleteDays: number): DeletionStatusView {
  const s = row.steps ?? {};
  const files = s.delete_files ?? null;
  return {
    state: row.status === 'completed' ? 'completed' : row.status === 'pending' ? 'scheduled' : 'in_progress',
    requestedAt: row.requestedAt.toISOString(),
    contentRemoved: !!(s.delete_workspace && s.delete_slate),
    filesDeleted: !!files,
    storagePurgeBy:
      files && softDeleteDays > 0 ? new Date(new Date(files).getTime() + (softDeleteDays + 1) * 86_400_000).toISOString().slice(0, 10) : null,
    signInRemoved: !!s.delete_sign_in,
    completedAt: row.completedAt?.toISOString() ?? null,
    delayed: row.status !== 'completed' && row.attempts >= DELAYED_AFTER_ATTEMPTS,
  };
}

/**
 * Days deleted files may stay recoverable in storage. Cloud Storage (legacy) keeps them 7 days
 * by default; the R2 bucket has no soft delete or versioning, so deleted files are gone at once
 * (0). STORAGE_SOFT_DELETE_DAYS overrides; it must match the bucket's real policy.
 */
export function softDeleteDaysFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.STORAGE_SOFT_DELETE_DAYS;
  const n = Number(raw);
  if (raw?.trim() && Number.isInteger(n) && n >= 0 && n <= 90) return n;
  return (env.STORAGE_BACKEND ?? '').toLowerCase() === 'gcs' ? 7 : 0;
}

/* ------------------------------------------------------------------ */
/* Steps                                                                */
/* ------------------------------------------------------------------ */

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/** What's left for this uid, per table (verify step and tests). */
export async function remainingData(db: Db, uid: string): Promise<Record<string, number>> {
  const tables = {
    users: [users, users.uid],
    channels: [channels, channels.userUid],
    content_items: [contentItems, contentItems.userUid],
    ideas: [ideas, ideas.userUid],
    uploaded_files: [uploadedFiles, uploadedFiles.userUid],
    upload_sessions: [uploadSessions, uploadSessions.userUid],
    slate_preferences: [slatePreferences, slatePreferences.userUid],
    slate_actions: [slateActions, slateActions.userUid],
    slate_action_events: [slateActionEvents, slateActionEvents.userUid],
    slate_conversations: [slateConversations, slateConversations.userUid],
    slate_messages: [slateMessages, slateMessages.userUid],
    slate_embeddings: [slateEmbeddings, slateEmbeddings.userUid],
    slate_usage_leases: [slateUsageLeases, slateUsageLeases.userUid],
  } as const;
  const out: Record<string, number> = {};
  for (const [name, [table, col]] of Object.entries(tables)) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(table as never).where(eq(col as never, uid));
    if (Number(n) > 0) out[name] = Number(n);
  }
  return out;
}

/** Which step removes rows from each table (so verify can send the job back to it). */
const STEP_FOR_TABLE: Partial<Record<string, StepName>> = {
  users: 'delete_profile',
  channels: 'delete_workspace',
  content_items: 'delete_workspace',
  ideas: 'delete_workspace',
  uploaded_files: 'delete_files',
  upload_sessions: 'cancel_uploads',
  slate_preferences: 'delete_slate',
  slate_actions: 'delete_slate',
  slate_action_events: 'delete_slate',
  slate_conversations: 'delete_slate',
  slate_messages: 'delete_slate',
  slate_embeddings: 'delete_slate',
  slate_usage_leases: 'delete_slate',
};

const runStep: Record<StepName, (deps: DeletionDeps, uid: string, job: DeletionRow) => Promise<void>> = {
  /** Before anything is removed, so a later database restore can't forget this request. */
  async record_ledger({ ledger }, uid, job) {
    if (ledger) await ledger.record({ uid, jobId: job.id, requestedAt: job.requestedAt.toISOString() });
  },

  async revoke_sessions({ identity }, uid) {
    await identity.revokeSessions(uid);
  },

  /** Cancels unfinished uploads so their storage sessions can't be used, and drops partial objects. */
  async cancel_uploads({ db, store }, uid) {
    const sessions = await db.select().from(uploadSessions).where(eq(uploadSessions.userUid, uid));
    await eachLimited(sessions, FILE_CONCURRENCY, async (s) => {
      if (s.status === 'active' && s.sessionRef) {
        const ref = openSessionRef(s.sessionRef);
        if (ref) await store.abortUpload(ref, s.storageKey);
      }
      // Any object this session produced. A completed one is also in uploaded_files, and
      // deleting it twice is harmless (a missing object is not an error).
      await store.delete(s.storageKey);
    });
    if (sessions.length) await db.delete(uploadSessions).where(inArray(uploadSessions.id, sessions.map((s) => s.id)));
  },

  async delete_workspace({ db }, uid) {
    await db.transaction(async (tx) => {
      await tx.delete(contentItems).where(eq(contentItems.userUid, uid));
      await tx.delete(ideas).where(eq(ideas.userUid, uid));
      await tx.delete(channels).where(eq(channels.userUid, uid));
    });
  },

  /**
   * Conversations, messages and condensed notes (slate_conversations.summary), preferences,
   * search embeddings, suggested actions and their audit events, and usage/limiter leases.
   * The audit events hold no content, but they're tied to this account, so they go too.
   */
  async delete_slate({ db }, uid) {
    await db.transaction(async (tx) => {
      await tx.delete(slateMessages).where(eq(slateMessages.userUid, uid));
      await tx.delete(slateConversations).where(eq(slateConversations.userUid, uid));
      await tx.delete(slateEmbeddings).where(eq(slateEmbeddings.userUid, uid));
      await tx.delete(slatePreferences).where(eq(slatePreferences.userUid, uid));
      await tx.delete(slateActionEvents).where(eq(slateActionEvents.userUid, uid));
      await tx.delete(slateActions).where(eq(slateActions.userUid, uid));
      await tx.delete(slateUsageLeases).where(eq(slateUsageLeases.userUid, uid));
    });
  },

  /**
   * Deletes each file's object first, then its row, in batches. If a delete fails partway, the
   * rows that remain still point at their objects, so the retry finishes the job.
   */
  async delete_files({ db, store }, uid) {
    for (;;) {
      const batch = await db
        .select({ id: uploadedFiles.id, key: uploadedFiles.storageKey })
        .from(uploadedFiles)
        .where(eq(uploadedFiles.userUid, uid))
        .limit(FILE_BATCH);
      if (!batch.length) return;
      await eachLimited(batch, FILE_CONCURRENCY, (f) => store.delete(path.basename(f.key)));
      await db.delete(uploadedFiles).where(inArray(uploadedFiles.id, batch.map((f) => f.id)));
    }
  },

  async delete_sign_in({ identity }, uid) {
    await identity.deleteUser(uid);
  },

  async delete_profile({ db }, uid) {
    await db.delete(users).where(eq(users.uid, uid));
  },

  async verify({ db, identity }, uid) {
    const remaining = await remainingData(db, uid);
    if (await identity.exists(uid)) remaining.sign_in = 1;
    if (Object.keys(remaining).length) throw new RemainingDataError(remaining);
  },
};

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

const ts = (d: Date) => d.toISOString();

function rowFromSql(r: Record<string, unknown>): DeletionRow {
  const date = (v: unknown) => (v == null ? null : v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z')));
  return {
    id: Number(r.id),
    userUid: String(r.user_uid),
    statusTokenHash: String(r.status_token_hash),
    status: String(r.status),
    steps: (typeof r.steps === 'string' ? JSON.parse(r.steps) : r.steps) as Record<string, string>,
    attempts: Number(r.attempts),
    lastError: (r.last_error as string | null) ?? null,
    requestedAt: date(r.requested_at)!,
    nextAttemptAt: date(r.next_attempt_at)!,
    lockedUntil: date(r.locked_until),
    updatedAt: date(r.updated_at)!,
    completedAt: date(r.completed_at),
  };
}

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : ((r as { rows?: Record<string, unknown>[] }).rows ?? []));

/** Claims one due job with a lease (SKIP LOCKED: two workers never get the same job). */
export async function claimDueDeletion(db: Db, now: Date): Promise<DeletionRow | null> {
  const result = await db.execute(sql`
    update account_deletions set
      status = 'running',
      attempts = attempts + 1,
      locked_until = ${ts(new Date(now.getTime() + LEASE_MS))}::timestamp,
      updated_at = ${ts(now)}::timestamp
    where id = (
      select id from account_deletions
      where status in ('pending', 'running')
        and next_attempt_at <= ${ts(now)}::timestamp
        and (locked_until is null or locked_until <= ${ts(now)}::timestamp)
      order by next_attempt_at
      for update skip locked
      limit 1
    )
    returning *`);
  const [row] = rowsOf(result);
  return row ? rowFromSql(row) : null;
}

function errorCode(err: unknown): string {
  if (err instanceof RemainingDataError) return err.message.slice(0, 200);
  return errorKind(err);
}

/** Runs the remaining steps of a claimed job. Returns whether it completed. */
export async function runDeletion(deps: DeletionDeps, job: DeletionRow): Promise<{ completed: boolean; error?: string }> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const steps: Record<string, string> = { ...(job.steps ?? {}) };

  for (const step of STEPS) {
    if (steps[step]) continue;
    try {
      await runStep[step](deps, job.userUid, job);
    } catch (err) {
      const t = now();
      if (err instanceof RemainingDataError) {
        // Something was written after its step ran (a request that was already in flight).
        // Send the job back to the steps that clear those tables.
        for (const table of Object.keys(err.remaining)) {
          const back = table === 'sign_in' ? 'delete_sign_in' : STEP_FOR_TABLE[table];
          if (back) delete steps[back];
        }
      }
      const code = errorCode(err);
      await db
        .update(accountDeletions)
        .set({
          steps,
          lastError: `${step}:${code}`.slice(0, 200),
          nextAttemptAt: new Date(t.getTime() + (err instanceof RemainingDataError ? MINUTE : backoffMs(job.attempts))),
          lockedUntil: null,
          updatedAt: t,
        })
        .where(eq(accountDeletions.id, job.id));
      const needsAttention = job.attempts >= DELAYED_AFTER_ATTEMPTS;
      opsEvent(
        'account_deletion.retry',
        { job: job.id, step, attempt: job.attempts, error: code, needs_attention: needsAttention },
        needsAttention ? 'ERROR' : 'WARNING'
      );
      return { completed: false, error: `${step}:${code}` };
    }
    steps[step] = ts(now());
    opsEvent('account_deletion.step', { job: job.id, step, attempt: job.attempts });
    await db
      .update(accountDeletions)
      .set({ steps, lockedUntil: new Date(now().getTime() + LEASE_MS), updatedAt: now() })
      .where(eq(accountDeletions.id, job.id));
  }

  const t = now();
  await db
    .update(accountDeletions)
    .set({ status: 'completed', completedAt: t, lockedUntil: null, lastError: null, updatedAt: t })
    .where(eq(accountDeletions.id, job.id));
  // uid: the out-of-database record used to re-apply deletions after a restore (docs/OPERATIONS.md).
  opsEvent('account_deletion.completed', { job: job.id, uid: job.userUid, attempts: job.attempts, hours: Math.round((t.getTime() - job.requestedAt.getTime()) / 36e5) }, 'NOTICE');
  return { completed: true };
}

/** Worker entry point: runs due jobs until none are left or the time budget is used. */
export async function processDueDeletions(deps: DeletionDeps, opts: { budgetMs?: number; maxJobs?: number } = {}) {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  let completed = 0;
  let retrying = 0;
  for (let i = 0; i < (opts.maxJobs ?? 20); i++) {
    if (Date.now() - started > (opts.budgetMs ?? 4 * MINUTE)) break;
    const job = await claimDueDeletion(deps.db, now());
    if (!job) break;
    const result = await runDeletion(deps, job);
    if (result.completed) completed += 1;
    else retrying += 1;
  }
  return { completed, retrying };
}

/** Daily cleanup: removes completed tombstones after the record period. */
export async function purgeDeletionRecords(db: Db, opts: { now?: Date; recordDays?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.recordDays ?? 30) * 86_400_000);
  const removed = await db
    .delete(accountDeletions)
    .where(and(eq(accountDeletions.status, 'completed'), lt(accountDeletions.completedAt, cutoff)))
    .returning({ id: accountDeletions.id });
  return removed.length;
}

export function recordDaysFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ACCOUNT_DELETION_RECORD_DAYS);
  return Number.isInteger(n) && n >= 1 ? n : 30;
}
