import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { BadRequest, readJson } from '@/src/lib/api-utils.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { appendMessages, createConversation, listConversations, validImport, validTitle } from '@/src/lib/slate/conversations-db.ts';

/** The signed-in creator's Slate conversations: ?q= searches titles and messages; ?archived=1 lists archived ones. */
export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  const p = request.nextUrl.searchParams;
  const before = p.get('before');
  const beforeDate = before ? new Date(before) : undefined;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) return NextResponse.json({ error: 'Invalid cursor.' }, { status: 400 });
  try {
    const conversations = await listConversations(db, user.uid, { archived: p.get('archived') === '1', query: p.get('q') ?? undefined, before: beforeDate });
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Slate conversations list failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t load your chats.' }, { status: 503 });
  }
}

/**
 * Imports a chat that older versions of Backlot kept only in this browser, so it isn't lost
 * when chats move to the account. Body: { title?, messages: [{ role, text }] } (max 60 turns).
 */
export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;
  let body: Record<string, unknown>;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof BadRequest ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (Object.keys(body).some((k) => k !== 'title' && k !== 'messages')) return NextResponse.json({ error: 'Unknown field.' }, { status: 400 });
  const messages = validImport(body.messages);
  if (!messages) return NextResponse.json({ error: 'Nothing valid to import.' }, { status: 400 });
  try {
    const conversation = await createConversation(db, user.uid, validTitle(body.title) ?? 'Earlier chat');
    await appendMessages(db, user.uid, conversation, messages);
    return NextResponse.json({ id: conversation.publicId, title: conversation.title }, { status: 201 });
  } catch (error) {
    console.error('Slate import failed:', error instanceof Error ? error.message.slice(0, 200) : '');
    return NextResponse.json({ error: 'Couldn’t import that chat.' }, { status: 503 });
  }
}
