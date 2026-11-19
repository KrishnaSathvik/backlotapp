import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { contentItems, ideas } from '../db/schema.ts';
import { convertIdeaToPostDraft, type PlatformKey } from './content-logic.ts';

/**
 * Versioned writes for posts and ideas. Every successful change bumps `version` by one
 * in the same statement that checks it, so two writers can never both succeed from the
 * same starting version. Used by the manual edit routes and by Slate's action executor.
 * Takes a db handle (or a transaction) so tests can run it against PGlite.
 */

type Db = PgDatabase<any, any>;
export type PostRow = typeof contentItems.$inferSelect;
export type IdeaRow = typeof ideas.$inferSelect;
export type PostUpdates = Partial<Omit<typeof contentItems.$inferInsert, 'id' | 'userUid' | 'version' | 'createdAt' | 'updatedAt'>>;
export type IdeaUpdates = Partial<Omit<typeof ideas.$inferInsert, 'id' | 'userUid' | 'version' | 'createdAt' | 'convertedItemId'>>;

export type WriteResult<T> =
  | { kind: 'updated'; row: T; before: T }
  | { kind: 'unchanged'; row: T }
  | { kind: 'not_found' }
  | { kind: 'conflict'; current: T };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Only the fields whose value actually changes (so a no-op save doesn't bump the version). */
function changedFields<T extends Record<string, unknown>>(before: Record<string, unknown>, updates: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined && !same(before[k], v)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Updates a post only if it is still at `expectedVersion`.
 * A missing post and another user's post both return not_found.
 */
export async function updatePostVersioned(db: Db, uid: string, id: number, expectedVersionIn: number | null, updates: PostUpdates): Promise<WriteResult<PostRow>> {
  const where = and(eq(contentItems.id, id), eq(contentItems.userUid, uid));
  const [before] = await db.select().from(contentItems).where(where).limit(1);
  if (!before) return { kind: 'not_found' };
  // null = transitional unversioned write: checks against the version just read.
  const expectedVersion = expectedVersionIn ?? before.version;
  if (before.version !== expectedVersion) return { kind: 'conflict', current: before };
  const changes = changedFields(before, updates);
  if (!Object.keys(changes).length) return { kind: 'unchanged', row: before };

  const [row] = await db
    .update(contentItems)
    .set({ ...changes, version: sql`${contentItems.version} + 1`, updatedAt: new Date() })
    .where(and(where, eq(contentItems.version, expectedVersion)))
    .returning();
  if (row) return { kind: 'updated', row, before };

  // Changed between the read and the write (or deleted).
  const [current] = await db.select().from(contentItems).where(where).limit(1);
  return current ? { kind: 'conflict', current } : { kind: 'not_found' };
}

export async function updateIdeaVersioned(db: Db, uid: string, id: number, expectedVersionIn: number | null, updates: IdeaUpdates): Promise<WriteResult<IdeaRow>> {
  const where = and(eq(ideas.id, id), eq(ideas.userUid, uid));
  const [before] = await db.select().from(ideas).where(where).limit(1);
  if (!before) return { kind: 'not_found' };
  // null = transitional unversioned write: checks against the version just read.
  const expectedVersion = expectedVersionIn ?? before.version;
  if (before.version !== expectedVersion) return { kind: 'conflict', current: before };
  const changes = changedFields(before, updates);
  if (!Object.keys(changes).length) return { kind: 'unchanged', row: before };

  const [row] = await db
    .update(ideas)
    .set({ ...changes, version: sql`${ideas.version} + 1` })
    .where(and(where, eq(ideas.version, expectedVersion)))
    .returning();
  if (row) return { kind: 'updated', row, before };
  const [current] = await db.select().from(ideas).where(where).limit(1);
  return current ? { kind: 'conflict', current } : { kind: 'not_found' };
}

export type ConvertResult =
  | { kind: 'created' | 'existing'; item: PostRow; idea: IdeaRow }
  | { kind: 'not_found' }
  | { kind: 'conflict'; current: IdeaRow };

/**
 * Turns an idea into a post in one transaction, keeping `sourceIdeaId`.
 * Idempotent: an idea that's already converted returns its existing post, whatever the
 * version. Otherwise the idea must still be at `expectedVersion` (null skips the check;
 * only used by the transitional unversioned path).
 */
export async function convertIdeaVersioned(db: Db, uid: string, ideaId: number, expectedVersion: number | null): Promise<ConvertResult> {
  return db.transaction(async (tx) => {
    // Lock the idea row so concurrent clicks cannot both convert it.
    const [idea] = await tx
      .select()
      .from(ideas)
      .where(and(eq(ideas.id, ideaId), eq(ideas.userUid, uid)))
      .for('update');
    if (!idea) return { kind: 'not_found' } as const;

    if (idea.convertedItemId) {
      const [existing] = await tx
        .select()
        .from(contentItems)
        .where(and(eq(contentItems.id, idea.convertedItemId), eq(contentItems.userUid, uid)));
      if (existing) return { kind: 'existing', item: existing, idea } as const;
    }
    if (expectedVersion !== null && idea.version !== expectedVersion) return { kind: 'conflict', current: idea } as const;

    const draft = convertIdeaToPostDraft({
      ...idea,
      platform: idea.platform as PlatformKey,
      createdAt: idea.createdAt.toISOString(),
    });
    const [item] = await tx
      .insert(contentItems)
      .values({
        userUid: uid,
        title: draft.title,
        platform: draft.platform,
        channelName: draft.channelName,
        status: draft.status,
        caption: draft.caption,
        tags: draft.tags,
        notes: draft.notes,
        targetDate: draft.targetDate,
        attachedReferences: draft.attachedReferences,
        sourceIdeaId: idea.id,
      })
      .returning();
    const [updatedIdea] = await tx
      .update(ideas)
      .set({ convertedItemId: item.id, version: sql`${ideas.version} + 1` })
      .where(and(eq(ideas.id, idea.id), eq(ideas.userUid, uid)))
      .returning();
    return { kind: 'created', item, idea: updatedIdea } as const;
  });
}

/* ---------------- expected-version handling for API routes ---------------- */

export const VERSION_REQUIRED_MESSAGE = 'Backlot was updated. Refresh the page to keep editing.';

export function conflictMessage(kind: 'post' | 'idea') {
  return `This ${kind} changed somewhere else (another tab, device or Slate) since you opened it. We loaded the latest version, so check it and save again if you still want your change.`;
}

/**
 * Reads `expectedVersion` from a request body.
 * - A valid positive integer is returned as-is.
 * - Missing: rejected (428). During a rollout only, BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL
 *   (a UTC date or timestamp) lets tabs loaded before the release finish an edit, with each
 *   use logged. After that moment the variable is ignored, so it can't stay on by accident.
 */
export function readExpectedVersion(body: Record<string, unknown>, env: Record<string, string | undefined> = process.env, now = new Date()):
  | { ok: true; version: number | null }
  | { ok: false; status: 400 | 428; error: string; code: string } {
  const v = body.expectedVersion;
  if (v === undefined || v === null) {
    if (unversionedWritesAllowed(env, now)) {
      console.warn('backlot unversioned write accepted (rollout window)');
      return { ok: true, version: null };
    }
    return { ok: false, status: 428, error: VERSION_REQUIRED_MESSAGE, code: 'version_required' };
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2_147_483_647) {
    return { ok: false, status: 400, error: 'expectedVersion must be a positive integer.', code: 'invalid_version' };
  }
  return { ok: true, version: v };
}

/** True only before a valid BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL moment (at most 30 days ahead). */
export function unversionedWritesAllowed(env: Record<string, string | undefined>, now = new Date()): boolean {
  const raw = env.BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL?.trim();
  if (!raw) return false;
  const until = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(until.getTime())) return false;
  const maxWindow = 30 * 86_400_000;
  return now < until && until.getTime() - now.getTime() <= maxWindow;
}
