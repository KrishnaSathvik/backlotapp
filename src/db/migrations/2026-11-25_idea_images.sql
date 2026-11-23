-- Idea reference images: up to 6 uploaded images per idea (file URLs, /api/files/...). The
-- existing screenshot_url stays and mirrors the first image. Ideas saved before this column
-- read their screenshot as the first image (in code), so no rows are rewritten here.
-- Additive and safe to run more than once.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Rollback:
-- ALTER TABLE ideas DROP COLUMN IF EXISTS images;
