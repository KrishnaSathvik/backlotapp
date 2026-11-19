import fsp from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createR2Client } from '../storage/r2.ts';
import { readStorageConfig, UPLOAD_ROOT } from '../storage/index.ts';

/**
 * Account-deletion ledger: a record of deletion requests kept OUTSIDE the database.
 *
 * Why: restoring an older database snapshot brings back the rows of accounts deleted after
 * that snapshot, and the restored account_deletions table doesn't know about them. The ledger
 * survives the restore, so the restore procedure can lock and re-delete every account Backlot
 * was asked to delete (scripts/reapply-deletions-after-restore.ts). A missing Firebase user is
 * never treated as proof on its own.
 *
 * - Where: the private R2 bucket, under its own prefix (default `ledger/account-deletions/`),
 *   separate from creator media (`uploads/`), so the media orphan sweep never touches it.
 *   Locally: .uploads/.ledger/.
 * - What: one small JSON object per account: { uid, jobId, requestedAt }. No email, no content.
 * - When: written when the creator asks (best effort) and again as the deletion job's first
 *   step, which retries until it succeeds; so every job that runs has a ledger entry.
 * - How long: LEDGER_RETENTION_DAYS (default 90) after the request, which must stay longer than
 *   the oldest restorable backup plus restore lead time. Removed by the daily maintenance job.
 */

export interface LedgerEntry {
  uid: string;
  jobId: number;
  requestedAt: string;
}

export interface DeletionLedger {
  readonly kind: 'r2' | 'local';
  record(entry: LedgerEntry): Promise<void>;
  list(): Promise<LedgerEntry[]>;
  /** Removes entries requested before `before`. Returns how many. */
  purge(before: Date): Promise<number>;
}

const entryName = (uid: string) => `${encodeURIComponent(uid)}.json`;

function parse(raw: string): LedgerEntry | null {
  try {
    const v = JSON.parse(raw) as Partial<LedgerEntry>;
    return typeof v.uid === 'string' && typeof v.requestedAt === 'string' ? { uid: v.uid, jobId: Number(v.jobId ?? 0), requestedAt: v.requestedAt } : null;
  } catch {
    return null;
  }
}

export function createR2Ledger(client: S3Client, bucket: string, prefix: string): DeletionLedger {
  const listKeys = async () => {
    const keys: { key: string }[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
      for (const o of res.Contents ?? []) if (o.Key?.endsWith('.json')) keys.push({ key: o.Key });
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys;
  };
  const read = async (key: string) => {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return parse((await res.Body?.transformToString()) ?? '');
  };
  return {
    kind: 'r2',
    async record(entry) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${entryName(entry.uid)}`, Body: JSON.stringify(entry), ContentType: 'application/json' })
      );
    },
    async list() {
      const out: LedgerEntry[] = [];
      for (const { key } of await listKeys()) {
        const e = await read(key);
        if (e) out.push(e);
      }
      return out;
    },
    async purge(before) {
      let n = 0;
      for (const { key } of await listKeys()) {
        const e = await read(key);
        if (e && new Date(e.requestedAt).getTime() < before.getTime()) {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          n += 1;
        }
      }
      return n;
    },
  };
}

export function createLocalLedger(dir: string): DeletionLedger {
  return {
    kind: 'local',
    async record(entry) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, entryName(entry.uid)), JSON.stringify(entry));
    },
    async list() {
      const names = await fsp.readdir(dir).catch(() => [] as string[]);
      const out: LedgerEntry[] = [];
      for (const n of names.filter((x) => x.endsWith('.json'))) {
        const e = parse(await fsp.readFile(path.join(dir, n), 'utf8'));
        if (e) out.push(e);
      }
      return out;
    },
    async purge(before) {
      let n = 0;
      for (const e of await this.list()) {
        if (new Date(e.requestedAt).getTime() < before.getTime()) {
          await fsp.rm(path.join(dir, entryName(e.uid)), { force: true });
          n += 1;
        }
      }
      return n;
    },
  };
}

type Env = Record<string, string | undefined>;

export function ledgerPrefixFromEnv(env: Env = process.env): string {
  const p = env.R2_LEDGER_PREFIX?.trim() || 'ledger/account-deletions/';
  return p.endsWith('/') ? p : `${p}/`;
}

export function ledgerRetentionDaysFromEnv(env: Env = process.env): number {
  const n = Number(env.LEDGER_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 30 && n <= 3650 ? n : 90;
}

declare global {
  var _backlotDeletionLedger: DeletionLedger | null | undefined;
}

/** The configured ledger, or null when the storage backend has none (legacy Cloud Storage). */
export function getDeletionLedger(env: Env = process.env): DeletionLedger | null {
  if (globalThis._backlotDeletionLedger !== undefined) return globalThis._backlotDeletionLedger;
  const cfg = readStorageConfig(env);
  let ledger: DeletionLedger | null = null;
  if (cfg.backend === 'r2') {
    ledger = createR2Ledger(createR2Client(cfg), env.R2_LEDGER_BUCKET?.trim() || cfg.bucket, ledgerPrefixFromEnv(env));
  } else if (cfg.backend === 'local') {
    ledger = createLocalLedger(path.join(UPLOAD_ROOT, '.ledger'));
  }
  globalThis._backlotDeletionLedger = ledger;
  return ledger;
}
