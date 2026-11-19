import type { PgDatabase } from 'drizzle-orm/pg-core';
import { mentionedRefs, notesBlock, planWindow, summarizeOverflow } from './continuity.ts';
import { appendMessages, createConversation, getConversation, loadMessages, saveSummary, titleFrom, type ConversationRow } from './conversations-db.ts';
import type { Turn } from './prompt.ts';
import type { SlateProvider } from './providers.ts';
import type { ReplyReport } from './stream.ts';

/**
 * One Slate turn against a saved conversation:
 * - prepareTurn: finds (or starts) the creator's conversation, saves their message,
 *   and builds what the model sees: the recent window plus notes on older turns.
 * - saveReply: stores what the creator actually received once the reply settles.
 */

type Db = PgDatabase<any, any>;

export type PreparedTurn =
  | { ok: true; conversation: ConversationRow; created: boolean; history: Turn[]; notes: string }
  | { ok: false; status: 404; error: string };

export async function prepareTurn(
  db: Db,
  uid: string,
  req: { conversationId: string | null; message: string; attachments?: { kind: 'image'; label: string }[] },
  summarizers: SlateProvider[],
  opts: {
    now?: Date;
    signal?: AbortSignal;
    summaryTimeoutMs?: number;
    /** uid-scoped existence check, so deleted posts and ideas are flagged as gone. */
    exists?: (type: 'post' | 'idea', id: number) => Promise<boolean>;
  } = {}
): Promise<PreparedTurn> {
  const now = opts.now ?? new Date();
  let conversation: ConversationRow | null;
  let created = false;
  if (req.conversationId) {
    conversation = await getConversation(db, uid, req.conversationId);
    if (!conversation) return { ok: false, status: 404, error: 'That conversation isn’t available. Start a new chat.' };
  } else {
    conversation = await createConversation(db, uid, titleFrom(req.message), now);
    created = true;
  }

  const stored = created ? [] : await loadMessages(db, uid, conversation.id);
  // A retry after a failed reply resends the same message: reuse it rather than duplicating it.
  const last = stored.at(-1);
  const isRetry = last?.role === 'user' && last.text === req.message;
  const earlier = isRetry ? stored.slice(0, -1) : stored;
  if (!isRetry) await appendMessages(db, uid, conversation, [{ role: 'user', text: req.message, attachments: req.attachments }], now);

  const { window, overflow } = planWindow(earlier, conversation.summarizedThrough);
  let notes = conversation.summary;
  let through = conversation.summarizedThrough;
  if (overflow.length) {
    const updated = await summarizeOverflow(summarizers, conversation.summary, overflow, { timeoutMs: opts.summaryTimeoutMs, signal: opts.signal });
    if (updated) {
      notes = updated;
      through = overflow[overflow.length - 1].seq;
      await saveSummary(db, uid, conversation.id, updated, through, now);
    }
    // If no notes could be written, the conversation still continues with the recent window.
  }

  // Earlier turns may mention posts or ideas deleted since: tell the model which are gone.
  const missing: string[] = [];
  if (opts.exists) {
    for (const ref of mentionedRefs([notes, ...window.map((t) => t.text)])) {
      if (!(await opts.exists(ref.type, ref.id))) missing.push(`${ref.type}:${ref.id}`);
    }
  }
  return { ok: true, conversation, created, history: window, notes: notesBlock(notes, through, missing) };
}

/** Saves the reply as the creator saw it (partial replies are marked as cut short). */
export async function saveReply(db: Db, uid: string, conversation: ConversationRow, report: ReplyReport, now = new Date()): Promise<void> {
  const text = report.text ?? '';
  if (!text.trim()) return; // Nothing was shown, so nothing to keep; a retry reuses the question.
  await appendMessages(
    db,
    uid,
    conversation,
    [
      {
        role: 'model',
        text,
        stopped: report.status !== 'done' || !!report.cutShort,
        refs: report.refs ?? [],
        proposals: report.proposals ?? [],
        actionIds: report.actionIds ?? [],
      },
    ],
    now
  );
}
