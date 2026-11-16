import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { contentItems } from '@/src/db/schema.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import {
  asset,
  assets,
  assertOwnsFiles,
  badRequest,
  errorResponse,
  optionalInt,
  platform,
  readJson,
  references,
  status,
  str,
  tags,
  webLink,
} from '@/src/lib/api-utils.ts';

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  try {
    const body = await readJson(request);
    const title = str(body.title, 300, 'Title').trim();
    if (!title) return badRequest('Title is required.');

    const values = {
      userUid: user.uid,
      title,
      platform: platform(body.platform),
      channelId: optionalInt(body.channelId, 'Channel'),
      channelName: str(body.channelName, 200, 'Channel'),
      status: status(body.status),
      caption: str(body.caption, 20000, 'Caption'),
      tags: tags(body.tags),
      notes: str(body.notes, 20000, 'Notes'),
      liveLink: webLink(body.liveLink, 'Live link'),
      postDate: str(body.postDate, 40, 'Post date'),
      targetDate: str(body.targetDate, 40, 'Target date'),
      coverAsset: asset(body.coverAsset, 'Cover'),
      videoAsset: asset(body.videoAsset, 'Video'),
      slides: assets(body.slides, 'Slides'),
      attachedReferences: references(body.attachedReferences),
      sourceIdeaId: optionalInt(body.sourceIdeaId, 'Source idea'),
    };
    await assertOwnsFiles(user.uid, [values.coverAsset, values.videoAsset, values.slides, values.attachedReferences]);

    const [created] = await db.insert(contentItems).values(values).returning();
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'Unable to save content item.');
  }
}
