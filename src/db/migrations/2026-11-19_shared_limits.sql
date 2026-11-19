-- Slate release hardening: request limits and circuit-breaker state shared across instances.
-- Preferred: `npm run db:push` (applies src/db/schema.ts). Safe to run more than once.
-- New tables only; no existing rows change.

CREATE TABLE IF NOT EXISTS slate_usage_leases (
  id serial PRIMARY KEY,
  user_uid text NOT NULL,
  started_at timestamp NOT NULL,
  expires_at timestamp NOT NULL,
  released_at timestamp
);
CREATE INDEX IF NOT EXISTS slate_usage_leases_user_idx ON slate_usage_leases (user_uid, started_at);

CREATE TABLE IF NOT EXISTS slate_breaker_state (
  provider text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamp,
  open_until timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Rollback: DROP TABLE IF EXISTS slate_usage_leases; DROP TABLE IF EXISTS slate_breaker_state;
