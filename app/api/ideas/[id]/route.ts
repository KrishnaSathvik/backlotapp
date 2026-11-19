import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/src/db/index.ts';
import { ideas, slateEmbeddings } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import {
  badRequest,
  collectUnusedFiles,
  errorResponse,
  keysIn,
  parseId,
  platform,
  readJson,
  str,
  tags,
} from '@/src/lib/api-utils.ts';
import {
  conflictMessage,
  convertIdeaVersioned,
  readExpectedVersion,
  updateIdeaVersioned,
  type IdeaUpdates,
} from '@/src/lib/content-mutations.ts';

/** The convert call's body is optional (older clients sent none). */
async function readOptionalJson(request: NextRequest): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

type Ctx = { params: Promise<{ id: string }> };

/** Converts an idea into a post. Idempotent: a second call returns the existing post. */
export async function POST(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const ideaId = parseId((await context.params).id);
    if (!ideaId) return badRequest('Invalid idea id.');

    const body = await readOptionalJson(request);
    const expected = readExpectedVersion(body);
    if (!expected.ok) return NextResponse.json({ error: expected.error, code: expected.code }, { status: expected.status });

    const result = await convertIdeaVersioned(db, user.uid, ideaId, expected.version);
    if (result.kind === 'not_found') return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    if (result.kind === 'conflict') {
      return NextResponse.json({ error: conflictMessage('idea'), code: 'version_conflict', idea: result.current }, { status: 409 });
    }
    return NextResponse.json({ item: result.item, idea: result.idea }, { status: result.kind === 'created' ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, 'Unable to convert idea to post.');
  }
}

/** Edits an idea's text and details. The screenshot is set when the idea is captured. */
export async function PATCH(request: NextRequest, context: Ctx) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const ideaId = parseId((await context.params).id);
    if (!ideaId) return badRequest('Invalid idea id.');

    const body = await readJson(request);
    const expected = readExpectedVersion(body);
    if (!expected.ok) return NextResponse.json({ error: expected.error, code: expected.code }, { status: expected.status });
    const updates: IdeaUpdates = {};

    if (body.title !== undefined) {
      const title = str(body.title, 300, 'Title').trim();
      if (!title) return badRequest('Title is required.');
      updates.title = title;
    }
    if (body.linkUrl !== undefined) {
      const linkUrl = str(body.linkUrl, 2048, 'Link').trim();
      if (linkUrl && !/^https?:\/\//i.test(linkUrl)) return badRequest('Link must start with http:// or https://');
      updates.linkUrl = linkUrl;
    }
    if (body.linkTitle !== undefined) updates.linkTitle = str(body.linkTitle, 300, 'Link title').trim();
    if (body.linkDomain !== undefined) updates.linkDomain = str(body.linkDomain, 300, 'Link domain');
    if (body.notes !== undefined) updates.notes = str(body.notes, 20000, 'Notes').trim();
    if (body.platform !== undefined) updates.platform = platform(body.platform);
    if (body.channelName !== undefined) updates.channelName = str(body.channelName, 200, 'Channel');
    if (body.tags !== undefined) updates.tags = tags(body.tags);
    if (body.targetDate !== undefined) updates.targetDate = str(body.targetDate, 40, 'Target date');

    if (!Object.keys(updates).length) return badRequest('Nothing to update.');

    const result = await updateIdeaVersioned(db, user.uid, ideaId, expected.version, updates);
    if (result.kind === 'not_found') return NextResponse.json({ error: 'Idea not found.' }, { status: 404 });
    if (result.kind === 'conflict') {
      return NextResponse.json({ error: conflictMessage('idea'), code: 'version_conflict', idea: result.current }, { status: 409 });
    }
    return NextResponse.json({ idea: result.row, ...(result.kind === 'unchanged' ? { unchanged: true } : {}) });
  } catch (error) {
    return errorResponse(error, 'Unable to update idea.');
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
    await db
      .delete(slateEmbeddings)
      .where(and(eq(slateEmbeddings.userUid, user.uid), eq(slateEmbeddings.targetType, 'idea'), eq(slateEmbeddings.targetId, ideaId)));
    return NextResponse.json({ deletedId: ideaId });
  } catch (error) {
    return errorResponse(error, 'Unable to delete idea.');
  }
}
