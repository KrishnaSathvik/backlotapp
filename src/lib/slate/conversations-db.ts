import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { slateConversations, slateMessages } from '../../db/schema.ts';
import { likePattern } from './store-db.ts';

/**
 * Slate conversations in Postgres, so a chat continues on any device.
 * Every function takes the signed-in uid and only touches that user's rows; another
 * user's conversation id behaves exactly like a missing one.
 */

type Db = PgDatabase<any, any>;
export type ConversationRow = typeof slateConversations.$inferSelect;
export type MessageRow = typeof slateMessages.$inferSelect;

export const CONVERSATION_LIMITS = {
  titleChars: 120,
  messageChars: 8000,
  importTurns: 60,
  listPage: 30,
} as const;

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt: string;
  archived: boolean;
  /** For search results: a short piece of the matching message. */
  snippet?: string;
}

export interface NewMessage {
  role: 'user' | 'model';
  text: string;
  stopped?: boolean;
  refs?: unknown[];
  proposals?: unknown[];
  actionIds?: string[];
  attachments?: { kind: 'image'; label: string }[];
}

const toSummary = (r: ConversationRow, snippet?: string): ConversationSummary => ({
  id: r.publicId,
  title: r.title,
  lastMessageAt: r.lastMessageAt.toISOString(),
  archived: r.archivedAt !== null,
  ...(snippet ? { snippet } : {}),
});

/** A short title from the first message (the creator can rename it). */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
}

export function validTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= CONVERSATION_LIMITS.titleChars ? t : null;
}

export async function createConversation(db: Db, uid: string, title: string, now = new Date()): Promise<ConversationRow> {
  const [row] = await db
    .insert(slateConversations)
    .values({ publicId: randomUUID(), userUid: uid, title: validTitle(title) ?? 'New chat', createdAt: now, lastMessageAt: now })
    .returning();
  return row;
}

export async function getConversation(db: Db, uid: string, publicId: string): Promise<ConversationRow | null> {
  const [row] = await db
    .select()
    .from(slateConversations)
    .where(and(eq(slateConversations.publicId, publicId), eq(slateConversations.userUid, uid)))
    .limit(1);
  return row ?? null;
}

export async function listConversations(
  db: Db,
  uid: string,
  opts: { archived?: boolean; query?: string; before?: Date; limit?: number } = {}
): Promise<ConversationSummary[]> {
  const limit = Math.min(opts.limit ?? CONVERSATION_LIMITS.listPage, 50);
  const filters: SQL[] = [eq(slateConversations.userUid, uid), opts.archived ? isNotNull(slateConversations.archivedAt) : isNull(slateConversations.archivedAt)];
  if (opts.before) filters.push(lt(slateConversations.lastMessageAt, opts.before));
  const q = opts.query?.trim().slice(0, 100);

  if (!q) {
    const rows = await db.select().from(slateConversations).where(and(...filters)).orderBy(desc(slateConversations.lastMessageAt), desc(slateConversations.id)).limit(limit);
    return rows.map((r) => toSummary(r));
  }

  // Search titles and message text (parameterized, wildcards escaped, own rows only).
  const pattern = likePattern(q);
  const matching = db
    .select({ id: slateMessages.conversationId })
    .from(slateMessages)
    .where(and(eq(slateMessages.userUid, uid), ilike(slateMessages.text, pattern)));
  const rows = await db
    .select()
    .from(slateConversations)
    .where(and(...filters, or(ilike(slateConversations.title, pattern), inArray(slateConversations.id, matching))))
    .orderBy(desc(slateConversations.lastMessageAt), desc(slateConversations.id))
    .limit(limit);
  if (!rows.length) return [];
  const hits = await db
    .select({ conversationId: slateMessages.conversationId, text: slateMessages.text })
    .from(slateMessages)
    .where(and(eq(slateMessages.userUid, uid), inArray(slateMessages.conversationId, rows.map((r) => r.id)), ilike(slateMessages.text, pattern)))
    .orderBy(desc(slateMessages.seq));
  const lower = q.toLowerCase();
  return rows.map((r) => {
    const hit = hits.find((h) => h.conversationId === r.id);
    if (!hit) return toSummary(r);
    const at = Math.max(0, hit.text.toLowerCase().indexOf(lower) - 40);
    const piece = hit.text.slice(at, at + 140).replace(/\s+/g, ' ').replace(/\[\[(post|idea):\d+\]\]/g, '').trim();
    return toSummary(r, `${at > 0 ? '…' : ''}${piece}${at + 140 < hit.text.length ? '…' : ''}`);
  });
}

export async function renameConversation(db: Db, uid: string, publicId: string, title: string): Promise<ConversationSummary | null> {
  const [row] = await db
    .update(slateConversations)
    .set({ title })
    .where(and(eq(slateConversations.publicId, publicId), eq(slateConversations.userUid, uid)))
    .returning();
  return row ? toSummary(row) : null;
}

export async function setArchived(db: Db, uid: string, publicId: string, archived: boolean, now = new Date()): Promise<ConversationSummary | null> {
  const [row] = await db
    .update(slateConversations)
    .set({ archivedAt: archived ? now : null })
    .where(and(eq(slateConversations.publicId, publicId), eq(slateConversations.userUid, uid)))
    .returning();
  return row ? toSummary(row) : null;
}

/** Deletes the conversation, its messages and its summary. */
export async function deleteConversation(db: Db, uid: string, publicId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(slateConversations)
      .where(and(eq(slateConversations.publicId, publicId), eq(slateConversations.userUid, uid)))
      .for('update');
    if (!row) return false;
    await tx.delete(slateMessages).where(and(eq(slateMessages.conversationId, row.id), eq(slateMessages.userUid, uid)));
    await tx.delete(slateConversations).where(eq(slateConversations.id, row.id));
    return true;
  });
}

export async function loadMessages(db: Db, uid: string, conversationId: number): Promise<MessageRow[]> {
  return db
    .select()
    .from(slateMessages)
    .where(and(eq(slateMessages.conversationId, conversationId), eq(slateMessages.userUid, uid)))
    .orderBy(slateMessages.seq);
}

/** Appends messages with the next sequence numbers (the conversation row is locked meanwhile). */
export async function appendMessages(db: Db, uid: string, conversation: ConversationRow, messages: NewMessage[], now = new Date()): Promise<MessageRow[]> {
  if (!messages.length) return [];
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: slateConversations.id })
      .from(slateConversations)
      .where(and(eq(slateConversations.id, conversation.id), eq(slateConversations.userUid, uid)))
      .for('update');
    if (!locked) throw new Error('conversation not found');
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${slateMessages.seq}), 0)::int` })
      .from(slateMessages)
      .where(eq(slateMessages.conversationId, conversation.id));
    const rows = await tx
      .insert(slateMessages)
      .values(
        messages.map((m, i) => ({
          conversationId: conversation.id,
          userUid: uid,
          seq: max + i + 1,
          role: m.role,
          text: m.text.slice(0, 40_000),
          stopped: m.stopped ? 1 : 0,
          refs: m.refs ?? [],
          proposals: m.proposals ?? [],
          actionIds: m.actionIds ?? [],
          attachments: m.attachments ?? [],
          createdAt: now,
        }))
      )
      .returning();
    await tx.update(slateConversations).set({ lastMessageAt: now }).where(eq(slateConversations.id, conversation.id));
    return rows;
  });
}

/** Stores notes covering messages 1..`through`. Only moves forward, so turns are condensed once. */
export async function saveSummary(db: Db, uid: string, conversationId: number, summary: string, through: number, now = new Date()): Promise<void> {
  await db
    .update(slateConversations)
    .set({ summary: summary.slice(0, 4000), summarizedThrough: sql`greatest(${slateConversations.summarizedThrough}, ${through})`, summaryUpdatedAt: now })
    .where(and(eq(slateConversations.id, conversationId), eq(slateConversations.userUid, uid)));
}

/** Validates turns being imported from this browser's older, device-only chat history. */
export function validImport(raw: unknown): NewMessage[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > CONVERSATION_LIMITS.importTurns) return null;
  const out: NewMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const { role, text } = m as Record<string, unknown>;
    if ((role !== 'user' && role !== 'model') || typeof text !== 'string' || !text.trim() || text.length > CONVERSATION_LIMITS.messageChars * 3) return null;
    out.push({ role, text });
  }
  return out;
}
