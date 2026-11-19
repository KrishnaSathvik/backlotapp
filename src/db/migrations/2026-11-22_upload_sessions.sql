-- Launch L1: chunked uploads tracked in Postgres so any instance can continue them and
-- cleanup can cancel abandoned ones (media itself moves to private Cloud Storage).
-- Preferred: `npm run db:push`. Safe to run more than once. New table only.

CREATE TABLE IF NOT EXISTS upload_sessions (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  upload_id text NOT NULL,
  storage_key text NOT NULL CONSTRAINT upload_sessions_storage_key_unique UNIQUE,
  session_ref text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  total_size bigint NOT NULL,
  received bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp NOT NULL,
  updated_at timestamp NOT NULL,
  expires_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS upload_sessions_user_upload_uq ON upload_sessions (user_uid, upload_id);
CREATE INDEX IF NOT EXISTS upload_sessions_status_idx ON upload_sessions (status, expires_at);

-- Rollback: DROP TABLE IF EXISTS upload_sessions;
