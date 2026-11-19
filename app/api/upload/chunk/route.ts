import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { isAccountLockedError } from '@/src/db/account-guard.ts';
import { accountLockedResponse } from '@/src/lib/api-utils.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { receiveChunk, uploadPolicyFromEnv, uploadProgress } from '@/src/lib/storage/uploads.ts';
import { MAX_CHUNK_BYTES, resolveMimeType, validateUpload } from '@/src/lib/upload-limits.ts';

/**
 * Chunked, resumable upload through the server. Used for the local development store (and the
 * legacy Cloud Storage store). In production (R2) the browser uploads straight to the bucket via
 * /api/upload/session, /parts and /complete, and this route refuses new uploads.
 *
 * Headers per chunk:
 *   x-upload-id     client-generated UUID for this upload
 *   x-chunk-offset  byte offset of this chunk in the file
 *   x-total-size    total file size in bytes
 *   x-file-name     URI-encoded original file name
 *   x-mime-type     file type
 *
 * Each chunk (2 MB) is forwarded to storage as it arrives; no request holds a whole file.
 * A retried chunk is acknowledged without being written twice; an out-of-order chunk gets 409
 * with the byte count to resume from. GET with x-upload-id returns progress.
 */

export const runtime = 'nodejs';

function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

function readUploadId(request: NextRequest): string | null {
  const id = request.headers.get('x-upload-id') ?? '';
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : null;
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const uploadId = readUploadId(request);
  if (!uploadId) return bad('Invalid upload id.');
  return NextResponse.json({ received: await uploadProgress(db, user.uid, uploadId) });
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const uploadId = readUploadId(request);
    if (!uploadId) return bad('Invalid upload id.');

    const offset = Number(request.headers.get('x-chunk-offset'));
    const totalSize = Number(request.headers.get('x-total-size'));
    let fileName = 'upload';
    try {
      fileName = decodeURIComponent(request.headers.get('x-file-name') || 'upload')
        .replace(/[\\/\0]/g, '_')
        .slice(0, 200);
    } catch {
      return bad('Invalid file name.');
    }
    const mimeType = resolveMimeType(fileName, request.headers.get('x-mime-type') || '');

    if (!Number.isSafeInteger(offset) || offset < 0) return bad('Invalid chunk offset.');
    if (!Number.isSafeInteger(totalSize)) return bad('Invalid file size.');
    const problem = validateUpload(fileName, mimeType, totalSize);
    if (problem) return bad(problem, 413);

    const declaredLength = Number(request.headers.get('content-length') || '0');
    if (declaredLength > MAX_CHUNK_BYTES) return bad('Chunk is too large.', 413);
    const chunk = new Uint8Array(await request.arrayBuffer());
    if (chunk.length === 0 || chunk.length > MAX_CHUNK_BYTES) return bad('Invalid chunk size.', 413);
    if (offset + chunk.length > totalSize) return bad('Chunk runs past the end of the file.');

    const result = await receiveChunk(db, getMediaStore(), user.uid, { uploadId, offset, totalSize, fileName, mimeType, chunk }, uploadPolicyFromEnv());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // A chunk that was in flight when deletion started: the write guard refused it. The
    // deletion job removes the session and any partial object.
    if (isAccountLockedError(error)) return accountLockedResponse();
    opsEvent('upload.failed', { error: errorKind(error) }, 'ERROR');
    return bad('Unable to upload file chunk.', 500);
  }
}
