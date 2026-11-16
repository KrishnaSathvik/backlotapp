import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { channels, contentItems, ideas } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const [userChannels, userItems, userIdeas] = await Promise.all([
      db.select().from(channels).where(eq(channels.userUid, user.uid)).orderBy(channels.id),
      db
        .select()
        .from(contentItems)
        .where(eq(contentItems.userUid, user.uid))
        .orderBy(desc(contentItems.updatedAt)),
      db.select().from(ideas).where(eq(ideas.userUid, user.uid)).orderBy(desc(ideas.createdAt)),
    ]);

    return NextResponse.json({
      user: { uid: user.uid, email: user.email },
      channels: userChannels,
      items: userItems,
      ideas: userIdeas,
    });
  } catch (error) {
    console.error('Failed to load workspace:', error);
    return NextResponse.json(
      { error: 'Unable to load your workspace right now.' },
      { status: 500 }
    );
  }
}
