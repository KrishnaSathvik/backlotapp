import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { BadRequest, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { getActions } from '@/src/lib/slate/actions-db.ts';
import { deleteConversation, getConversation, loadMessages, renameConversation, setArchived, validTitle } from '@/src/lib/slate/conversations-db.ts';
import { createDbSlateStore } from '@/src/lib/slate/store-db.ts';
import type { EntityRef } from '@/src/lib/slate/tools.ts';

const store = createDbSlateStore(db);

type Params = { params: Promise<{ id: string }> };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOT_FOUND = () => NextResponse.json({ error: 'That conversation isn’t available.' }, { status: 404 });
const fail = (what: string, error: unknown) => {
  console.error(`Slate conversation ${what} failed:`, error instanceof Error ? error.message.slice(0, 200) : '');
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 503 });
};

/** One conversation with its messages; suggested actions come with their current status. */
export async function GET(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = (await params).id;
  if (!ID.test(id)) return NOT_FOUND();
  try {
    const conversation = await getConversation(db, user.uid, id);
    if (!conversation) return NOT_FOUND();
    const messages = await loadMessages(db, user.uid, conversation.id);
    const actions = await getActions(db, user.uid, messages.flatMap((m) => m.actionIds).slice(-50));
    const byId = new Map(actions.map((a) => [a.id, a]));
    // Saved replies keep their history, but links to posts or ideas deleted since are marked.
    const exists = new Map<string, boolean>();
    for (const r of messages.flatMap((m) => m.refs as EntityRef[]).slice(-100)) {
      const key = `${r.type}:${r.id}`;
      if (exists.has(key)) continue;
      exists.set(key, !!(r.type === 'post' ? await store.getPost(user.uid, r.id) : await store.getIdea(user.uid, r.id)));
    }
    return NextResponse.json({
      conversation: { id: conversation.publicId, title: conversation.title, archived: conversation.archivedAt !== null },
      messages: messages.map((m) => ({
        seq: m.seq,
        role: m.role,
        text: m.text,
        stopped: m.stopped === 1,
        refs: (m.refs as EntityRef[]).map((r) => (exists.get(`${r.type}:${r.id}`) === false ? { ...r, missing: true } : r)),
        proposals: m.proposals,
        attachments: m.attachments,
        // Suggestions removed by the retention cleanup are simply not shown any more.
        actions: m.actionIds.map((a) => byId.get(a)).filter(Boolean),
      })),
    });
  } catch (error) {
    return fail('read', error);
  }
}

/** Rename ({ title }) or archive / unarchive ({ archived }). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = (await params).id;
  if (!ID.test(id)) return NOT_FOUND();
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BadRequest ? error.message : 'Invalid request.' }, { status: 400 });
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || !['title', 'archived'].includes(keys[0])) return NextResponse.json({ error: 'Send either a title or archived.' }, { status: 400 });
  try {
    if ('title' in body) {
      const title = validTitle(body.title);
      if (!title) return NextResponse.json({ error: 'Titles are 1–120 characters.' }, { status: 400 });
      const row = await renameConversation(db, user.uid, id, title);
      return row ? NextResponse.json({ conversation: row }) : NOT_FOUND();
    }
    if (typeof body.archived !== 'boolean') return NextResponse.json({ error: 'archived must be true or false.' }, { status: 400 });
    const row = await setArchived(db, user.uid, id, body.archived);
    return row ? NextResponse.json({ conversation: row }) : NOT_FOUND();
  } catch (error) {
    return fail('update', error);
  }
}

/** Permanently deletes the conversation, its messages and its notes. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const id = (await params).id;
  if (!ID.test(id)) return NOT_FOUND();
  try {
    return (await deleteConversation(db, user.uid, id)) ? NextResponse.json({ ok: true }) : NOT_FOUND();
  } catch (error) {
    return fail('delete', error);
  }
}
