import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { channels, contentItems, ideas, slateActionEvents, slateActions } from '../../db/schema.ts';
import { convertIdeaVersioned, updatePostVersioned, type IdeaRow, type PostRow, type PostUpdates } from '../content-mutations.ts';
import {
  ACTION_TTL_MS,
  ActionInputError,
  validateEdits,
  type ActionDraft,
  type ActionKind,
  type ActionStatus,
  type ActionView,
  type PostChanges,
  type PostDraft,
} from './actions.ts';

/**
 * Slate action persistence and the executor.
 *
 * Guarantees (each enforced here, server-side):
 * - Every query is scoped to the signed-in uid; another user's action id is "not found".
 * - Execution uses only the stored, server-validated payload. The browser can send edits,
 *   which are re-validated and limited to the fields the action already proposes.
 * - An action applies at most once: the action row is locked and its status checked in the
 *   same transaction as the content write. A repeat call returns the earlier result.
 * - Content writes go through the versioned updates: a post changed since the proposal is
 *   never overwritten (the action becomes "conflict").
 * - Any error rolls back the whole transaction, leaving the content and the action unchanged.
 * - Expired actions (24h) can't be applied.
 * - Every decision is recorded in slate_action_events (ids, versions, outcome; no content).
 */

type Db = PgDatabase<any, any>;
type ActionRow = typeof slateActions.$inferSelect;

function toView(r: ActionRow, now: Date): ActionView {
  const payload = r.payload as { changes?: PostChanges; draft?: PostDraft };
  const status = r.status === 'pending' && r.expiresAt.getTime() <= now.getTime() ? 'expired' : (r.status as ActionStatus);
  return {
    id: r.publicId,
    kind: r.kind as ActionKind,
    status,
    batchId: r.batchId,
    target: r.targetType && r.targetId ? { type: r.targetType as 'post' | 'idea', id: r.targetId, title: r.targetTitle } : null,
    ...(payload.changes ? { changes: payload.changes, before: r.before as PostChanges } : {}),
    ...(payload.draft ? { draft: payload.draft } : {}),
    summary: r.summary,
    reason: r.reason,
    expiresAt: r.expiresAt.toISOString(),
    resultPostId: r.resultPostId,
    resultIdeaId: r.resultIdeaId,
  };
}

async function audit(db: Db, row: Pick<ActionRow, 'id' | 'userUid'>, event: string, detail: Record<string, unknown> = {}) {
  await db.insert(slateActionEvents).values({ actionId: row.id, userUid: row.userUid, event, detail });
}

/** Saves validated drafts as pending actions (called once the reply completes). */
export async function persistDrafts(db: Db, uid: string, drafts: ActionDraft[], now = new Date()): Promise<ActionView[]> {
  if (!drafts.length) return [];
  const batchIds = new Map<string, string>();
  const expiresAt = new Date(now.getTime() + ACTION_TTL_MS);
  return db.transaction(async (tx) => {
    const views: ActionView[] = [];
    for (const d of drafts) {
      let batchId: string | null = null;
      if (d.batchKey) {
        batchId = batchIds.get(d.batchKey) ?? randomUUID();
        batchIds.set(d.batchKey, batchId);
      }
      const [row] = await tx
        .insert(slateActions)
        .values({
          publicId: randomUUID(),
          userUid: uid,
          kind: d.kind,
          batchId,
          targetType: d.target?.type ?? null,
          targetId: d.target?.id ?? null,
          baseVersion: d.baseVersion,
          payload: (d.changes ? { changes: d.changes } : d.draft ? { draft: d.draft } : {}) as Record<string, unknown>,
          before: (d.before ?? {}) as Record<string, unknown>,
          targetTitle: d.target?.title ?? '',
          summary: d.summary,
          reason: d.reason,
          status: 'pending',
          createdAt: now,
          expiresAt,
        })
        .returning();
      await audit(tx, row, 'proposed', { kind: d.kind, target: d.target ? `${d.target.type}:${d.target.id}` : null, baseVersion: d.baseVersion, fields: Object.keys(d.changes ?? d.draft ?? {}) });
      views.push(toView(row, now));
    }
    return views;
  });
}

/** The creator's actions by public id (unknown or foreign ids are simply absent). */
export async function getActions(db: Db, uid: string, ids: string[], now = new Date()): Promise<ActionView[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(slateActions).where(and(eq(slateActions.userUid, uid), inArray(slateActions.publicId, ids.slice(0, 50))));
  return rows.map((r) => toView(r, now));
}

export type ActionResult =
  | { ok: true; status: 200; action: ActionView; item?: PostRow; idea?: IdeaRow; alreadyApplied?: boolean }
  | { ok: false; status: 400 | 404 | 409 | 410; code: string; error: string; action?: ActionView; current?: PostRow | IdeaRow };

const NOT_FOUND: ActionResult = { ok: false, status: 404, code: 'not_found', error: 'That suggestion isn’t available.' };

function closed(row: ActionRow, now: Date): Extract<ActionResult, { ok: false }> | null {
  const view = toView(row, now);
  if (view.status === 'expired') return { ok: false, status: 410, code: 'expired', error: 'This suggestion expired. Ask Slate again.', action: view };
  if (row.status === 'dismissed') return { ok: false, status: 409, code: 'dismissed', error: 'This suggestion was dismissed.', action: view };
  if (row.status === 'conflict') return { ok: false, status: 409, code: 'version_conflict', error: 'This changed after Slate suggested it. Ask Slate again for an up-to-date suggestion.', action: view };
  if (row.status === 'failed') return { ok: false, status: 409, code: 'failed', error: 'This suggestion can’t be applied anymore. Ask Slate again.', action: view };
  return null;
}

async function lockAction(tx: Db, uid: string, publicId: string): Promise<ActionRow | null> {
  const [row] = await tx
    .select()
    .from(slateActions)
    .where(and(eq(slateActions.publicId, publicId), eq(slateActions.userUid, uid)))
    .for('update');
  return row ?? null;
}

export async function dismissAction(db: Db, uid: string, publicId: string, now = new Date()): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const row = await lockAction(tx, uid, publicId);
    if (!row) return NOT_FOUND;
    if (row.status !== 'pending') {
      return { ok: false, status: 409, code: row.status, error: row.status === 'applied' ? 'This suggestion was already applied.' : 'This suggestion is already closed.', action: toView(row, now) };
    }
    const [updated] = await tx.update(slateActions).set({ status: 'dismissed', decidedAt: now }).where(eq(slateActions.id, row.id)).returning();
    await audit(tx, row, 'dismissed');
    return { ok: true, status: 200, action: toView(updated, now) };
  });
}

export interface ApplyHooks {
  /** Tests only: runs after the content write, inside the transaction. */
  afterWrite?: () => Promise<void> | void;
}

/**
 * Applies one approved action. `rawEdits` are the creator's edits from the preview card.
 * Everything else comes from the stored action.
 */
export async function applyAction(db: Db, uid: string, publicId: string, rawEdits: unknown, now = new Date(), hooks: ApplyHooks = {}): Promise<ActionResult> {
  return db.transaction(async (tx) => {
    const row = await lockAction(tx, uid, publicId);
    if (!row) return NOT_FOUND;

    if (row.status === 'applied') {
      // Idempotent: report the earlier result without writing again.
      const [item] = row.resultPostId
        ? await tx.select().from(contentItems).where(and(eq(contentItems.id, row.resultPostId), eq(contentItems.userUid, uid)))
        : [];
      await audit(tx, row, 'already_applied');
      return { ok: true, status: 200, action: toView(row, now), item, alreadyApplied: true };
    }
    const isClosed = closed(row, now);
    if (isClosed) {
      if (isClosed.code === 'expired' && row.status === 'pending') {
        await tx.update(slateActions).set({ status: 'expired', decidedAt: now }).where(eq(slateActions.id, row.id));
        await audit(tx, row, 'expired');
      }
      return isClosed;
    }

    const kind = row.kind as ActionKind;
    const payload = row.payload as { changes?: PostChanges; draft?: PostDraft };
    let edits: PostChanges;
    try {
      edits = validateEdits(kind, Object.keys(payload.changes ?? {}), rawEdits);
    } catch (err) {
      if (err instanceof ActionInputError) return { ok: false, status: 400, code: 'invalid_edit', error: err.message };
      throw err;
    }
    const edited = Object.keys(edits).length > 0;

    const finish = async (result: { resultPostId?: number; resultIdeaId?: number }, detail: Record<string, unknown>) => {
      await hooks.afterWrite?.();
      const [updated] = await tx
        .update(slateActions)
        .set({ status: 'applied', decidedAt: now, resultPostId: result.resultPostId ?? null, resultIdeaId: result.resultIdeaId ?? null })
        .where(eq(slateActions.id, row.id))
        .returning();
      if (edited) await audit(tx, row, 'edited', { fields: Object.keys(edits) });
      await audit(tx, row, 'applied', detail);
      return updated;
    };

    const conflict = async (current: PostRow | IdeaRow): Promise<ActionResult> => {
      const [updated] = await tx.update(slateActions).set({ status: 'conflict', decidedAt: now }).where(eq(slateActions.id, row.id)).returning();
      await audit(tx, row, 'conflict', { baseVersion: row.baseVersion, currentVersion: current.version });
      return {
        ok: false,
        status: 409,
        code: 'version_conflict',
        error: `“${row.targetTitle}” changed after Slate suggested this, so nothing was applied. Ask Slate again for an up-to-date suggestion.`,
        action: toView(updated, now),
        current,
      };
    };

    if (kind === 'post_update' || kind === 'stage_change' || kind === 'target_date') {
      if (row.targetType !== 'post' || !row.targetId || row.baseVersion === null || !payload.changes) return NOT_FOUND;
      const changes: PostChanges = { ...payload.changes, ...edits };
      const result = await updatePostVersioned(tx, uid, row.targetId, row.baseVersion, changes as PostUpdates);
      if (result.kind === 'not_found') {
        const [updated] = await tx.update(slateActions).set({ status: 'failed', decidedAt: now }).where(eq(slateActions.id, row.id)).returning();
        await audit(tx, row, 'failed', { reason: 'target_missing' });
        return { ok: false, status: 404, code: 'target_missing', error: 'That post no longer exists.', action: toView(updated, now) };
      }
      if (result.kind === 'conflict') return conflict(result.current);
      const item = result.row;
      const updated = await finish({ resultPostId: item.id }, { kind, target: `post:${item.id}`, baseVersion: row.baseVersion, newVersion: item.version, fields: Object.keys(changes), unchanged: result.kind === 'unchanged' });
      return { ok: true, status: 200, action: toView(updated, now), item };
    }

    if (kind === 'post_create') {
      if (!payload.draft) return NOT_FOUND;
      const draft: PostDraft = { ...payload.draft, ...(edits as Partial<PostDraft>) };
      // Channel and sources were checked at proposal time; re-check in case they were deleted since.
      let channelId = draft.channelId;
      if (channelId !== null) {
        const [c] = await tx.select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.userUid, uid)));
        if (!c) channelId = null;
      }
      let repurposedFromPostId = draft.repurposedFromPostId ?? null;
      if (repurposedFromPostId !== null) {
        const [p] = await tx.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.id, repurposedFromPostId), eq(contentItems.userUid, uid)));
        if (!p) repurposedFromPostId = null;
      }
      let sourceIdeaId = draft.sourceIdeaId ?? null;
      if (sourceIdeaId !== null) {
        const [i] = await tx.select({ id: ideas.id }).from(ideas).where(and(eq(ideas.id, sourceIdeaId), eq(ideas.userUid, uid)));
        if (!i) sourceIdeaId = null;
      }
      const [item] = await tx
        .insert(contentItems)
        .values({
          userUid: uid,
          title: draft.title,
          platform: draft.platform,
          channelId,
          channelName: draft.channelName,
          status: 'idea',
          caption: draft.caption,
          tags: draft.tags,
          notes: draft.notes,
          targetDate: draft.targetDate,
          repurposedFromPostId,
          sourceIdeaId,
        })
        .returning();
      const updated = await finish({ resultPostId: item.id }, { kind, target: `post:${item.id}`, newVersion: item.version, ...(repurposedFromPostId ? { from: `post:${repurposedFromPostId}` } : {}), ...(sourceIdeaId ? { from: `idea:${sourceIdeaId}` } : {}) });
      return { ok: true, status: 200, action: toView(updated, now), item };
    }

    if (kind === 'idea_convert') {
      if (row.targetType !== 'idea' || !row.targetId) return NOT_FOUND;
      const result = await convertIdeaVersioned(tx, uid, row.targetId, row.baseVersion);
      if (result.kind === 'not_found') {
        const [updated] = await tx.update(slateActions).set({ status: 'failed', decidedAt: now }).where(eq(slateActions.id, row.id)).returning();
        await audit(tx, row, 'failed', { reason: 'target_missing' });
        return { ok: false, status: 404, code: 'target_missing', error: 'That idea no longer exists.', action: toView(updated, now) };
      }
      if (result.kind === 'conflict') return conflict(result.current);
      const updated = await finish(
        { resultPostId: result.item.id, resultIdeaId: result.idea.id },
        { kind, target: `idea:${result.idea.id}`, post: `post:${result.item.id}`, existing: result.kind === 'existing' }
      );
      return { ok: true, status: 200, action: toView(updated, now), item: result.item, idea: result.idea };
    }

    return NOT_FOUND;
  });
}
