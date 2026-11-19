-- Slate Milestone 3: content versioning + Slate action proposals.
-- Preferred: `npm run db:push` (applies src/db/schema.ts). This file is the same change as plain SQL.
-- Safe to run more than once.
--
-- Before running on a real database:
--   1. Take a backup (or a Cloud SQL on-demand backup).
--   2. Check row counts:  SELECT count(*) FROM content_items; SELECT count(*) FROM ideas;
--   3. Apply this migration BEFORE deploying the app version that reads `version`.
--      Older app instances keep working (they ignore the column; their inserts get 1),
--      but their edits don't bump the version, so stale-edit protection is only complete
--      once every instance runs the new code.
--
-- ADD COLUMN with a constant default is metadata-only on Postgres 11+: no table rewrite,
-- and every existing row reads as version 1.

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS slate_actions (
  id serial PRIMARY KEY,
  public_id text NOT NULL CONSTRAINT slate_actions_public_id_unique UNIQUE,
  user_uid text NOT NULL,
  kind text NOT NULL,
  batch_id text,
  target_type text,
  target_id integer,
  base_version integer,
  payload jsonb NOT NULL,
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  result_post_id integer,
  result_idea_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL,
  decided_at timestamp
);
CREATE INDEX IF NOT EXISTS slate_actions_user_idx ON slate_actions (user_uid, created_at);

CREATE TABLE IF NOT EXISTS slate_action_events (
  id serial PRIMARY KEY,
  action_id integer NOT NULL,
  user_uid text NOT NULL,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slate_action_events_action_idx ON slate_action_events (action_id);

-- Rollback (only before any client relies on versions):
--   DROP TABLE IF EXISTS slate_action_events; DROP TABLE IF EXISTS slate_actions;
--   ALTER TABLE content_items DROP COLUMN IF EXISTS version;
--   ALTER TABLE ideas DROP COLUMN IF EXISTS version;
