import crypto from 'node:crypto';
import path from 'node:path';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { uploadedFiles, uploadSessions } from '../../db/schema.ts';
import { openSessionRef, readSessionKey, sealSessionRef } from './session-ref.ts';
import { contentMatches } from './sniff.ts';
import { opsEvent } from '../ops-log.ts';
import { isStorageKey, StorageError, type MediaStore } from './types.ts';

/**
 * Uploads on top of a MediaStore. Two transports share one reservation step (quota, concurrent
 * uploads and the app-wide ceiling, reserved atomically in Postgres):
 *
 * - Direct (R2, production): the browser uploads parts straight to the bucket with short-lived
 *   per-part URLs; see startDirectUpload / signUploadParts / completeDirectUpload below.
 * - Chunked (local development; legacy Cloud Storage): 2 MB chunks through /api/upload/chunk,
 *   described next.
 *
 * Chunked flow:
 * Flow: the first chunk (offset 0) checks the file's real type, the user's storage quota and
 * concurrent uploads, then opens a storage session and records it here. Later chunks must start
 * exactly where the stored bytes end; a retried chunk is acknowledged without writing twice.
 * The last chunk completes the object, and the uploaded_files row (ownership) is written in a
 * transaction with the session's "complete" mark.
 *
 * If storage succeeds but the database write fails, the session stays "active" with every byte
 * received: a retry of the last chunk finishes it, and otherwise cleanup deletes the object once
 * the session expires. An object without an uploaded_files row is never served to anyone.
 */

type Db = PgDatabase<any, any>;
const GiB = 1024 ** 3;

export interface UploadPolicy {
  /** Total bytes of finished and in-progress uploads per account. */
  quotaBytes: number;
  /** Unfinished uploads per account at once. */
  maxActive: number;
  /** An unfinished upload is cancelled after this long. */
  sessionTtlMs: number;
  /**
   * App-wide ceiling on stored + in-progress bytes across all accounts (protects the storage
   * bill). New uploads are refused once it would be exceeded. Unset: no ceiling.
   */
  appCeilingBytes?: number;
  /** App-wide usage above this logs `storage.app_usage_high` (an alert hook). */
  appWarnBytes?: number;
}

const posNum = (raw: string | undefined) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Private-beta defaults (configurable): 1 GB per creator, 2 uploads at a time, a warning at
 * 8 GB and a hard ceiling at 9.5 GB app-wide (inside R2's 10 GB-month free allowance).
 *   STORAGE_QUOTA_GB, UPLOAD_MAX_CONCURRENT, STORAGE_APP_WARN_GB, STORAGE_APP_CEILING_GB
 *   (STORAGE_APP_CEILING_GB=0 turns the ceiling off.)
 */
export function uploadPolicyFromEnv(env: Record<string, string | undefined> = process.env): UploadPolicy {
  const maxActive = Number(env.UPLOAD_MAX_CONCURRENT);
  const ceilingOff = env.STORAGE_APP_CEILING_GB?.trim() === '0';
  return {
    quotaBytes: (posNum(env.STORAGE_QUOTA_GB) ?? 1) * GiB,
    maxActive: Number.isInteger(maxActive) && maxActive > 0 ? maxActive : 2,
    sessionTtlMs: 24 * 60 * 60 * 1000,
    appCeilingBytes: ceilingOff ? undefined : (posNum(env.STORAGE_APP_CEILING_GB) ?? 9.5) * GiB,
    appWarnBytes: (posNum(env.STORAGE_APP_WARN_GB) ?? 8) * GiB,
  };
}

export interface ChunkInput {
  uploadId: string;
  offset: number;
  totalSize: number;
  fileName: string;
  mimeType: string;
  chunk: Uint8Array;
}

export type ChunkResult =
  | { status: 200; body: { completed: false; received: number } }
  | { status: 200; body: { completed: true; received: number; asset: { id: string; name: string; url: string; mimeType: string; size: number } } }
  | { status: 400 | 409 | 410 | 413 | 415 | 429 | 503 | 507; body: { error: string; received?: number } };

const assetFor = (key: string, name: string, mimeType: string, size: number) => ({ id: key, name, url: `/api/files/${encodeURIComponent(key)}`, mimeType, size });

/** Stored + in-progress bytes across every account (for the app-wide ceiling). */
export async function appStorageUsed(db: Db, now = new Date()): Promise<number> {
  const [files] = await db.select({ n: sql<number>`coalesce(sum(${uploadedFiles.sizeBytes}), 0)::bigint` }).from(uploadedFiles);
  const [pending] = await db
    .select({ n: sql<number>`coalesce(sum(${uploadSessions.totalSize}), 0)::bigint` })
    .from(uploadSessions)
    .where(and(eq(uploadSessions.status, 'active'), sql`${uploadSessions.expiresAt} > ${now.toISOString()}::timestamp`));
  return Number(files.n) + Number(pending.n);
}

export async function storageUsed(db: Db, uid: string, now = new Date()): Promise<number> {
  const [files] = await db.select({ n: sql<number>`coalesce(sum(${uploadedFiles.sizeBytes}), 0)::bigint` }).from(uploadedFiles).where(eq(uploadedFiles.userUid, uid));
  const [pending] = await db
    .select({ n: sql<number>`coalesce(sum(${uploadSessions.totalSize}), 0)::bigint` })
    .from(uploadSessions)
    .where(and(eq(uploadSessions.userUid, uid), eq(uploadSessions.status, 'active'), sql`${uploadSessions.expiresAt} > ${now.toISOString()}::timestamp`));
  return Number(files.n) + Number(pending.n);
}

async function finalize(db: Db, uid: string, session: typeof uploadSessions.$inferSelect, now: Date) {
  await db.transaction(async (tx) => {
    await tx
      .insert(uploadedFiles)
      .values({ userUid: uid, storageKey: session.storageKey, fileName: session.fileName, mimeType: session.mimeType, sizeBytes: session.totalSize })
      .onConflictDoNothing({ target: uploadedFiles.storageKey });
    await tx.update(uploadSessions).set({ status: 'complete', received: session.totalSize, updatedAt: now }).where(eq(uploadSessions.id, session.id));
  });
  return { status: 200 as const, body: { completed: true as const, received: session.totalSize, asset: assetFor(session.storageKey, session.fileName, session.mimeType, session.totalSize) } };
}

type Refusal = { status: 413 | 429 | 507; body: { error: string } };

/**
 * Reserves a slot and the quota atomically, and records the session row (status "active",
 * counted by storageUsed) before any storage session is opened.
 *
 * A per-account advisory lock serializes uploads that start at the same moment, so two of them
 * can't both claim the same free space; when an app-wide ceiling is set, a second (global)
 * lock does the same across accounts. Both are transaction-scoped, so this works through the
 * Supabase transaction pooler. Lock order is always account, then global.
 */
async function reserveUpload(
  db: Db,
  uid: string,
  input: { uploadId: string; fileName: string; mimeType: string; totalSize: number },
  policy: UploadPolicy,
  now: Date
): Promise<{ session?: typeof uploadSessions.$inferSelect; reserved?: boolean; refused?: Refusal }> {
  const where = and(eq(uploadSessions.userUid, uid), eq(uploadSessions.uploadId, input.uploadId));
  // Server-chosen key: a client can never pick or overwrite an object name.
  const ext = path.extname(input.fileName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10).toLowerCase();
  const storageKey = `${crypto.randomUUID()}${ext}`;
  let appUsage: number | null = null;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`upload:${uid}`}, 0))`);
    const [raced] = await tx.select().from(uploadSessions).where(where).limit(1);
    if (raced) return { session: raced };
    const [active] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(uploadSessions)
      .where(and(eq(uploadSessions.userUid, uid), eq(uploadSessions.status, 'active'), sql`${uploadSessions.expiresAt} > ${now.toISOString()}::timestamp`));
    if (active.n >= policy.maxActive) return { refused: { status: 429 as const, body: { error: `You can upload ${policy.maxActive} files at a time. Wait for one to finish.` } } };
    if ((await storageUsed(tx, uid, now)) + input.totalSize > policy.quotaBytes) {
      const gb = policy.quotaBytes / GiB;
      return { refused: { status: 413 as const, body: { error: `This would go over your ${gb >= 1 ? Math.round(gb * 10) / 10 : gb.toFixed(2)} GB storage limit. Delete some files first.` } } };
    }
    if (policy.appCeilingBytes || policy.appWarnBytes) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'upload:global'}, 0))`);
      appUsage = await appStorageUsed(tx, now);
      if (policy.appCeilingBytes && appUsage + input.totalSize > policy.appCeilingBytes) {
        return { refused: { status: 507 as const, body: { error: 'Backlot’s beta storage is full right now, so new uploads are paused. Your existing files are safe.' } }, ceiling: true };
      }
    }
    const [row] = await tx
      .insert(uploadSessions)
      .values({
        userUid: uid,
        uploadId: input.uploadId,
        storageKey,
        sessionRef: '', // filled in once storage has opened the session
        fileName: input.fileName,
        mimeType: input.mimeType,
        totalSize: input.totalSize,
        received: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + policy.sessionTtlMs),
      })
      .returning();
    return { session: row, reserved: true };
  });
  if ('ceiling' in result) opsEvent('storage.app_ceiling_reached', { used_gb: Math.round(((appUsage ?? 0) / GiB) * 100) / 100 }, 'ERROR');
  else if (appUsage !== null && policy.appWarnBytes && appUsage + input.totalSize > policy.appWarnBytes) {
    opsEvent('storage.app_usage_high', { used_gb: Math.round(((appUsage + input.totalSize) / GiB) * 100) / 100 }, 'WARNING');
  }
  return result;
}

export async function receiveChunk(db: Db, store: MediaStore, uid: string, input: ChunkInput, policy: UploadPolicy, now = new Date()): Promise<ChunkResult> {
  const where = and(eq(uploadSessions.userUid, uid), eq(uploadSessions.uploadId, input.uploadId));
  let [session] = await db.select().from(uploadSessions).where(where).limit(1);

  if (!session) {
    // This store takes uploads straight from the browser (R2), never through the server.
    if (store.direct) return { status: 400, body: { error: 'This server takes direct uploads. Refresh the page and try again.' } };
    if (input.offset !== 0) return { status: 409, body: { error: 'Upload not started.', received: 0 } };
    if (!contentMatches(input.mimeType, input.chunk.subarray(0, 64))) {
      return { status: 415, body: { error: `“${input.fileName}” doesn’t look like a valid ${input.mimeType.split('/')[0]} file.` } };
    }
    const sealing = readSessionKey();
    if (sealing.error) {
      console.error(`upload refused: ${sealing.error}`);
      return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
    }

    const reservation = await reserveUpload(db, uid, input, policy, now);
    if (reservation.refused) return reservation.refused;
    session = reservation.session!;

    if (reservation.reserved) {
      let sessionRef: string;
      try {
        sessionRef = await store.beginUpload(session.storageKey, input.mimeType, input.totalSize);
      } catch {
        await db.delete(uploadSessions).where(eq(uploadSessions.id, session.id));
        return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
      }
      const sealed = sealSessionRef(sessionRef, sealing.key);
      await db.update(uploadSessions).set({ sessionRef: sealed, updatedAt: now }).where(eq(uploadSessions.id, session.id));
      session = { ...session, sessionRef: sealed };
    }
  }

  // Another request for this same upload is still opening its storage session.
  if (session.status === 'active' && !session.sessionRef) return { status: 503, body: { error: 'Upload is starting. Try again.' } };

  if (session.totalSize !== input.totalSize || session.mimeType !== input.mimeType) return { status: 400, body: { error: 'This upload doesn’t match its earlier chunks.' } };
  if (session.status === 'complete') return { status: 200, body: { completed: true, received: session.totalSize, asset: assetFor(session.storageKey, session.fileName, session.mimeType, session.totalSize) } };
  if (session.status !== 'active' || session.expiresAt.getTime() <= now.getTime()) return { status: 410, body: { error: 'This upload expired. Start it again.' } };

  // Already have these bytes (a retry after a lost response).
  if (input.offset + input.chunk.length <= session.received) {
    if (session.received === session.totalSize) return finalize(db, uid, session, now);
    return { status: 200, body: { completed: false, received: session.received } };
  }
  if (input.offset !== session.received) return { status: 409, body: { error: 'Chunk out of order.', received: session.received } };

  const ref = openSessionRef(session.sessionRef);
  if (!ref) {
    await db.update(uploadSessions).set({ status: 'aborted', updatedAt: now }).where(eq(uploadSessions.id, session.id));
    return { status: 410, body: { error: 'This upload expired. Start it again.' } };
  }

  let result: { received: number; complete: boolean };
  try {
    result = await store.writeChunk(ref, session.storageKey, input.offset, input.chunk, session.totalSize);
  } catch (err) {
    if (err instanceof StorageError && err.code === 'NOT_FOUND') {
      await db.update(uploadSessions).set({ status: 'aborted', updatedAt: now }).where(eq(uploadSessions.id, session.id));
      return { status: 410, body: { error: 'This upload expired. Start it again.' } };
    }
    // Ask storage what it actually has, and tell the client where to resume.
    const received = await store.uploadedBytes(ref, session.storageKey, session.totalSize).catch(() => session.received);
    await db.update(uploadSessions).set({ received, updatedAt: now }).where(eq(uploadSessions.id, session.id));
    return { status: 409, body: { error: 'Resume from the last stored byte.', received } };
  }

  await db.update(uploadSessions).set({ received: result.received, updatedAt: now }).where(eq(uploadSessions.id, session.id));
  if (result.complete) return finalize(db, uid, { ...session, received: result.received }, now);
  return { status: 200, body: { completed: false, received: result.received } };
}

export async function uploadProgress(db: Db, uid: string, uploadId: string): Promise<number> {
  const [s] = await db.select().from(uploadSessions).where(and(eq(uploadSessions.userUid, uid), eq(uploadSessions.uploadId, uploadId))).limit(1);
  return s ? (s.status === 'complete' ? s.totalSize : s.received) : 0;
}

/**
 * Housekeeping (daily cleanup job): cancels expired unfinished uploads and deletes any object
 * they left without an uploaded_files row, then forgets old finished sessions.
 */
export async function cleanupUploads(db: Db, store: MediaStore, now = new Date()): Promise<{ aborted: number; objectsDeleted: number; forgotten: number }> {
  const expired = await db
    .select()
    .from(uploadSessions)
    // Accounts being deleted are left to the deletion job (the write guard refuses updates to them).
    .where(
      and(
        eq(uploadSessions.status, 'active'),
        lt(uploadSessions.expiresAt, now),
        sql`not exists (select 1 from account_deletions d where d.user_uid = ${uploadSessions.userUid})`
      )
    )
    .limit(500);
  let objectsDeleted = 0;
  for (const s of expired) {
    const ref = openSessionRef(s.sessionRef);
    if (ref) await store.abortUpload(ref, s.storageKey).catch(() => undefined);
    const [owned] = await db.select({ id: uploadedFiles.id }).from(uploadedFiles).where(eq(uploadedFiles.storageKey, s.storageKey)).limit(1);
    if (!owned && (await store.stat(s.storageKey).catch(() => null))) {
      await store.delete(s.storageKey);
      objectsDeleted += 1;
    }
  }
  if (expired.length) await db.update(uploadSessions).set({ status: 'aborted', updatedAt: now }).where(inArray(uploadSessions.id, expired.map((s) => s.id)));
  const old = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const forgotten = await db
    .delete(uploadSessions)
    .where(and(inArray(uploadSessions.status, ['complete', 'aborted']), lt(uploadSessions.updatedAt, old)))
    .returning({ id: uploadSessions.id });
  return { aborted: expired.length, objectsDeleted, forgotten: forgotten.length };
}

/* ------------------------------------------------------------------ */
/* Direct browser-to-bucket uploads (R2 multipart)                      */
/* ------------------------------------------------------------------ */

/** Bytes inspected to confirm a finished upload's real type (same as the chunked path). */
const SNIFF_BYTES = 64;
/** Part URLs per request, and how long each stays valid. */
export const MAX_PARTS_PER_SIGN = 20;
export function partUrlTtlSec(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.UPLOAD_PART_URL_TTL_SEC);
  return Number.isInteger(n) && n >= 60 && n <= 3600 ? n : 900;
}

export interface DirectStartInput {
  uploadId: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
}

type Asset = ReturnType<typeof assetFor>;

export type DirectStartResult =
  | { status: 200; body: { mode: 'chunked' } }
  | { status: 200; body: { mode: 'direct'; completed: false; partSize: number; partCount: number; uploadedParts: number[] } }
  | { status: 200; body: { mode: 'direct'; completed: true; asset: Asset } }
  | { status: 400 | 409 | 410 | 413 | 415 | 429 | 503 | 507; body: { error: string } };

const partCountFor = (total: number, partSize: number) => Math.max(1, Math.ceil(total / partSize));
const expectedPartSize = (n: number, total: number, partSize: number) => (n < partCountFor(total, partSize) ? partSize : total - (partCountFor(total, partSize) - 1) * partSize);
const isLive = (s: typeof uploadSessions.$inferSelect, now: Date) => s.status === 'active' && s.expiresAt.getTime() > now.getTime();
const expired = { status: 410 as const, body: { error: 'This upload expired. Start it again.' } };

async function findSession(db: Db, uid: string, uploadId: string) {
  const [s] = await db.select().from(uploadSessions).where(and(eq(uploadSessions.userUid, uid), eq(uploadSessions.uploadId, uploadId))).limit(1);
  return s ?? null;
}

async function markAborted(db: Db, id: number, now: Date) {
  await db.update(uploadSessions).set({ status: 'aborted', updatedAt: now }).where(eq(uploadSessions.id, id));
}

/**
 * Starts a direct upload, or resumes one (same uploadId after a lost response, a refresh or on
 * another instance): returns the part size and the parts the bucket already has. Stores without
 * direct uploads answer `{ mode: 'chunked' }` and the browser uses /api/upload/chunk.
 *
 * Nothing is trusted from the browser beyond its claims about name, type and size; those only
 * size the reservation. The bytes are checked once the object exists (completeDirectUpload).
 */
export async function startDirectUpload(db: Db, store: MediaStore, uid: string, input: DirectStartInput, policy: UploadPolicy, now = new Date()): Promise<DirectStartResult> {
  const direct = store.direct;
  if (!direct) return { status: 200, body: { mode: 'chunked' } };
  const partSize = direct.partSize(input.totalSize);
  const plan = (uploadedParts: number[]) => ({
    status: 200 as const,
    body: { mode: 'direct' as const, completed: false as const, partSize, partCount: partCountFor(input.totalSize, partSize), uploadedParts },
  });

  let session = await findSession(db, uid, input.uploadId);
  if (session) {
    if (session.totalSize !== input.totalSize || session.mimeType !== input.mimeType) return { status: 400, body: { error: 'This upload doesn’t match how it was started.' } };
    if (session.status === 'complete') return { status: 200, body: { mode: 'direct', completed: true, asset: assetFor(session.storageKey, session.fileName, session.mimeType, session.totalSize) } };
    if (!isLive(session, now)) return expired;
    if (!session.sessionRef) return { status: 503, body: { error: 'Upload is starting. Try again.' } };
    const ref = openSessionRef(session.sessionRef);
    if (!ref) {
      await markAborted(db, session.id, now);
      return expired;
    }
    try {
      return plan((await direct.listParts(session.storageKey, ref)).map((p) => p.partNumber));
    } catch (err) {
      if (err instanceof StorageError && err.code === 'NOT_FOUND') {
        await markAborted(db, session.id, now);
        return expired;
      }
      return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
    }
  }

  const sealing = readSessionKey();
  if (sealing.error) {
    opsEvent('upload.refused_config', { reason: 'session_key' }, 'ERROR');
    return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
  }
  const reservation = await reserveUpload(db, uid, input, policy, now);
  if (reservation.refused) return reservation.refused;
  session = reservation.session!;
  if (!reservation.reserved) return startDirectUpload(db, store, uid, input, policy, now); // a concurrent start won

  let multipartId: string;
  try {
    multipartId = await store.beginUpload(session.storageKey, input.mimeType, input.totalSize);
  } catch {
    // Release the reservation: no storage session exists.
    await db.delete(uploadSessions).where(eq(uploadSessions.id, session.id));
    return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
  }
  await db.update(uploadSessions).set({ sessionRef: sealSessionRef(multipartId, sealing.key), updatedAt: now }).where(eq(uploadSessions.id, session.id));
  return plan([]);
}

export type SignPartsResult =
  | { status: 200; body: { parts: { partNumber: number; url: string; size: number }[]; expiresInSec: number } }
  | { status: 400 | 404 | 410 | 503; body: { error: string } };

/**
 * Short-lived URLs for specific parts of the creator's own active upload. Each URL is signed for
 * one part number of one object, with its expected Content-Length among the signed headers;
 * nothing else in the bucket. Whether R2 rejects a body of a different length isn't documented
 * by Cloudflare (staging check S-UP3, docs/RELEASE_CHECKLIST.md), so completeDirectUpload's
 * ListParts size check, object size check and content sniff are the authoritative validation.
 */
export async function signUploadParts(db: Db, store: MediaStore, uid: string, uploadId: string, partNumbers: number[], now = new Date()): Promise<SignPartsResult> {
  const direct = store.direct;
  if (!direct) return { status: 400, body: { error: 'Direct uploads are not enabled.' } };
  const session = await findSession(db, uid, uploadId);
  if (!session) return { status: 404, body: { error: 'Upload not found.' } };
  if (!isLive(session, now) || !session.sessionRef) return expired;
  const partSize = direct.partSize(session.totalSize);
  const count = partCountFor(session.totalSize, partSize);
  const unique = [...new Set(partNumbers)];
  if (!unique.length || unique.length > MAX_PARTS_PER_SIGN || unique.some((n) => !Number.isInteger(n) || n < 1 || n > count)) {
    return { status: 400, body: { error: 'Invalid part numbers.' } };
  }
  const ref = openSessionRef(session.sessionRef);
  if (!ref) {
    await markAborted(db, session.id, now);
    return expired;
  }
  const ttl = partUrlTtlSec();
  try {
    const parts = await Promise.all(
      unique.map(async (n) => {
        const size = expectedPartSize(n, session.totalSize, partSize);
        return { partNumber: n, size, url: await direct.presignPart(session.storageKey, ref, n, size, ttl) };
      })
    );
    return { status: 200, body: { parts, expiresInSec: ttl } };
  } catch {
    return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
  }
}

export type DirectCompleteResult =
  | { status: 200; body: { completed: true; received: number; asset: Asset } }
  | { status: 409; body: { error: string; missingParts: number[] } }
  | { status: 400 | 404 | 410 | 415 | 503; body: { error: string } };

/**
 * Finishes a direct upload. The bucket's own part list is the source of truth (the browser's
 * report isn't trusted): every part must be present with its exact expected size. Then the
 * finished object's size and first bytes are checked before the uploaded_files row (ownership)
 * is written. A file that fails a check is deleted and the reservation released.
 *
 * Safe to repeat: after completion it returns the same asset; if the bucket finished but the
 * database write failed, a retry picks up the existing object, re-checks it and records it.
 */
export async function completeDirectUpload(db: Db, store: MediaStore, uid: string, uploadId: string, now = new Date()): Promise<DirectCompleteResult> {
  const direct = store.direct;
  if (!direct) return { status: 400, body: { error: 'Direct uploads are not enabled.' } };
  const session = await findSession(db, uid, uploadId);
  if (!session) return { status: 404, body: { error: 'Upload not found.' } };
  if (session.status === 'complete') {
    return { status: 200, body: { completed: true, received: session.totalSize, asset: assetFor(session.storageKey, session.fileName, session.mimeType, session.totalSize) } };
  }
  if (!isLive(session, now) || !session.sessionRef) return expired;
  const ref = openSessionRef(session.sessionRef);
  if (!ref) {
    await markAborted(db, session.id, now);
    return expired;
  }

  const reject = async (status: 400 | 415, error: string, reason: string) => {
    await store.abortUpload(ref, session.storageKey).catch(() => undefined);
    await store.delete(session.storageKey).catch(() => undefined);
    await markAborted(db, session.id, now);
    opsEvent('upload.rejected', { reason, size: session.totalSize }, 'WARNING');
    return { status, body: { error } };
  };

  const partSize = direct.partSize(session.totalSize);
  const count = partCountFor(session.totalSize, partSize);
  let parts: { partNumber: number; etag: string; size: number }[] | null;
  try {
    // Ascending part order is required by CompleteMultipartUpload.
    parts = (await direct.listParts(session.storageKey, ref)).sort((a, b) => a.partNumber - b.partNumber);
  } catch (err) {
    if (!(err instanceof StorageError && err.code === 'NOT_FOUND')) return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
    parts = null; // the multipart upload is gone: either completed by an earlier call, or expired
  }

  if (parts) {
    const have = new Map(parts.map((p) => [p.partNumber, p]));
    const missing: number[] = [];
    for (let n = 1; n <= count; n++) if (!have.has(n)) missing.push(n);
    if (parts.some((p) => p.partNumber > count)) return reject(400, 'This upload has more data than the file it was started for.', 'extra_parts');
    if (missing.length) {
      await db.update(uploadSessions).set({ received: parts.reduce((t, p) => t + p.size, 0), updatedAt: now }).where(eq(uploadSessions.id, session.id));
      return { status: 409, body: { error: 'Some parts are missing.', missingParts: missing.slice(0, 1000) } };
    }
    if (parts.some((p) => p.size !== expectedPartSize(p.partNumber, session.totalSize, partSize))) {
      return reject(400, 'This upload doesn’t match the file it was started for.', 'part_size');
    }
    try {
      await direct.completeUpload(session.storageKey, ref, parts.map(({ partNumber, etag }) => ({ partNumber, etag })));
    } catch (err) {
      if (!(err instanceof StorageError && err.code === 'NOT_FOUND')) return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
      // A concurrent call completed it; fall through to the object checks.
    }
  }

  let info: { size: number } | null;
  try {
    info = await store.stat(session.storageKey);
  } catch {
    return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
  }
  if (!info) {
    await markAborted(db, session.id, now);
    return expired;
  }
  if (info.size !== session.totalSize) return reject(400, 'This upload doesn’t match the file it was started for.', 'object_size');
  let head: Uint8Array;
  try {
    head = await direct.readHead(session.storageKey, SNIFF_BYTES);
  } catch {
    return { status: 503, body: { error: 'Storage is unavailable. Try again shortly.' } };
  }
  if (!contentMatches(session.mimeType, head)) {
    return reject(415, `“${session.fileName}” doesn’t look like a valid ${session.mimeType.split('/')[0]} file.`, 'content_type');
  }
  return finalize(db, uid, { ...session, received: session.totalSize }, now);
}

/**
 * Explicit cancel from the browser: aborts the storage upload, removes any bytes, and releases
 * the reservation. Completed uploads are left alone (delete the file through the app instead).
 */
export async function cancelUpload(db: Db, store: MediaStore, uid: string, uploadId: string, now = new Date()): Promise<{ cancelled: boolean }> {
  const session = await findSession(db, uid, uploadId);
  if (!session || session.status !== 'active') return { cancelled: false };
  const ref = session.sessionRef ? openSessionRef(session.sessionRef) : null;
  if (ref) await store.abortUpload(ref, session.storageKey).catch(() => undefined);
  const [owned] = await db.select({ id: uploadedFiles.id }).from(uploadedFiles).where(eq(uploadedFiles.storageKey, session.storageKey)).limit(1);
  if (!owned) await store.delete(session.storageKey).catch(() => undefined);
  await markAborted(db, session.id, now);
  return { cancelled: true };
}

/* ------------------------------------------------------------------ */
/* Bucket orphan sweep (R2)                                             */
/* ------------------------------------------------------------------ */

export interface SweepOptions {
  /** Unfinished multipart uploads older than this with no live session are aborted. Default 2 days. */
  abandonedUploadAgeMs?: number;
  /** Objects older than this with no database row are deleted. Default 7 days (time to notice a bad restore). */
  orphanMinAgeMs?: number;
  /** Objects examined per run. */
  scanLimit?: number;
  /**
   * Refuse to delete anything when more than this share of the scanned objects look orphaned
   * (and there are more than a handful): that pattern means the app is pointed at the wrong or
   * an empty/restored database, not that creators abandoned files.
   */
  maxOrphanShare?: number;
}

export interface SweepResult {
  uploadsAborted: number;
  objectsScanned: number;
  orphansFound: number;
  orphansDeleted: number;
  /** Set when the safety check stopped deletion. */
  refused?: 'orphan_share';
  unknownKeys: number;
}

const DAY = 86_400_000;

export function sweepOptionsFromEnv(env: Record<string, string | undefined> = process.env): SweepOptions | null {
  if ((env.STORAGE_ORPHAN_SWEEP ?? '').toLowerCase() === 'off') return null;
  const days = Number(env.STORAGE_ORPHAN_MIN_AGE_DAYS);
  return { orphanMinAgeMs: (Number.isFinite(days) && days >= 2 ? days : 7) * DAY };
}

/**
 * Finds what the database doesn't know about. Deletes only after the database answered: if a
 * query fails, this throws before deleting anything in that batch (a transient database error
 * never looks like "no row").
 */
export async function sweepBucketOrphans(db: Db, store: MediaStore, opts: SweepOptions = {}, now = new Date()): Promise<SweepResult> {
  const inv = store.inventory;
  const result: SweepResult = { uploadsAborted: 0, objectsScanned: 0, orphansFound: 0, orphansDeleted: 0, unknownKeys: 0 };
  if (!inv) return result;

  // 1. Multipart uploads nobody will finish (session expired, aborted, or never recorded).
  const uploads = await inv.listMultipartUploads({ olderThan: new Date(now.getTime() - (opts.abandonedUploadAgeMs ?? 2 * DAY)), limit: 500 });
  for (let i = 0; i < uploads.length; i += 200) {
    const batch = uploads.slice(i, i + 200);
    const live = await db
      .select({ key: uploadSessions.storageKey })
      .from(uploadSessions)
      .where(and(inArray(uploadSessions.storageKey, batch.map((u) => u.key)), eq(uploadSessions.status, 'active'), sql`${uploadSessions.expiresAt} > ${now.toISOString()}::timestamp`));
    const liveKeys = new Set(live.map((r) => r.key));
    for (const u of batch) {
      if (liveKeys.has(u.key)) continue;
      await store.abortUpload(u.uploadId, u.key);
      result.uploadsAborted += 1;
    }
  }

  // 2. Finished objects with no uploaded_files row and no live session.
  const objects = await inv.listObjects({ olderThan: new Date(now.getTime() - (opts.orphanMinAgeMs ?? 7 * DAY)), limit: opts.scanLimit ?? 2000 });
  result.objectsScanned = objects.length;
  const candidates = objects.filter((o) => {
    const ok = isStorageKey(o.key);
    if (!ok) result.unknownKeys += 1; // not created by Backlot: reported, never deleted
    return ok;
  });
  const orphans: string[] = [];
  for (let i = 0; i < candidates.length; i += 200) {
    const keys = candidates.slice(i, i + 200).map((o) => o.key);
    const files = await db.select({ key: uploadedFiles.storageKey }).from(uploadedFiles).where(inArray(uploadedFiles.storageKey, keys));
    const sessions = await db
      .select({ key: uploadSessions.storageKey })
      .from(uploadSessions)
      .where(and(inArray(uploadSessions.storageKey, keys), eq(uploadSessions.status, 'active')));
    const known = new Set([...files, ...sessions].map((r) => r.key));
    for (const k of keys) if (!known.has(k)) orphans.push(k);
  }
  result.orphansFound = orphans.length;
  const share = opts.maxOrphanShare ?? 0.5;
  if (orphans.length > 10 && orphans.length > candidates.length * share) {
    result.refused = 'orphan_share';
    opsEvent('storage.orphan_sweep_refused', { scanned: candidates.length, orphans: orphans.length }, 'CRITICAL');
    return result;
  }
  for (const k of orphans) {
    await store.delete(k);
    result.orphansDeleted += 1;
  }
  return result;
}
