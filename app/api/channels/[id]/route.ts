import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { channels, contentItems, ideas, slatePreferences } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { badRequest, errorResponse, parseId, platform, readJson, str } from '@/src/lib/api-utils.ts';

/**
 * Edit (PATCH { name?, handle?, platform? }) or delete (DELETE) one of the creator's channels.
 *
 * Posts link to a channel by id and name, ideas by name. Renaming updates both, so they stay in the
 * channel. Deleting keeps every post and idea: they just lose the channel. The channel's own Slate
 * preferences are removed. Changed posts and ideas get a new version (stale-edit protection) and
 * are returned so the app can refresh them.
 */

type Ctx = { params: Promise<{ id: string }> };

const bump = { version: sql`${contentItems.version} + 1` };
const bumpIdea = { version: sql`${ideas.version} + 1` };

export async function PATCH(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const id = parseId((await context.params).id);
    if (!id) return badRequest('Invalid channel id.');
    const body = await readJson(request);
    const updates: { name?: string; handle?: string; platform?: string } = {};
    if (body.name !== undefined) {
      updates.name = str(body.name, 120, 'Channel name').trim();
      if (!updates.name) return badRequest('Channel name is required.');
    }
    if (body.handle !== undefined) updates.handle = str(body.handle, 120, 'Handle').trim();
    if (body.platform !== undefined) updates.platform = platform(body.platform);
    if (!Object.keys(updates).length) return badRequest('Nothing to update.');

    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(channels).where(and(eq(channels.id, id), eq(channels.userUid, user.uid))).limit(1);
      if (!before) return null;
      const [channel] = await tx.update(channels).set(updates).where(eq(channels.id, id)).returning();
      let items: (typeof contentItems.$inferSelect)[] = [];
      let ideaRows: (typeof ideas.$inferSelect)[] = [];
      if (updates.name !== undefined && updates.name !== before.name) {
        const now = new Date();
        items = await tx
          .update(contentItems)
          .set({ channelName: updates.name, channelId: id, updatedAt: now, ...bump })
          .where(
            and(
              eq(contentItems.userUid, user.uid),
              or(eq(contentItems.channelId, id), and(isNull(contentItems.channelId), eq(contentItems.channelName, before.name)))
            )
          )
          .returning();
        ideaRows = await tx
          .update(ideas)
          .set({ channelName: updates.name, ...bumpIdea })
          .where(and(eq(ideas.userUid, user.uid), eq(ideas.channelName, before.name)))
          .returning();
      }
      return { channel, items, ideas: ideaRows };
    });
    if (!result) return NextResponse.json({ error: 'Channel not found.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'Unable to update the channel.');
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    const id = parseId((await context.params).id);
    if (!id) return badRequest('Invalid channel id.');

    const result = await db.transaction(async (tx) => {
      const [deleted] = await tx.delete(channels).where(and(eq(channels.id, id), eq(channels.userUid, user.uid))).returning();
      if (!deleted) return null;
      const now = new Date();
      const items = await tx
        .update(contentItems)
        .set({ channelName: '', channelId: null, updatedAt: now, ...bump })
        .where(
          and(
            eq(contentItems.userUid, user.uid),
            or(eq(contentItems.channelId, id), and(isNull(contentItems.channelId), eq(contentItems.channelName, deleted.name)))
          )
        )
        .returning();
      const ideaRows = await tx
        .update(ideas)
        .set({ channelName: '', ...bumpIdea })
        .where(and(eq(ideas.userUid, user.uid), eq(ideas.channelName, deleted.name)))
        .returning();
      await tx.delete(slatePreferences).where(and(eq(slatePreferences.userUid, user.uid), eq(slatePreferences.channelId, id)));
      return { deletedId: id, items, ideas: ideaRows };
    });
    if (!result) return NextResponse.json({ error: 'Channel not found.' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, 'Unable to delete the channel.');
  }
}
