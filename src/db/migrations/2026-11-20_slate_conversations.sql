-- Slate Milestone 4: conversations saved per creator (continue on any device).
-- Preferred: `npm run db:push` (applies src/db/schema.ts). Safe to run more than once.
-- New tables only; no existing rows change.

CREATE TABLE IF NOT EXISTS slate_conversations (
  id serial PRIMARY KEY,
  public_id text NOT NULL CONSTRAINT slate_conversations_public_id_unique UNIQUE,
  user_uid text NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  summary text NOT NULL DEFAULT '',
  summarized_through integer NOT NULL DEFAULT 0,
  summary_updated_at timestamp,
  archived_at timestamp,
  created_at timestamp NOT NULL,
  last_message_at timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS slate_conversations_user_idx ON slate_conversations (user_uid, last_message_at);

CREATE TABLE IF NOT EXISTS slate_messages (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  user_uid text NOT NULL,
  seq integer NOT NULL,
  role text NOT NULL,
  text text NOT NULL,
  stopped integer NOT NULL DEFAULT 0,
  refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  action_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS slate_messages_conversation_seq_uq ON slate_messages (conversation_id, seq);
CREATE INDEX IF NOT EXISTS slate_messages_user_idx ON slate_messages (user_uid);

-- Rollback: DROP TABLE IF EXISTS slate_messages; DROP TABLE IF EXISTS slate_conversations;
