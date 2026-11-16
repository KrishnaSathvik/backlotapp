import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { contentItems, ideas } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import {
  badRequest,
  collectUnusedFiles,
  errorResponse,
  keysIn,
  parseId,
} from '@/src/lib/api-utils.ts';
import { convertIdeaToPostDraft, type PlatformKey } from '@/src/lib/content-logic.ts';

type Ctx = { params: Promise<{ id: string }> };

/** Converts an idea into a post. Idempotent: a second call returns the existing post. */
export async function POST(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const ideaId = parseId((await context.params).id);
    if (!ideaId) return badRequest('Invalid idea id.');

    const result = await db.transaction(async (tx) => {
      // Lock the idea row so concurrent clicks cannot both convert it.
      const [idea] = await tx
        .select()
        .from(ideas)
        .where(and(eq(ideas.id, ideaId), eq(ideas.userUid, user.uid)))
        .for('update');
      if (!idea) return null;

      if (idea.convertedItemId) {
        const [existing] = await tx
          .select()
          .from(contentItems)
          .where(and(eq(contentItems.id, idea.convertedItemId), eq(contentItems.userUid, user.uid)));
        if (existing) return { item: existing, idea, created: false };
      }

      const draft = convertIdeaToPostDraft({
        ...idea,
        platform: idea.platform as PlatformKey,
        createdAt: idea.createdAt.toISOString(),
      });

      const [item] = await tx
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
          targetDate: draft.targetDate,
          attachedReferences: draft.attachedReferences,
          sourceIdeaId: idea.id,
        })
        .returning();

      const [updatedIdea] = await tx
        .update(ideas)
        .set({ convertedItemId: item.id })
        .where(eq(ideas.id, idea.id))
        .returning();

      return { item, idea: updatedIdea, created: true };
    });

    if (!result) return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    return NextResponse.json(
      { item: result.item, idea: result.idea },
      { status: result.created ? 201 : 200 }
    );
  } catch (error) {
    return errorResponse(error, 'Unable to convert idea to post.');
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const ideaId = parseId((await context.params).id);
    if (!ideaId) return badRequest('Invalid idea id.');

    const deleted = await db
      .delete(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.userUid, user.uid)))
      .returning();

    if (!deleted.length) {
      return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    }

    await collectUnusedFiles(user.uid, keysIn(deleted));
    return NextResponse.json({ deletedId: ideaId });
  } catch (error) {
    return errorResponse(error, 'Unable to delete idea.');
  }
}
