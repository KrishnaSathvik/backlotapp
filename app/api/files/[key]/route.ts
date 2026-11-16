import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { uploadedFiles } from '@/src/db/schema.ts';

const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await context.params;
    const safeKey = path.basename(decodeURIComponent(key));
    const filePath = path.join(UPLOAD_ROOT, safeKey);

    let stat: fs.Stats;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }

    const [meta] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.storageKey, safeKey));

    const contentType = meta?.mimeType || 'application/octet-stream';
    const fileName = meta?.fileName || safeKey;
    const isDownload = request.nextUrl.searchParams.get('download') === '1';

    const rangeHeader = request.headers.get('range');
    if (rangeHeader && !isDownload) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        const chunkSize = end - start + 1;

        const stream = fs.createReadStream(filePath, { start, end });
        const webStream = new ReadableStream({
          start(controller) {
            stream.on('data', (chunk) => controller.enqueue(chunk));
            stream.on('end', () => controller.close());
            stream.on('error', (err) => controller.error(err));
          },
          cancel() {
            stream.destroy();
          },
        });

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          },
        });
      }
    }

    const fileBuffer = await fsp.readFile(filePath);
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    };
    if (isDownload) {
      headers['Content-Disposition'] = `attachment; filename="${fileName.replace(/"/g, '')}"`;
    }

    return new NextResponse(fileBuffer, { status: 200, headers });
  } catch (error) {
    console.error('File streaming failed:', error);
    return NextResponse.json({ error: 'Unable to read file.' }, { status: 500 });
  }
}
