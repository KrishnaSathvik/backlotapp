import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/src/db/index.ts';
import { uploadedFiles } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { UPLOAD_ROOT } from '@/src/lib/api-utils.ts';
import {
  MAX_CHUNK_BYTES,
  resolveMimeType,
  validateUpload,
} from '@/src/lib/upload-limits.ts';

/**
 * Chunked, resumable upload.
 *
 * Headers per chunk:
 *   x-upload-id     client-generated UUID for this upload
 *   x-chunk-offset  byte offset of this chunk in the file
 *   x-total-size    total file size in bytes
 *   x-file-name     URI-encoded original file name
 *   x-mime-type     file type
 *
 * The server appends only when the offset equals the bytes already received, so
 * a retried chunk is acknowledged without being written twice. GET with the same
 * x-upload-id returns how many bytes have been received, for resuming.
 */

const TEMP_ROOT = path.join(UPLOAD_ROOT, '.partial');
const STALE_PART_MS = 24 * 60 * 60 * 1000;
let lastSweep = 0;

function userTempDir(uid: string) {
  const hash = crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return path.join(TEMP_ROOT, hash);
}

function partPath(uid: string, uploadId: string) {
  return path.join(userTempDir(uid), `${uploadId}.part`);
}

function readUploadId(request: NextRequest): string | null {
  const id = request.headers.get('x-upload-id') ?? '';
  return /^[a-zA-Z0-9-]{8,64}$/.test(id) ? id : null;
}

async function receivedBytes(file: string): Promise<number> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return 0;
  }
}

/** Removes abandoned partial uploads, at most once an hour. */
async function sweepStaleParts() {
  const now = Date.now();
  if (now - lastSweep < 60 * 60 * 1000) return;
  lastSweep = now;
  try {
    for (const dir of await fs.readdir(TEMP_ROOT)) {
      const full = path.join(TEMP_ROOT, dir);
      for (const file of await fs.readdir(full)) {
        const p = path.join(full, file);
        const stat = await fs.stat(p);
        if (now - stat.mtimeMs > STALE_PART_MS) await fs.rm(p, { force: true });
      }
    }
  } catch {
    // Nothing to sweep yet.
  }
}

function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const uploadId = readUploadId(request);
  if (!uploadId) return bad('Invalid upload id.');
  return NextResponse.json({ received: await receivedBytes(partPath(user.uid, uploadId)) });
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

    const chunk = Buffer.from(await request.arrayBuffer());
    if (chunk.length === 0 || chunk.length > MAX_CHUNK_BYTES) return bad('Invalid chunk size.', 413);
    if (offset + chunk.length > totalSize) return bad('Chunk runs past the end of the file.');

    if (offset === 0) await sweepStaleParts();
    await fs.mkdir(userTempDir(user.uid), { recursive: true });
    const part = partPath(user.uid, uploadId);
    const received = await receivedBytes(part);

    if (offset + chunk.length <= received) {
      // Already have this chunk (the client retried after a lost response).
    } else if (offset === received) {
      await fs.appendFile(part, chunk);
    } else {
      return bad('Chunk out of order.', 409, { received });
    }

    const nowReceived = await receivedBytes(part);
    if (nowReceived < totalSize) {
      return NextResponse.json({ completed: false, received: nowReceived });
    }

    // Final name is generated here, so a client can never overwrite an existing file.
    const ext = path.extname(fileName).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10).toLowerCase();
    const storageKey = `${crypto.randomUUID()}${ext}`;
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });
    await fs.rename(part, path.join(UPLOAD_ROOT, storageKey));

    await db.insert(uploadedFiles).values({
      userUid: user.uid,
      storageKey,
      fileName,
      mimeType,
      sizeBytes: totalSize,
    });

    return NextResponse.json({
      completed: true,
      received: totalSize,
      asset: {
        id: storageKey,
        name: fileName,
        url: `/api/files/${encodeURIComponent(storageKey)}`,
        mimeType,
        size: totalSize,
      },
    });
  } catch (error) {
    console.error('Chunk upload failed:', error);
    return bad('Unable to upload file chunk.', 500);
  }
}
