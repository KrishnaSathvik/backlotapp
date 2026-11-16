import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { contentItems } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import {
  asset,
  assets,
  assertOwnsFiles,
  badRequest,
  collectUnusedFiles,
  errorResponse,
  keysIn,
  optionalInt,
  parseId,
  platform,
  readJson,
  references,
  status,
  str,
  tags,
  webLink,
} from '@/src/lib/api-utils.ts';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const itemId = parseId((await context.params).id);
    if (!itemId) return badRequest('Invalid item id.');

    const body = await readJson(request);
    const updates: Partial<typeof contentItems.$inferInsert> = { updatedAt: new Date() };

    if (body.title !== undefined) {
      const title = str(body.title, 300, 'Title').trim();
      if (!title) return badRequest('Title is required.');
      updates.title = title;
    }
    if (body.platform !== undefined) updates.platform = platform(body.platform);
    if (body.channelId !== undefined) updates.channelId = optionalInt(body.channelId, 'Channel');
    if (body.channelName !== undefined) updates.channelName = str(body.channelName, 200, 'Channel');
    if (body.status !== undefined) updates.status = status(body.status);
    if (body.caption !== undefined) updates.caption = str(body.caption, 20000, 'Caption');
    if (body.tags !== undefined) updates.tags = tags(body.tags);
    if (body.notes !== undefined) updates.notes = str(body.notes, 20000, 'Notes');
    if (body.liveLink !== undefined) updates.liveLink = webLink(body.liveLink, 'Live link');
    if (body.postDate !== undefined) updates.postDate = str(body.postDate, 40, 'Post date');
    if (body.targetDate !== undefined) updates.targetDate = str(body.targetDate, 40, 'Target date');
    if (body.coverAsset !== undefined) updates.coverAsset = asset(body.coverAsset, 'Cover');
    if (body.videoAsset !== undefined) updates.videoAsset = asset(body.videoAsset, 'Video');
    if (body.slides !== undefined) updates.slides = assets(body.slides, 'Slides');
    if (body.attachedReferences !== undefined) {
      updates.attachedReferences = references(body.attachedReferences);
    }
    await assertOwnsFiles(user.uid, updates);

    const where = and(eq(contentItems.id, itemId), eq(contentItems.userUid, user.uid));
    const [before] = await db.select().from(contentItems).where(where);
    if (!before) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });

    const [updated] = await db.update(contentItems).set(updates).where(where).returning();

    // Files that were replaced or removed by this edit.
    await collectUnusedFiles(user.uid, keysIn(before));

    return NextResponse.json({ item: updated });
  } catch (error) {
    return errorResponse(error, 'Unable to update content item.');
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const itemId = parseId((await context.params).id);
    if (!itemId) return badRequest('Invalid item id.');

    const deleted = await db
      .delete(contentItems)
      .where(and(eq(contentItems.id, itemId), eq(contentItems.userUid, user.uid)))
      .returning();

    if (!deleted.length) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    await collectUnusedFiles(user.uid, keysIn(deleted));
    return NextResponse.json({ deletedId: itemId });
  } catch (error) {
    return errorResponse(error, 'Unable to delete content item.');
  }
}
