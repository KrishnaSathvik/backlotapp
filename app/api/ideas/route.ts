import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { ideas } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';

export async function POST(request: NextRequest) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const linkUrl = typeof body.linkUrl === 'string' ? body.linkUrl.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const screenshotUrl =
      typeof body.screenshotUrl === 'string' ? body.screenshotUrl.trim() : '';

    if (!title && !linkUrl && !notes && !screenshotUrl) {
      return NextResponse.json(
        { error: 'Add a title, link, screenshot, or note to capture an idea.' },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(ideas)
      .values({
        userUid: user.uid,
        title: title || body.linkTitle || 'Captured Idea',
        linkUrl,
        linkTitle: typeof body.linkTitle === 'string' ? body.linkTitle : '',
        linkDomain: typeof body.linkDomain === 'string' ? body.linkDomain : '',
        screenshotUrl,
        notes,
        platform: typeof body.platform === 'string' ? body.platform : 'youtube_long',
        channelName: typeof body.channelName === 'string' ? body.channelName : '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        targetDate: typeof body.targetDate === 'string' ? body.targetDate : '',
      })
      .returning();

    return NextResponse.json({ idea: created }, { status: 201 });
  } catch (error) {
    console.error('Failed to capture idea:', error);
    return NextResponse.json(
      { error: 'Unable to save idea.' },
      { status: 500 }
    );
  }
}
