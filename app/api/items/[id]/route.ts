import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { contentItems } from '@/src/db/schema.ts';
import { verifyRequestUser } from '@/src/lib/auth-server.ts';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await verifyRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const itemId = Number(id);
    if (!Number.isInteger(itemId)) {
      return NextResponse.json({ error: 'Invalid item id.' }, { status: 400 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.title === 'string') {
      const trimmed = body.title.trim();
      if (!trimmed) {
        return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
      }
      updates.title = trimmed;
    }
    if (typeof body.platform === 'string') updates.platform = body.platform;
    if (body.channelId !== undefined) updates.channelId = body.channelId;
    if (typeof body.channelName === 'string') updates.channelName = body.channelName;
    if (typeof body.status === 'string') updates.status = body.status;
    if (typeof body.caption === 'string') updates.caption = body.caption;
    if (Array.isArray(body.tags)) updates.tags = body.tags;
    if (typeof body.notes === 'string') updates.notes = body.notes;
    if (typeof body.liveLink === 'string') updates.liveLink = body.liveLink;
    if (typeof body.postDate === 'string') updates.postDate = body.postDate;
    if (typeof body.targetDate === 'string') updates.targetDate = body.targetDate;
    if (body.coverAsset !== undefined) updates.coverAsset = body.coverAsset;
    if (body.videoAsset !== undefined) updates.videoAsset = body.videoAsset;
    if (Array.isArray(body.slides)) updates.slides = body.slides;
    if (Array.isArray(body.attachedReferences)) {
      updates.attachedReferences = body.attachedReferences;
    }

    const [updated] = await db
      .update(contentItems)
      .set(updates)
      .where(and(eq(contentItems.id, itemId), eq(contentItems.userUid, user.uid)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    return NextResponse.json({ item: updated });
  } catch (error) {
    console.error('Failed to update content item:', error);
    return NextResponse.json(
      { error: 'Unable to update content item.' },
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
    const itemId = Number(id);
    if (!Number.isInteger(itemId)) {
      return NextResponse.json({ error: 'Invalid item id.' }, { status: 400 });
    }

    const deleted = await db
      .delete(contentItems)
      .where(and(eq(contentItems.id, itemId), eq(contentItems.userUid, user.uid)))
      .returning();

    if (!deleted.length) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    return NextResponse.json({ deletedId: itemId });
  } catch (error) {
    console.error('Failed to delete content item:', error);
    return NextResponse.json(
      { error: 'Unable to delete content item.' },
      { status: 500 }
    );
  }
}
