import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '@/src/db/index.ts';
import { uploadedFiles } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';

const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

export async function POST(request: NextRequest) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });

    const uploadId = request.headers.get('x-upload-id') || crypto.randomUUID();
    const chunkIndex = Number(request.headers.get('x-chunk-index') || '0');
    const totalChunks = Number(request.headers.get('x-total-chunks') || '1');
    const rawFileName = decodeURIComponent(
      request.headers.get('x-file-name') || 'upload.bin'
    );
    const mimeType =
      request.headers.get('x-mime-type') || 'application/octet-stream';
    const totalSize = Number(request.headers.get('x-total-size') || '0');

    const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeExt = path.extname(rawFileName).replace(/[^a-zA-Z0-9.]/g, '');
    const partPath = path.join(UPLOAD_ROOT, `${safeUploadId}.part`);

    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (chunkIndex === 0) {
      await fs.writeFile(partPath, buffer);
    } else {
      await fs.appendFile(partPath, buffer);
    }

    if (chunkIndex < totalChunks - 1) {
      return NextResponse.json({
        completed: false,
        uploadId: safeUploadId,
        chunkIndex,
      });
    }

    const storageKey = `${safeUploadId}${safeExt}`;
    const finalPath = path.join(UPLOAD_ROOT, storageKey);
    await fs.rename(partPath, finalPath);

    const stats = await fs.stat(finalPath);
    const sizeBytes = totalSize || stats.size;

    await db.insert(uploadedFiles).values({
      userUid: user.uid,
      storageKey,
      fileName: rawFileName,
      mimeType,
      sizeBytes,
    });

    return NextResponse.json({
      completed: true,
      asset: {
        id: safeUploadId,
        name: rawFileName,
        url: `/api/files/${encodeURIComponent(storageKey)}`,
        mimeType,
        size: sizeBytes,
      },
    });
  } catch (error) {
    console.error('Chunk upload failed:', error);
    return NextResponse.json(
      { error: 'Unable to upload file chunk.' },
      { status: 500 }
    );
  }
}
