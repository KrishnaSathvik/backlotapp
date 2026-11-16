import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { contentItems, ideas } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';
import { convertIdeaToPostDraft, type PlatformKey } from '@/src/lib/content-logic.ts';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const ideaId = Number(id);
    if (!Number.isInteger(ideaId)) {
      return NextResponse.json({ error: 'Invalid idea id.' }, { status: 400 });
    }

    const [idea] = await db
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.userUid, user.uid)));

    if (!idea) {
      return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    }

    const draft = convertIdeaToPostDraft({
      id: idea.id,
      title: idea.title,
      linkUrl: idea.linkUrl,
      linkTitle: idea.linkTitle,
      linkDomain: idea.linkDomain,
      screenshotUrl: idea.screenshotUrl,
      notes: idea.notes,
      platform: idea.platform as PlatformKey,
      channelName: idea.channelName,
      tags: idea.tags,
      targetDate: idea.targetDate,
      convertedItemId: idea.convertedItemId,
      createdAt: idea.createdAt.toISOString(),
    });

    const [createdItem] = await db
      .insert(contentItems)
      .values({
        userUid: user.uid,
        title: draft.title,
        platform: draft.platform,
        channelName: draft.channelName,
        status: draft.status,
        caption: draft.caption,
        tags: draft.tags,
        notes: draft.notes,
        liveLink: '',
        postDate: '',
        targetDate: draft.targetDate,
        coverAsset: null,
        videoAsset: null,
        slides: [],
        attachedReferences: draft.attachedReferences,
        sourceIdeaId: idea.id,
      })
      .returning();

    const [updatedIdea] = await db
      .update(ideas)
      .set({ convertedItemId: createdItem.id })
      .where(and(eq(ideas.id, idea.id), eq(ideas.userUid, user.uid)))
      .returning();

    return NextResponse.json({ item: createdItem, idea: updatedIdea }, { status: 201 });
  } catch (error) {
    console.error('Failed to convert idea to post:', error);
    return NextResponse.json(
      { error: 'Unable to convert idea to post.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const ideaId = Number(id);
    if (!Number.isInteger(ideaId)) {
      return NextResponse.json({ error: 'Invalid idea id.' }, { status: 400 });
    }

    const deleted = await db
      .delete(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.userUid, user.uid)))
      .returning();

    if (!deleted.length) {
      return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    }

    return NextResponse.json({ deletedId: ideaId });
  } catch (error) {
    console.error('Failed to delete idea:', error);
    return NextResponse.json(
      { error: 'Unable to delete idea.' },
      { status: 500 }
    );
  }
}
