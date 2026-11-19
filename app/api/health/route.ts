import { sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { checkProductionConfig } from '@/src/lib/config-check.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';

/**
 * Health checks (no sign-in; no details that help an attacker).
 *
 * - GET /api/health          liveness: the process is serving. No dependencies touched.
 * - GET /api/health?ready=1  readiness: configuration is valid, the database answers and the
 *                            account-deletion table exists (every signed-in request needs it).
 *                            503 with the names of the failed checks, never values.
 *
 * Use liveness for Cloud Run's startup/liveness probes (a database blip shouldn't restart every
 * instance) and readiness for an uptime check and after each deploy.
 */
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  if (!request.nextUrl.searchParams.has('ready')) return NextResponse.json({ status: 'ok' }, { headers: noStore });

  const failed: string[] = [];
  if (checkProductionConfig().errors.length) failed.push('config');
  const started = Date.now();
  try {
    await db.execute(sql`select 1 from account_deletions limit 1`);
  } catch (error) {
    failed.push('database');
    opsEvent('db.unavailable', { route: 'health', error: errorKind(error) }, 'ERROR');
  }
  const body = { status: failed.length ? 'unavailable' : 'ok', failed, dbMs: Date.now() - started };
  return NextResponse.json(body, { status: failed.length ? 503 : 200, headers: noStore });
}
