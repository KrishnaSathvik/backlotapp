import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { processDueDeletions } from '@/src/lib/account/deletion.ts';
import { firebaseIdentity } from '@/src/lib/account/firebase-identity.ts';
import { getDeletionLedger } from '@/src/lib/account/ledger.ts';
import { authorizeInternal } from '@/src/lib/internal-auth.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';

/**
 * Account-deletion worker (scheduled job 1 of 2). An external scheduler (the Cloudflare Worker
 * in ops/scheduler, or any HTTPS cron) calls it every 5 minutes, authenticated as the deletion
 * worker (src/lib/internal-auth.ts, job "deletions"). Runs due jobs for up to 90 s, inside the
 * function's 120 s limit (vercel.json), so a run always ends before the next one starts; anything
 * unfinished continues on the next call. Each job is
 * leased, so overlapping calls never run the same job twice, and all work happens before the
 * response (nothing runs after it returns). Returns counts only.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const BUDGET_MS = 90_000;

export async function POST(request: NextRequest) {
  const denied = await authorizeInternal(request, 'deletions');
  if (denied) return denied;
  const started = Date.now();
  try {
    const result = await processDueDeletions({ db, store: getMediaStore(), identity: firebaseIdentity, ledger: getDeletionLedger() }, { budgetMs: BUDGET_MS });
    if (result.completed || result.retrying) opsEvent('account_deletion.worker_run', { ...result, ms: Date.now() - started });
    return NextResponse.json(result);
  } catch (error) {
    opsEvent('account_deletion.worker_failed', { error: errorKind(error) }, 'ERROR');
    return NextResponse.json({ error: 'Worker failed.' }, { status: 503 });
  }
}
