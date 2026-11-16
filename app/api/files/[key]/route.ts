import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { uploadedFiles } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { UPLOAD_ROOT } from '@/src/lib/api-utils.ts';
import { IMAGE_TYPES, VIDEO_TYPES } from '@/src/lib/upload-limits.ts';

function streamFile(filePath: string, start?: number, end?: number) {
  const nodeStream = fs.createReadStream(filePath, { start, end });
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
}

/** Parses a single byte range. Returns null when unsatisfiable, undefined when absent/ignored. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return undefined;
  let start: number;
  let end: number;
  if (!match[1]) {
    // Suffix range: last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    let safeKey: string;
    try {
      safeKey = path.basename(decodeURIComponent((await context.params).key));
    } catch {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    const [meta] = await db
      .select()
      .from(uploadedFiles)
      .where(and(eq(uploadedFiles.storageKey, safeKey), eq(uploadedFiles.userUid, user.uid)));
    if (!meta) return NextResponse.json({ error: 'File not found.' }, { status: 404 });

    const filePath = path.join(UPLOAD_ROOT, safeKey);
    let size: number;
    try {
      size = (await fsp.stat(filePath)).size;
    } catch {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    const isMedia = IMAGE_TYPES.includes(meta.mimeType) || VIDEO_TYPES.includes(meta.mimeType);
    const isDownload = request.nextUrl.searchParams.get('download') === '1' || !isMedia;
    const fileName = meta.fileName.replace(/["\\\r\n]/g, '');

    const headers: Record<string, string> = {
      'Content-Type': isMedia ? meta.mimeType : 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': `${isDownload ? 'attachment' : 'inline'}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
    };

    const range = isDownload ? undefined : parseRange(request.headers.get('range'), size);
    if (range === null) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    if (range) {
      return new NextResponse(streamFile(filePath, range.start, range.end), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }

    return new NextResponse(streamFile(filePath), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  } catch (error) {
    console.error('File streaming failed:', error);
    return NextResponse.json({ error: 'Unable to read file.' }, { status: 500 });
  }
}
