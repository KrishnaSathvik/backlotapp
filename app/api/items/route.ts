import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { contentItems } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';

export async function POST(request: NextRequest) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json(
        { error: 'Title is required.' },
        { status: 400 }
      );
    }

    const [created] = await db
      .insert(contentItems)
      .values({
        userUid: user.uid,
        title,
        platform: typeof body.platform === 'string' ? body.platform : 'youtube_long',
        channelId: typeof body.channelId === 'number' ? body.channelId : null,
        channelName: typeof body.channelName === 'string' ? body.channelName : '',
        status: typeof body.status === 'string' ? body.status : 'idea',
        caption: typeof body.caption === 'string' ? body.caption : '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        notes: typeof body.notes === 'string' ? body.notes : '',
        liveLink: typeof body.liveLink === 'string' ? body.liveLink : '',
        postDate: typeof body.postDate === 'string' ? body.postDate : '',
        targetDate: typeof body.targetDate === 'string' ? body.targetDate : '',
        coverAsset: body.coverAsset ?? null,
        videoAsset: body.videoAsset ?? null,
        slides: Array.isArray(body.slides) ? body.slides : [],
        attachedReferences: Array.isArray(body.attachedReferences)
          ? body.attachedReferences
          : [],
        sourceIdeaId: typeof body.sourceIdeaId === 'number' ? body.sourceIdeaId : null,
      })
      .returning();

    return NextResponse.json({ item: created }, { status: 201 });
  } catch (error) {
    console.error('Failed to create content item:', error);
    return NextResponse.json(
      { error: 'Unable to save content item.' },
      { status: 500 }
    );
  }
}
