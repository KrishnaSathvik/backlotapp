-- Backlot: one-time Supabase role setup. Run AFTER `npm run db:migrate -- --apply`, in the
-- Supabase SQL editor (as postgres), once per project (staging and production separately).
-- Not a migration: it uses Supabase-only roles and creates login roles with passwords.
-- For setup entirely in the SQL Editor (no local database password), use
-- ops/supabase/manual-setup/ instead: same grants, idempotent, no password in the script.
-- docs/INFRA_SETUP.md, "Supabase". Nothing here has been run.
--
-- 1. Backlot never uses Supabase's Data API (PostgREST). Supabase grants its API roles
--    (anon, authenticated) access to new tables in `public` by default, and Backlot's tables have
--    no row-level security policies, so close that path at the privilege level too (in addition
--    to turning the Data API off in the dashboard).
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2. Runtime role for the app (DATABASE_URL). Data access only: it owns nothing, so it can't
--    change the schema or disable the account-guard triggers. Migrations keep using postgres
--    through DATABASE_MIGRATION_URL. Replace the password with a generated 32+ character value
--    (for example `openssl rand -base64 32`), and keep it only in Vercel and a password manager.
CREATE ROLE backlot_app LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD' NOINHERIT;
GRANT USAGE ON SCHEMA public TO backlot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO backlot_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO backlot_app;
REVOKE ALL ON public.backlot_schema_migrations FROM backlot_app;
-- Tables and sequences created by future migrations (run as postgres) get the same grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backlot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backlot_app;

-- 3. Read-only role for the nightly backup (docs/BACKUPS.md), public schema only (the backup
--    dumps only public). Explicit grants rather than pg_read_all_data, which would also expose
--    Supabase's auth schema.
CREATE ROLE backlot_backup LOGIN PASSWORD 'REPLACE_WITH_ANOTHER_GENERATED_PASSWORD';
GRANT USAGE ON SCHEMA public TO backlot_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backlot_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backlot_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO backlot_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO backlot_backup;

-- Checks (expected results in docs/RELEASE_CHECKLIST.md, S-DB5):
--   SELECT has_table_privilege('anon', 'public.content_items', 'SELECT');              -- false
--   SELECT has_table_privilege('backlot_app', 'public.content_items', 'DELETE');       -- true
--   SELECT has_table_privilege('backlot_app', 'public.backlot_schema_migrations', 'SELECT'); -- false
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'backlot_account_guard';            -- 13
