-- Slate Milestone 5: semantic search index, repurposing link, image attachments, image quota.
-- Preferred: `npm run db:push` (applies src/db/schema.ts). Safe to run more than once.
-- Apply after 2026-11-20_slate_conversations.sql.

-- Search index entries (OpenAI embeddings), per creator; derived data, deleted with the record.
CREATE TABLE IF NOT EXISTS slate_embeddings (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  target_type text NOT NULL,
  target_id integer NOT NULL,
  model text NOT NULL,
  content_hash text NOT NULL,
  vector real[] NOT NULL,
  updated_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS slate_embeddings_target_uq ON slate_embeddings (user_uid, target_type, target_id);

-- Repurposed drafts point at their source post; deleting the source keeps the draft (SET NULL).
-- A nullable column without a default: metadata-only, no table rewrite.
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS repurposed_from_post_id integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_items_repurposed_from_post_id_content_items_id_fk') THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_repurposed_from_post_id_content_items_id_fk
      FOREIGN KEY (repurposed_from_post_id) REFERENCES content_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Which image a message asked Slate about (labels only, never the file).
ALTER TABLE slate_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Image requests have their own daily limit.
ALTER TABLE slate_usage_leases ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat';

-- Rollback:
--   ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_repurposed_from_post_id_content_items_id_fk;
--   ALTER TABLE content_items DROP COLUMN IF EXISTS repurposed_from_post_id;
--   ALTER TABLE slate_messages DROP COLUMN IF EXISTS attachments;
--   ALTER TABLE slate_usage_leases DROP COLUMN IF EXISTS kind;
--   DROP TABLE IF EXISTS slate_embeddings;
