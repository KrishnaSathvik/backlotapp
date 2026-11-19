import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { purgeDeletionRecords, recordDaysFromEnv } from '@/src/lib/account/deletion.ts';
import { authorizeInternal } from '@/src/lib/internal-auth.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { cleanupOptionsFromEnv, cleanupSlateData } from '@/src/lib/slate/cleanup.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { cleanupUploads, sweepBucketOrphans, sweepOptionsFromEnv } from '@/src/lib/storage/uploads.ts';
import { getDeletionLedger, ledgerRetentionDaysFromEnv } from '@/src/lib/account/ledger.ts';

/**
 * Daily maintenance (scheduled job 2 of 2), authenticated as job "maintenance"
 * (src/lib/internal-auth.ts). Separate from the deletion worker, with its own credentials.
 *
 * - Expires pending Slate suggestions and removes old closed ones (SLATE_ACTION_RETENTION_DAYS).
 * - Prunes audit events (SLATE_AUDIT_RETENTION_DAYS) and old usage leases.
 * - Cancels abandoned uploads and deletes the objects they left behind.
 * - R2: aborts multipart uploads nobody will finish and deletes objects with no database row
 *   (with a safety stop, see sweepBucketOrphans). STORAGE_ORPHAN_SWEEP=off disables it.
 * - Removes completed account-deletion records after ACCOUNT_DELETION_RECORD_DAYS, and deletion
 *   ledger entries after LEDGER_RETENTION_DAYS.
 *
 * Each part runs on its own, so one failing doesn't stop the others. Returns counts only.
 * Everything finishes before the response; nothing is left running in the background.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Bounded work (at most 500 abandoned uploads and 2,000 bucket objects per run); 180 s is ample.
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const denied = await authorizeInternal(request, 'maintenance');
  if (denied) return denied;

  const out: Record<string, unknown> = {};
  const failed: string[] = [];
  const part = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (error) {
      failed.push(name);
      opsEvent('maintenance.part_failed', { part: name, error: errorKind(error) }, 'ERROR');
    }
  };

  await part('slate', () => cleanupSlateData(db, cleanupOptionsFromEnv()));
  await part('uploads', () => cleanupUploads(db, getMediaStore()));
  const sweep = sweepOptionsFromEnv();
  if (sweep) await part('bucket', () => sweepBucketOrphans(db, getMediaStore(), sweep));
  await part('deletionRecordsPurged', () => purgeDeletionRecords(db, { recordDays: recordDaysFromEnv() }));
  const ledger = getDeletionLedger();
  if (ledger) await part('ledgerPurged', () => ledger.purge(new Date(Date.now() - ledgerRetentionDaysFromEnv() * 86_400_000)));

  const slate = out.slate as { expired?: number; deletedActions?: number; deletedEvents?: number; deletedLeases?: number } | undefined;
  const uploads = out.uploads as { aborted?: number; objectsDeleted?: number; forgotten?: number } | undefined;
  const bucket = out.bucket as { uploadsAborted?: number; orphansDeleted?: number; refused?: string } | undefined;
  opsEvent(
    'maintenance.run',
    {
      slate_expired: slate?.expired,
      slate_actions_deleted: slate?.deletedActions,
      slate_events_deleted: slate?.deletedEvents,
      slate_leases_deleted: slate?.deletedLeases,
      uploads_aborted: uploads?.aborted,
      orphan_objects_deleted: uploads?.objectsDeleted,
      upload_sessions_forgotten: uploads?.forgotten,
      bucket_uploads_aborted: bucket?.uploadsAborted,
      bucket_orphans_deleted: bucket?.orphansDeleted,
      bucket_sweep_refused: bucket?.refused ?? null,
      deletion_records_purged: out.deletionRecordsPurged as number | undefined,
      ledger_entries_purged: out.ledgerPurged as number | undefined,
      failed: failed.join(',') || null,
    },
    failed.length ? 'ERROR' : 'INFO'
  );
  return NextResponse.json({ ...out, failed }, { status: failed.length ? 503 : 200 });
}
