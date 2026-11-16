import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { channels } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { badRequest, errorResponse, readJson, str } from '@/src/lib/api-utils.ts';

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const body = await readJson(request);
    const name = str(body.name, 120, 'Channel name').trim();
    const handle = str(body.handle, 120, 'Handle').trim();
    if (!name) return badRequest('Channel name is required.');

    const [created] = await db
      .insert(channels)
      .values({ userUid: user.uid, name, handle })
      .returning();

    return NextResponse.json({ channel: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Unable to create channel.');
  }
}
