import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { deletionByStatusToken, recordDaysFromEnv, softDeleteDaysFromEnv, statusView } from '@/src/lib/account/deletion.ts';
import { opsEvent } from '@/src/lib/ops-log.ts';

/**
 * POST { token }: deletion progress for the status page (/account/deleted#<token>). Needs no
 * sign-in, because the sign-in itself is deleted.
 *
 * - The token is 256 random bits, given only to the account that asked. Only its hash is stored.
 * - It's sent in the body (the page keeps it in the URL fragment), so it never appears in
 *   request logs, proxies or Referer headers.
 * - It stops working once the completed record is older than ACCOUNT_DELETION_RECORD_DAYS.
 * - The response holds progress flags and dates only: no uid, email, job id, error or content.
 *   Unknown, malformed and expired tokens get the same 404.
 */
const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === 'string' ? body.token : '';
  const row = await deletionByStatusToken(db, token, { recordDays: recordDaysFromEnv() }).catch(() => undefined);
  if (row === undefined) {
    opsEvent('db.unavailable', { route: 'account_deletion_status' }, 'ERROR');
    // The account lock lives in the same database, so nothing can use the account meanwhile.
    return NextResponse.json(
      { error: 'Progress can’t be checked right now. Your account stays locked, and deletion continues automatically once the service is back. This page keeps checking.' },
      { status: 503, headers: noStore }
    );
  }
  if (!row) return NextResponse.json({ error: 'No deletion found for this link.' }, { status: 404, headers: noStore });
  return NextResponse.json(statusView(row, softDeleteDaysFromEnv()), { headers: noStore });
}
