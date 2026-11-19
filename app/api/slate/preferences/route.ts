import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { BadRequest, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { listPreferenceRecords, savePreference } from '@/src/lib/slate/preferences-db.ts';

/**
 * Slate creative preferences for the signed-in creator.
 * GET lists them; POST creates or replaces one (key + optional channel scope).
 * This is the only way a preference gets saved: an explicit creator action.
 */

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  try {
    return NextResponse.json({ preferences: await listPreferenceRecords(db, user.uid) });
  } catch (error) {
    console.error('Preferences load failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t load your preferences.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BadRequest ? error.message : 'Invalid request.' }, { status: 400 });
  }
  for (const k of Object.keys(body)) {
    if (!['key', 'value', 'channelId', 'source'].includes(k)) return NextResponse.json({ error: `Unknown field "${k}".` }, { status: 400 });
  }
  const channelId = body.channelId === undefined || body.channelId === null ? null : body.channelId;
  if (channelId !== null && (typeof channelId !== 'number' || !Number.isInteger(channelId) || channelId < 1)) {
    return NextResponse.json({ error: 'Invalid channel.' }, { status: 400 });
  }
  const source = body.source === 'slate_confirmed' ? 'slate_confirmed' : 'user';
  try {
    const result = await savePreference(db, user.uid, { key: body.key, value: body.value, channelId, source });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ preference: result.value });
  } catch (error) {
    console.error('Preference save failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t save that preference.' }, { status: 503 });
  }
}
