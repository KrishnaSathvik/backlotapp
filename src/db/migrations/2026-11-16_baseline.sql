-- Baseline: the core tables that existed before Slate Milestone 2.
--
-- Until the Supabase migration these tables were only ever created by `drizzle-kit push`, so no
-- SQL file described them and a fresh database couldn't be built from src/db/migrations alone.
-- This file creates them exactly as they were before 2026-11-17 (later files add `version`
-- and `repurposed_from_post_id`). Safe to run more than once, and a no-op on a database that
-- already has these tables.

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  uid text NOT NULL CONSTRAINT users_uid_unique UNIQUE,
  email text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  name text NOT NULL,
  handle text NOT NULL DEFAULT '',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channels_user_idx ON channels (user_uid);

CREATE TABLE IF NOT EXISTS content_items (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  title text NOT NULL,
  platform text NOT NULL DEFAULT 'youtube_long',
  channel_id integer,
  channel_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'idea',
  caption text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  live_link text NOT NULL DEFAULT '',
  post_date text NOT NULL DEFAULT '',
  target_date text NOT NULL DEFAULT '',
  cover_asset jsonb DEFAULT 'null'::jsonb,
  video_asset jsonb DEFAULT 'null'::jsonb,
  slides jsonb NOT NULL DEFAULT '[]'::jsonb,
  attached_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_idea_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_items_user_idx ON content_items (user_uid);

CREATE TABLE IF NOT EXISTS ideas (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  title text NOT NULL,
  link_url text NOT NULL DEFAULT '',
  link_title text NOT NULL DEFAULT '',
  link_domain text NOT NULL DEFAULT '',
  screenshot_url text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  platform text NOT NULL DEFAULT 'youtube_long',
  channel_name text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_date text NOT NULL DEFAULT '',
  converted_item_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ideas_user_idx ON ideas (user_uid);

CREATE TABLE IF NOT EXISTS uploaded_files (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  storage_key text NOT NULL CONSTRAINT uploaded_files_storage_key_unique UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploaded_files_user_idx ON uploaded_files (user_uid);

-- Rollback (fresh databases only; these tables hold all creator content):
--   DROP TABLE IF EXISTS uploaded_files, ideas, content_items, channels, users;
