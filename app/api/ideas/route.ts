import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { ideas } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import {
  assertOwnsFiles,
  badRequest,
  errorResponse,
  platform,
  readJson,
  str,
  tags,
} from '@/src/lib/api-utils.ts';

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const body = await readJson(request);
    const title = str(body.title, 300, 'Title').trim();
    const linkUrl = str(body.linkUrl, 2048, 'Link').trim();
    const linkTitle = str(body.linkTitle, 300, 'Link title').trim();
    const notes = str(body.notes, 20000, 'Notes').trim();
    const screenshotUrl = str(body.screenshotUrl, 2048, 'Screenshot').trim();

    if (!title && !linkUrl && !notes && !screenshotUrl) {
      return badRequest('Add a title, link, screenshot, or note to capture an idea.');
    }
    if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
      return badRequest('Link must start with http:// or https://');
    }
    if (screenshotUrl && !screenshotUrl.startsWith('/api/files/')) {
      return badRequest('Screenshot must be an uploaded image.');
    }
    await assertOwnsFiles(user.uid, screenshotUrl);

    const [created] = await db
      .insert(ideas)
      .values({
        userUid: user.uid,
        title: title || linkTitle || 'Captured idea',
        linkUrl,
        linkTitle,
        linkDomain: str(body.linkDomain, 300, 'Link domain'),
        screenshotUrl,
        notes,
        platform: platform(body.platform),
        channelName: str(body.channelName, 200, 'Channel'),
        tags: tags(body.tags),
        targetDate: str(body.targetDate, 40, 'Target date'),
      })
      .returning();

    return NextResponse.json({ idea: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Unable to save idea.');
  }
}
