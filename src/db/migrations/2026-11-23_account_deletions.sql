-- Launch L2/L3: self-serve account deletion jobs and the account write guard
-- (see docs/ACCOUNT_DELETION.md). Safe to run more than once.
--
-- Apply this file with psql even if you use `npm run db:push`: db:push creates the table but
-- not the trigger function and triggers below.

CREATE TABLE IF NOT EXISTS account_deletions (
  id serial PRIMARY KEY,
  user_uid text NOT NULL CONSTRAINT account_deletions_user_uid_unique UNIQUE,
  -- SHA-256 (hex) of the status-page token; the token itself is never stored.
  status_token_hash text NOT NULL CONSTRAINT account_deletions_status_token_hash_unique UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  requested_at timestamp NOT NULL,
  next_attempt_at timestamp NOT NULL,
  locked_until timestamp,
  updated_at timestamp NOT NULL,
  completed_at timestamp
);
CREATE INDEX IF NOT EXISTS account_deletions_due_idx ON account_deletions (status, next_attempt_at);

-- Account write guard. Once an account has a deletion row, no INSERT or UPDATE can touch its
-- rows in any user table, whatever code path issues it (a Slate reply that was already
-- streaming, an upload finishing, a background task). DELETE is always allowed, so the
-- deletion job and the retention cleanups still work. Keep this list in sync with
-- ACCOUNT_TABLES in src/db/account-guard.ts.
CREATE OR REPLACE FUNCTION backlot_block_locked_account_writes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Writes caused by a foreign-key action (ON DELETE SET NULL when a post another post was
  -- adapted from is deleted) run one trigger level down. They are part of a delete, so allow them.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  -- Operator escape hatch for migrations, backfills and restores, scoped to one transaction:
  --   BEGIN; SET LOCAL backlot.account_guard = 'off'; ...; COMMIT;
  -- The app never sets it. See docs/ACCOUNT_DELETION.md "Write guard".
  IF current_setting('backlot.account_guard', true) = 'off' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM account_deletions WHERE user_uid = to_jsonb(NEW) ->> TG_ARGV[0]) THEN
    RAISE EXCEPTION 'account is being deleted' USING ERRCODE = 'BKDEL';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('users', 'uid'), ('channels', 'user_uid'), ('content_items', 'user_uid'), ('ideas', 'user_uid'),
    ('uploaded_files', 'user_uid'), ('upload_sessions', 'user_uid'), ('slate_preferences', 'user_uid'),
    ('slate_actions', 'user_uid'), ('slate_action_events', 'user_uid'), ('slate_conversations', 'user_uid'),
    ('slate_messages', 'user_uid'), ('slate_embeddings', 'user_uid'), ('slate_usage_leases', 'user_uid')
  ) AS v(tbl, col) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS backlot_account_guard ON %I', t.tbl);
    EXECUTE format(
      'CREATE TRIGGER backlot_account_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION backlot_block_locked_account_writes(%L)',
      t.tbl, t.col);
  END LOOP;
END $$;

-- Rollback (only if no deletion is in progress; an existing row is what keeps an account locked):
-- DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['users','channels','content_items','ideas','uploaded_files','upload_sessions','slate_preferences','slate_actions','slate_action_events','slate_conversations','slate_messages','slate_embeddings','slate_usage_leases'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS backlot_account_guard ON %I', t); END LOOP; END $$;
-- DROP FUNCTION IF EXISTS backlot_block_locked_account_writes();
-- DROP TABLE IF EXISTS account_deletions;
