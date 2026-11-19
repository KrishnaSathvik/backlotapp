import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { getMediaStore } from '@/src/lib/storage/index.ts';
import { signUploadParts } from '@/src/lib/storage/uploads.ts';

/**
 * Direct uploads, step 2. POST { uploadId, partNumbers: [1, 2, …] } (at most 20) returns
 * short-lived URLs, each able to PUT exactly one part, of the declared size, of this creator's
 * own active upload. The URLs are bearer capabilities: they're returned only to the signed-in
 * owner, never logged, and expire in minutes (UPLOAD_PART_URL_TTL_SEC, default 900).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const body = (await request.json().catch(() => null)) as { uploadId?: unknown; partNumbers?: unknown } | null;
    const uploadId = typeof body?.uploadId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(body.uploadId) ? body.uploadId : null;
    const parts = Array.isArray(body?.partNumbers) ? body.partNumbers.map(Number) : null;
    if (!uploadId || !parts) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore });
    const result = await signUploadParts(db, getMediaStore(), user.uid, uploadId, parts);
    return NextResponse.json(result.body, { status: result.status, headers: noStore });
  } catch (error) {
    opsEvent('upload.failed', { stage: 'sign', error: errorKind(error) }, 'ERROR');
    return NextResponse.json({ error: 'Unable to continue the upload.' }, { status: 500, headers: noStore });
  }
}
