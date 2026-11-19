import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { getActions } from '@/src/lib/slate/actions-db.ts';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Current status of the creator's suggested actions (for cards restored from chat history). */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const ids = (request.nextUrl.searchParams.get('ids') ?? '').split(',').filter((id) => ID.test(id)).slice(0, 50);
  try {
    return NextResponse.json({ actions: await getActions(db, user.uid, ids) });
  } catch (error) {
    console.error('Slate actions read failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t load Slate’s suggestions.' }, { status: 503 });
  }
}
