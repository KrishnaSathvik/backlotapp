import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { isAccountLockedError } from '@/src/db/account-guard.ts';
import { accountLockedResponse } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { completeDirectUpload } from '@/src/lib/storage/uploads.ts';

/**
 * Direct uploads, step 3. POST { uploadId } completes the upload from R2's own list of parts
 * (the browser's report isn't trusted), checks the finished object's size and real type, and
 * only then records it as the creator's file. 409 { missingParts } asks the browser to upload
 * those parts and call again. Safe to repeat.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const body = (await request.json().catch(() => null)) as { uploadId?: unknown } | null;
    const uploadId = typeof body?.uploadId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.uploadId) ? body.uploadId : null;
    if (!uploadId) return NextResponse.json({ error: 'Invalid upload id.' }, { status: 400, headers: noStore });
    const result = await completeDirectUpload(db, getMediaStore(), user.uid, uploadId);
    return NextResponse.json(result.body, { status: result.status, headers: noStore });
  } catch (error) {
    // The account was locked for deletion mid-upload: the guard refused the file row. The
    // deletion job aborts the upload and deletes the object.
    if (isAccountLockedError(error)) return accountLockedResponse();
    opsEvent('upload.failed', { stage: 'complete', error: errorKind(error) }, 'ERROR');
    return NextResponse.json({ error: 'Unable to finish the upload.' }, { status: 500, headers: noStore });
  }
}
