-- content-vault legacy-schema transition (owner-approved 2026-11-19).
--
-- The Supabase project `content-vault` (production) was created with an earlier design: one
-- dashboard migration, `init_content_vault`, made public.channels / items / files (uuid keys,
-- auth.users foreign keys, RLS) plus public.set_updated_at(). Backlot's baseline creates its own
-- `channels` and `channels_user_idx`, so those names must be free first (the migration preflight
-- in src/db/migrate.ts refuses to run otherwise).
--
-- This moves the legacy objects, unchanged, into schema `legacy_init`. Nothing is deleted:
-- indexes, constraints, policies and the trigger move with their tables, and
-- supabase_migrations.schema_migrations is not touched. Run it in the SQL editor as postgres,
-- BEFORE `npm run db:migrate -- --apply`. Rehearse on staging first (INFRA_SETUP.md §3.1a).
--
-- It stops (and changes nothing) if any legacy table holds rows, or if anything outside the
-- legacy set depends on these objects.

BEGIN;

LOCK TABLE public.channels, public.items, public.files IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  n bigint;
  outside int;
BEGIN
  SELECT (SELECT count(*) FROM public.channels) + (SELECT count(*) FROM public.items) + (SELECT count(*) FROM public.files) INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION 'Stopping: the legacy tables hold % row(s). Nothing was changed.', n;
  END IF;

  -- Objects (views, other tables' foreign keys, functions) that depend on the legacy set but
  -- aren't part of it. Internal dependencies (indexes, constraints, policies, the trigger,
  -- column defaults) are excluded because they move with their table.
  SELECT count(*) INTO outside
  FROM pg_depend d
  JOIN pg_class c ON c.oid = d.refobjid AND c.relnamespace = 'public'::regnamespace
  WHERE c.relname IN ('channels', 'items', 'files')
    AND d.classid = 'pg_rewrite'::regclass;
  IF outside > 0 THEN
    RAISE EXCEPTION 'Stopping: % view/rule(s) depend on the legacy tables. Nothing was changed.', outside;
  END IF;

  SELECT count(*) INTO outside
  FROM pg_constraint k
  WHERE k.contype = 'f'
    AND k.confrelid IN ('public.channels'::regclass, 'public.items'::regclass, 'public.files'::regclass)
    AND k.conrelid NOT IN ('public.channels'::regclass, 'public.items'::regclass, 'public.files'::regclass);
  IF outside > 0 THEN
    RAISE EXCEPTION 'Stopping: % foreign key(s) from other tables reference the legacy tables. Nothing was changed.', outside;
  END IF;

  SELECT count(*) INTO outside
  FROM pg_trigger t
  WHERE NOT t.tgisinternal
    AND t.tgfoid = 'public.set_updated_at()'::regprocedure
    AND t.tgrelid <> 'public.items'::regclass;
  IF outside > 0 THEN
    RAISE EXCEPTION 'Stopping: set_updated_at() is used by % other trigger(s). Nothing was changed.', outside;
  END IF;
END $$;

CREATE SCHEMA legacy_init;
-- Not exposed: the Data API only serves the schemas listed in its settings (public by default).
REVOKE ALL ON SCHEMA legacy_init FROM PUBLIC;
REVOKE ALL ON SCHEMA legacy_init FROM anon, authenticated;

ALTER TABLE public.files SET SCHEMA legacy_init;
ALTER TABLE public.items SET SCHEMA legacy_init;
ALTER TABLE public.channels SET SCHEMA legacy_init;
ALTER FUNCTION public.set_updated_at() SET SCHEMA legacy_init;

COMMIT;

-- Verify (expect: 3 tables + 1 function in legacy_init; nothing named channels/items/files in public):
--   select table_schema, table_name from information_schema.tables where table_name in ('channels','items','files');
--   select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'set_updated_at';
--   select schemaname, indexname from pg_indexes where schemaname = 'legacy_init' order by 2;
--   select schemaname, tablename, policyname from pg_policies where schemaname = 'legacy_init';
--
-- Rollback, ONLY before Backlot's migrations have been applied (afterwards public.channels is
-- Backlot's; see INFRA_SETUP.md §3.1a):
--   BEGIN;
--   ALTER TABLE legacy_init.channels SET SCHEMA public;
--   ALTER TABLE legacy_init.items SET SCHEMA public;
--   ALTER TABLE legacy_init.files SET SCHEMA public;
--   ALTER FUNCTION legacy_init.set_updated_at() SET SCHEMA public;
--   DROP SCHEMA legacy_init;   -- empty by now; DROP SCHEMA without CASCADE refuses otherwise
--   COMMIT;
