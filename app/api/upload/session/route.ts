import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { isAccountLockedError } from '@/src/db/account-guard.ts';
import { accountLockedResponse } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { cancelUpload, startDirectUpload, uploadPolicyFromEnv } from '@/src/lib/storage/uploads.ts';
import { resolveMimeType, validateUpload } from '@/src/lib/upload-limits.ts';

/**
 * Direct uploads, step 1 (docs/STORAGE.md).
 *
 * POST { uploadId, fileName, mimeType, size } starts an upload, or resumes the same uploadId:
 * checks the file's declared type and size against the limits, reserves the creator's quota
 * atomically, opens a private multipart upload in R2, and returns
 * { mode: 'direct', partSize, partCount, uploadedParts }. With a store that doesn't take direct
 * uploads (local development) it returns { mode: 'chunked' } and the browser uses
 * /api/upload/chunk instead.
 *
 * DELETE ?uploadId=… cancels an unfinished upload and releases its reservation.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: noStore });
const isUploadId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(v);

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isUploadId(body.uploadId)) return bad('Invalid upload id.');
    const fileName = String(body.fileName ?? 'upload').replace(/[\\/\0\r\n]/g, '_').slice(0, 200) || 'upload';
    const totalSize = Number(body.size);
    if (!Number.isSafeInteger(totalSize)) return bad('Invalid file size.');
    const mimeType = resolveMimeType(fileName, String(body.mimeType ?? ''));
    const problem = validateUpload(fileName, mimeType, totalSize);
    if (problem) return bad(problem, 413);

    const result = await startDirectUpload(db, getMediaStore(), user.uid, { uploadId: body.uploadId, fileName, mimeType, totalSize }, uploadPolicyFromEnv());
    return NextResponse.json(result.body, { status: result.status, headers: noStore });
  } catch (error) {
    if (isAccountLockedError(error)) return accountLockedResponse();
    opsEvent('upload.failed', { stage: 'start', error: errorKind(error) }, 'ERROR');
    return bad('Unable to start the upload.', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const uploadId = request.nextUrl.searchParams.get('uploadId');
  if (!isUploadId(uploadId)) return bad('Invalid upload id.');
  try {
    return NextResponse.json(await cancelUpload(db, getMediaStore(), user.uid, uploadId), { headers: noStore });
  } catch (error) {
    if (isAccountLockedError(error)) return accountLockedResponse();
    opsEvent('upload.failed', { stage: 'cancel', error: errorKind(error) }, 'ERROR');
    return bad('Unable to cancel the upload.', 500);
  }
}
