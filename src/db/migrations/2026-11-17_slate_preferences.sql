-- Slate Milestone 2: creative preferences.
-- Preferred: `npm run db:push` (applies src/db/schema.ts). This file is the same change as plain SQL
-- for environments where push isn't used. Safe to run more than once.
CREATE TABLE IF NOT EXISTS slate_preferences (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  channel_id integer,
  key text NOT NULL,
  value text NOT NULL,
  source text NOT NULL DEFAULT 'user',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slate_preferences_user_idx ON slate_preferences (user_uid);
CREATE UNIQUE INDEX IF NOT EXISTS slate_preferences_scope_key_uq ON slate_preferences (user_uid, coalesce(channel_id, 0), key);
