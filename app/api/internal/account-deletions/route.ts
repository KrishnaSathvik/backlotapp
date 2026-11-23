import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { processDueDeletions, purgeDeletionRecords, recordDaysFromEnv } from '@/src/lib/account/deletion.ts';
import { supabaseIdentity } from '@/src/lib/account/supabase-identity.ts';
import { getDeletionLedger, ledgerRetentionDaysFromEnv } from '@/src/lib/account/ledger.ts';
import { authorizeInternal } from '@/src/lib/internal-auth.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';

/**
 * Account-deletion recovery run. Vercel Cron calls it hourly (GET, vercel.json "crons") with
 * `Authorization: Bearer $CRON_SECRET`; POST with the same credential runs it by hand. Most jobs
 * finish in the prompt start right after the request (app/api/account/deletion); this resumes
 * any that were cut short or are due for a retry. Runs due jobs for up to 90 s, inside the 120 s
 * limit, so a run ends before the next one starts; anything unfinished continues next time.
 * Each job is leased, so overlapping runs never process the same job twice. It also removes
 * completed deletion records after ACCOUNT_DELETION_RECORD_DAYS and ledger entries after
 * LEDGER_RETENTION_DAYS (the maintenance job does too, but it isn't scheduled). Returns counts only.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const BUDGET_MS = 90_000;

async function run(request: NextRequest) {
  const denied = await authorizeInternal(request, 'deletions');
  if (denied) return denied;
  const started = Date.now();
  try {
    const ledger = getDeletionLedger();
    const result = await processDueDeletions({ db, store: getMediaStore(), identity: supabaseIdentity, ledger }, { budgetMs: BUDGET_MS });
    // Retention purges: failures are logged and retried next hour; they never fail the run.
    const recordsPurged = await purgeDeletionRecords(db, { recordDays: recordDaysFromEnv() }).catch((err) => {
      opsEvent('account_deletion.purge_failed', { part: 'records', error: errorKind(err) }, 'WARNING');
      return 0;
    });
    const ledgerPurged = ledger
      ? await ledger.purge(new Date(Date.now() - ledgerRetentionDaysFromEnv() * 86_400_000)).catch((err) => {
          opsEvent('account_deletion.purge_failed', { part: 'ledger', error: errorKind(err) }, 'WARNING');
          return 0;
        })
      : 0;
    const counts = { ...result, recordsPurged, ledgerPurged };
    if (result.completed || result.retrying || recordsPurged || ledgerPurged) opsEvent('account_deletion.worker_run', { ...counts, ms: Date.now() - started });
    return NextResponse.json(counts);
  } catch (error) {
    opsEvent('account_deletion.worker_failed', { error: errorKind(error) }, 'ERROR');
    return NextResponse.json({ error: 'Worker failed.' }, { status: 503 });
  }
}

export const GET = run;
export const POST = run;
