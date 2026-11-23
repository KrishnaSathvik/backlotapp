import { after, NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { deletionFor, requestAccountDeletion, softDeleteDaysFromEnv, startDeletionSoon, statusView } from '@/src/lib/account/deletion.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { supabaseIdentity } from '@/src/lib/account/supabase-identity.ts';
import { getDeletionLedger } from '@/src/lib/account/ledger.ts';
import { BadRequest, errorResponse, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';

/**
 * Self-serve account deletion (see docs/ACCOUNT_DELETION.md).
 *
 * POST { confirm: "DELETE" } starts it. The creator must have signed in within the last
 * 10 minutes (the app re-prompts Google sign-in first). Idempotent: repeating the request
 * returns the same deletion (with a new status token; only the latest link works). The account
 * is locked immediately. The job then starts right after the response (Next.js after(): it waits
 * out the 3-minute grace period and runs within this function's maxDuration). That start is best
 * effort; the hourly recovery run (Vercel Cron → /api/internal/account-deletions) resumes any job
 * it doesn't finish. Progress lives only in account_deletions, so nothing is lost if it's cut short.
 *
 * The response carries `statusToken` for the signed-out status page. It's returned only here,
 * to a freshly signed-in creator, and only its hash is stored.
 *
 * GET returns this account's deletion progress (or null), without a token.
 */

export const runtime = 'nodejs';
// Grace period (3 min) + one bounded run (90 s) for the prompt start in after().
export const maxDuration = 300;

const FRESH_SIGN_IN_S = 10 * 60;
const CONFIRM = 'DELETE';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request, { allowDeleting: true });
  if (!user) return response;
  const row = await deletionFor(db, user.uid);
  return NextResponse.json(
    { deletion: row ? statusView(row, softDeleteDaysFromEnv()) : null },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request, { allowDeleting: true });
  if (!user) return response;
  try {
    const body = await readJson(request);
    if (body.confirm !== CONFIRM) throw new BadRequest(`Type ${CONFIRM} to confirm.`);

    // Also required on a repeat request: it issues a new status link and retires the old one.
    if (Date.now() / 1000 - user.authTime > FRESH_SIGN_IN_S) {
      return NextResponse.json(
        { error: 'For your security, sign in again to delete your account.', code: 'reauth_required' },
        { status: 401, headers: noStore }
      );
    }

    const { row, statusToken, created } = await requestAccountDeletion(db, user.uid);
    // Stop new sign-in tokens now. The job's first step repeats this, so a failure here is fine
    // (for example when Supabase Auth is briefly unreachable).
    await supabaseIdentity.revokeSessions(user.uid).catch((err) =>
      opsEvent('account_deletion.revoke_deferred', { job: row.id, error: errorKind(err) }, 'NOTICE')
    );
    // Out-of-database record of the request (uid and dates, never the email), so it can be
    // re-applied after a database restore (docs/BACKUPS.md). The job's first step writes it again
    // and retries until it succeeds, so a failure here only delays it.
    if (created) {
      opsEvent('account_deletion.requested', { job: row.id, uid: user.uid }, 'NOTICE');
      await getDeletionLedger()
        ?.record({ uid: user.uid, jobId: row.id, requestedAt: row.requestedAt.toISOString() })
        .catch((err) => opsEvent('account_deletion.ledger_deferred', { job: row.id, error: errorKind(err) }, 'WARNING'));
    }
    if (row.status !== 'completed') {
      after(() =>
        startDeletionSoon({ db, store: getMediaStore(), identity: supabaseIdentity, ledger: getDeletionLedger() }, row).then((r) => {
          if (r) opsEvent('account_deletion.prompt_start', { job: row.id, ...r });
        })
      );
    }
    return NextResponse.json(
      { deletion: { statusToken, ...statusView(row, softDeleteDaysFromEnv()) } },
      { status: created ? 202 : 200, headers: noStore }
    );
  } catch (error) {
    return errorResponse(error, 'Unable to start account deletion. Nothing was deleted. Try again.');
  }
}
