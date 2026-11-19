import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { BadRequest, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { applyAction, dismissAction } from '@/src/lib/slate/actions-db.ts';

type Params = { params: Promise<{ id: string }> };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The creator's decision on one suggested action: { decision: 'apply', edits? } or
 * { decision: 'dismiss' }. This is the only way a Slate suggestion changes content.
 * The action itself (target, fields, base version) is read from the database; the
 * request can only carry edits to the fields it already proposes.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = (await params).id;
  if (!ID.test(id)) return NextResponse.json({ error: 'That suggestion isn’t available.', code: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BadRequest ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (Object.keys(body).some((k) => k !== 'decision' && k !== 'edits')) {
    return NextResponse.json({ error: 'Only a decision and edits can be sent.' }, { status: 400 });
  }
  if (body.decision !== 'apply' && body.decision !== 'dismiss') {
    return NextResponse.json({ error: 'decision must be "apply" or "dismiss".' }, { status: 400 });
  }
  if (body.decision === 'dismiss' && body.edits !== undefined) {
    return NextResponse.json({ error: 'Edits only go with apply.' }, { status: 400 });
  }

  try {
    const result = body.decision === 'apply' ? await applyAction(db, user.uid, id, body.edits) : await dismissAction(db, user.uid, id);
    const { status, ...rest } = result;
    return NextResponse.json(rest, { status });
  } catch (error) {
    // The transaction rolled back: nothing changed and the suggestion is still pending.
    console.error('Slate action failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t apply that right now. Nothing was changed; try again.', code: 'unavailable' }, { status: 503 });
  }
}
