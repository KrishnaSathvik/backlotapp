import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { uploadedFiles } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { IMAGE_TYPES, VIDEO_TYPES } from '@/src/lib/upload-limits.ts';

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

/**
 * GET /api/files/<key> — the signed-in owner's file, never anyone else's (404).
 *
 * R2 (production): after the ownership check, a 302 to a signed R2 URL valid for
 * FILE_URL_TTL_SEC (default 300 s) that can read only this object, with the content type and
 * disposition fixed by the server. Video bytes and range requests (seeking) then go straight
 * from R2 to the browser instead of through a Vercel Function (payload and duration limits,
 * and cost). The signed URL is on R2's own origin, so even a file's bytes can't run as part of
 * Backlot's site. STORAGE_DELIVERY=proxy streams through the server instead.
 *
 * Other stores: streamed through this route, with byte ranges, nosniff and a sandboxing CSP.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function signedUrlTtl(): number {
  const n = Number(process.env.FILE_URL_TTL_SEC);
  return Number.isInteger(n) && n >= 30 && n <= 3600 ? n : 300;
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

    // Ownership was checked above; only then is the store touched.
    const store = getMediaStore();
    const isMedia = IMAGE_TYPES.includes(meta.mimeType) || VIDEO_TYPES.includes(meta.mimeType);
    const isDownload = request.nextUrl.searchParams.get('download') === '1' || !isMedia;
    const fileName = meta.fileName.replace(/["\\\r\n]/g, '');
    const disposition = `${isDownload ? 'attachment' : 'inline'}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`;

    if (store.signedReads && process.env.STORAGE_DELIVERY !== 'proxy') {
      const ttl = signedUrlTtl();
      const url = await store.signedReads.presignGet(safeKey, {
        expiresInSec: ttl,
        contentType: isMedia ? meta.mimeType : 'application/octet-stream',
        disposition,
      });
      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: url,
          // Reuse the redirect briefly (well inside the URL's lifetime), never in shared caches.
          'Cache-Control': `private, max-age=${Math.max(0, Math.floor(ttl / 2) - 10)}`,
          'Referrer-Policy': 'no-referrer',
        },
      });
    }

    const info = await store.stat(safeKey);
    if (!info) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const size = info.size;

    const headers: Record<string, string> = {
      'Content-Type': isMedia ? meta.mimeType : 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': disposition,
    };

    const range = isDownload ? undefined : parseRange(request.headers.get('range'), size);
    if (range === null) {
      return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    if (range) {
      return new NextResponse(await store.stream(safeKey, range), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': String(range.end - range.start + 1),
        },
      });
    }

    return new NextResponse(await store.stream(safeKey), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  } catch (error) {
    console.error('File streaming failed:', error);
    return NextResponse.json({ error: 'Unable to read file.' }, { status: 500 });
  }
}
