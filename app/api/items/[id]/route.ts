import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { contentItems, slateEmbeddings } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { conflictMessage, readExpectedVersion, updatePostVersioned, type PostUpdates } from '@/src/lib/content-mutations.ts';
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
    const expected = readExpectedVersion(body);
    if (!expected.ok) return NextResponse.json({ error: expected.error, code: expected.code }, { status: expected.status });
    const updates: PostUpdates = {};

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

    const result = await updatePostVersioned(db, user.uid, itemId, expected.version, updates);
    if (result.kind === 'not_found') return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    if (result.kind === 'conflict') {
      // The creator's own record: safe to return so the browser can show the latest version.
      return NextResponse.json({ error: conflictMessage('post'), code: 'version_conflict', item: result.current }, { status: 409 });
    }
    if (result.kind === 'unchanged') return NextResponse.json({ item: result.row, unchanged: true });

    // Files that were replaced or removed by this edit.
    await collectUnusedFiles(user.uid, keysIn(result.before));

    return NextResponse.json({ item: result.row });
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
    // Derived search data goes with the post.
    await db
      .delete(slateEmbeddings)
      .where(and(eq(slateEmbeddings.userUid, user.uid), eq(slateEmbeddings.targetType, 'post'), eq(slateEmbeddings.targetId, itemId)));
    return NextResponse.json({ deletedId: itemId });
  } catch (error) {
    return errorResponse(error, 'Unable to delete content item.');
  }
}
