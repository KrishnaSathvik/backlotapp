import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { BadRequest, parseId, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { deletePreference, updatePreferenceValue } from '@/src/lib/slate/preferences-db.ts';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Preference not found.' }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BadRequest ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (Object.keys(body).some((k) => k !== 'value')) return NextResponse.json({ error: 'Only the value can be changed.' }, { status: 400 });
  try {
    const result = await updatePreferenceValue(db, user.uid, id, body.value);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ preference: result.value });
  } catch (error) {
    console.error('Preference update failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t update that preference.' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Preference not found.' }, { status: 404 });
  try {
    const result = await deletePreference(db, user.uid, id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Preference delete failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t remove that preference.' }, { status: 503 });
  }
}
