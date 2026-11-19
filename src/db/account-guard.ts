/**
 * Database-level write guard for accounts being deleted (installed by
 * src/db/migrations/2026-11-23_account_deletions.sql).
 *
 * Every user table has a BEFORE INSERT OR UPDATE trigger that refuses the write when the row's
 * account has an `account_deletions` row. That covers every write path, including work that
 * started before the lock (a Slate reply still streaming, an upload's last chunk, lazy search
 * indexing) and anything added later. DELETE is never blocked.
 *
 * The request-level gate in requireUser refuses new requests first; this is the backstop.
 */

/** Tables holding per-account data, with their account column. Keep in sync with the migration. */
export const ACCOUNT_TABLES = [
  ['users', 'uid'],
  ['channels', 'user_uid'],
  ['content_items', 'user_uid'],
  ['ideas', 'user_uid'],
  ['uploaded_files', 'user_uid'],
  ['upload_sessions', 'user_uid'],
  ['slate_preferences', 'user_uid'],
  ['slate_actions', 'user_uid'],
  ['slate_action_events', 'user_uid'],
  ['slate_conversations', 'user_uid'],
  ['slate_messages', 'user_uid'],
  ['slate_embeddings', 'user_uid'],
  ['slate_usage_leases', 'user_uid'],
] as const;

/** SQLSTATE raised by the guard. */
export const ACCOUNT_LOCKED_SQLSTATE = 'BKDEL';

/** Whether an error (possibly wrapped by the driver or Drizzle) is the guard refusing a write. */
export function isAccountLockedError(err: unknown): boolean {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4; e = e.cause as typeof e, i++) {
    if (e.code === ACCOUNT_LOCKED_SQLSTATE) return true;
  }
  return false;
}
