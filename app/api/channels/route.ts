import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { channels } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';

export async function POST(request: NextRequest) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const handle = typeof body.handle === 'string' ? body.handle.trim() : '';

    if (!name) {
      return NextResponse.json(
        { error: 'Channel name is required.' },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(channels)
      .values({
        userUid: user.uid,
        name,
        handle,
      })
      .returning();

    return NextResponse.json({ channel: created }, { status: 201 });
  } catch (error) {
    console.error('Failed to create channel:', error);
    return NextResponse.json(
      { error: 'Unable to create channel.' },
      { status: 500 }
    );
  }
}
