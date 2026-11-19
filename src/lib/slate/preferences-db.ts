import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { channels, slatePreferences } from '../../db/schema.ts';
import { validatePreference, type PreferenceRecord, type PreferenceSource } from './preferences.ts';

/**
 * Preference writes. Only the preferences API routes use this; Slate's model tools
 * never get write access, so a preference is saved only by an explicit creator action.
 */

type Db = PgDatabase<any, any>;

export type PrefResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };

const toRecord = (r: typeof slatePreferences.$inferSelect): PreferenceRecord => ({
  id: r.id,
  channelId: r.channelId ?? null,
  key: r.key as PreferenceRecord['key'],
  value: r.value,
  source: r.source as PreferenceSource,
  updatedAt: r.updatedAt.toISOString(),
});

async function ownsChannel(db: Db, uid: string, channelId: number) {
  const [row] = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.id, channelId), eq(channels.userUid, uid))).limit(1);
  return !!row;
}

export async function listPreferenceRecords(db: Db, uid: string): Promise<PreferenceRecord[]> {
  const rows = await db.select().from(slatePreferences).where(eq(slatePreferences.userUid, uid)).orderBy(slatePreferences.key, slatePreferences.id).limit(200);
  return rows.map(toRecord);
}

/** Creates or replaces the value for (channel scope, key). */
export async function savePreference(
  db: Db,
  uid: string,
  input: { key: unknown; value: unknown; channelId: number | null; source: PreferenceSource }
): Promise<PrefResult<PreferenceRecord>> {
  const v = validatePreference(input.key, input.value);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  if (input.channelId !== null && !(await ownsChannel(db, uid, input.channelId))) {
    return { ok: false, status: 404, error: 'That channel isn’t in your Backlot.' };
  }
  const scope = input.channelId === null ? isNull(slatePreferences.channelId) : eq(slatePreferences.channelId, input.channelId);
  const [existing] = await db
    .select()
    .from(slatePreferences)
    .where(and(eq(slatePreferences.userUid, uid), scope, eq(slatePreferences.key, v.key)))
    .limit(1);
  if (existing) {
    const [row] = await db
      .update(slatePreferences)
      .set({ value: v.value, source: input.source, updatedAt: new Date() })
      .where(and(eq(slatePreferences.id, existing.id), eq(slatePreferences.userUid, uid)))
      .returning();
    return { ok: true, value: toRecord(row) };
  }
  const [row] = await db
    .insert(slatePreferences)
    .values({ userUid: uid, channelId: input.channelId, key: v.key, value: v.value, source: input.source })
    .returning();
  return { ok: true, value: toRecord(row) };
}

export async function updatePreferenceValue(db: Db, uid: string, id: number, value: unknown): Promise<PrefResult<PreferenceRecord>> {
  const [existing] = await db.select().from(slatePreferences).where(and(eq(slatePreferences.id, id), eq(slatePreferences.userUid, uid))).limit(1);
  if (!existing) return { ok: false, status: 404, error: 'Preference not found.' };
  const v = validatePreference(existing.key, value);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const [row] = await db
    .update(slatePreferences)
    .set({ value: v.value, source: 'user', updatedAt: new Date() })
    .where(and(eq(slatePreferences.id, id), eq(slatePreferences.userUid, uid)))
    .returning();
  return { ok: true, value: toRecord(row) };
}

export async function deletePreference(db: Db, uid: string, id: number): Promise<PrefResult<true>> {
  const rows = await db.delete(slatePreferences).where(and(eq(slatePreferences.id, id), eq(slatePreferences.userUid, uid))).returning({ id: slatePreferences.id });
  return rows.length ? { ok: true, value: true } : { ok: false, status: 404, error: 'Preference not found.' };
}
