-- Channel platform: which platform a channel is on (youtube_long, youtube_short, instagram_reel,
-- tiktok, instagram_post or other), chosen when the channel is added. Additive and safe to run
-- more than once; existing channels get 'other'.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'other';

-- Rollback:
-- ALTER TABLE channels DROP COLUMN IF EXISTS platform;
