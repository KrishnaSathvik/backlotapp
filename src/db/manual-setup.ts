import { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_TABLE, expectedObjects, readMigrationFiles, runMigrations, type MigrationFile, type SqlClient } from './migrate.ts';

/**
 * Generates the SQL Editor scripts in ops/supabase/manual-setup (README there).
 *
 * The scripts do by hand exactly what `npm run db:migrate -- --apply` does, so the runner later
 * sees every file as applied:
 * - each migration file's SQL runs verbatim (EXECUTE of the file text) in one transaction,
 *   together with its `backlot_schema_migrations` row: the file name and the sha256 of the
 *   file's exact contents, which is what the runner computes and compares. No record is written
 *   unless that file's SQL ran in the same transaction.
 * - the same session advisory lock key as the runner, so a manual step and a runner can't
 *   interleave;
 * - the same preflight as the runner (existing tables must have the columns; index names must
 *   be free or on the same table);
 * - order: a step refuses to run until every earlier file is recorded with the expected checksum.
 *
 * The verification script compares the result with a reference database built from the same
 * files (PGlite, Postgres 17): per-table fingerprints of columns, indexes and constraints.
 *
 * Generated output is checked in; src/db/manual-setup.test.ts fails if it is stale.
 */

export const LOCK_KEY = 'backlot:schema-migrations';
const MIGRATIONS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
const BODY_TAG = '$backlot_migration$';
const STEP_TAG = '$backlot_step$';

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(lit).join(', ')}]::text[]`;

// Fingerprint expressions. The same text runs against the reference database (to produce the
// expected values) and inside the verification script, so both sides compute them identically.
export const columnsFingerprint = (t: string) =>
  `(SELECT md5(coalesce(string_agg(column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ',' ORDER BY column_name), '')) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${lit(t)})`;
export const indexesFingerprint = (t: string) =>
  `(SELECT md5(coalesce(string_agg(indexdef, ',' ORDER BY indexname), '')) FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${lit(t)})`;
// contype 'n' is excluded: Postgres 18 (PGlite, which computes the expected values) records each
// NOT NULL as a pg_constraint row, Postgres 17 (Supabase) does not. Nullability is already part of
// the columns fingerprint (is_nullable), so nothing is lost.
export const constraintsFingerprint = (t: string) =>
  `(SELECT md5(coalesce(string_agg(k.conname || ' ' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname), '')) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ${lit(t)} AND k.contype <> 'n')`;

export interface TableFingerprint {
  table: string;
  columns: string;
  indexes: string;
  constraints: string;
}

export interface Reference {
  files: MigrationFile[];
  tables: TableFingerprint[];
  indexNames: string[];
  guardTriggers: number;
}

const adapter = (pg: PGlite): SqlClient => ({
  async query(text, params) {
    if (params?.length) return (await pg.query(text, params)) as { rows: Record<string, unknown>[] };
    const results = await pg['exec'](text);
    return { rows: (results.at(-1)?.rows ?? []) as Record<string, unknown>[] };
  },
});

/** Builds the schema from the migration files in a throwaway in-process database. */
export async function buildReference(files?: MigrationFile[]): Promise<Reference> {
  const migrationFiles = files ?? (await readMigrationFiles());
  const pg = new PGlite();
  try {
    await runMigrations(adapter(pg), { apply: true, files: migrationFiles, sessionLock: false });
    const { rows: tableRows } = await pg.query<{ t: string }>(
      `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '${MIGRATIONS_TABLE}' ORDER BY tablename`
    );
    const tables: TableFingerprint[] = [];
    for (const { t } of tableRows) {
      const { rows } = await pg.query<{ c: string; i: string; k: string }>(
        `SELECT ${columnsFingerprint(t)} AS c, ${indexesFingerprint(t)} AS i, ${constraintsFingerprint(t)} AS k`
      );
      tables.push({ table: t, columns: rows[0].c, indexes: rows[0].i, constraints: rows[0].k });
    }
    const { rows: g } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'backlot_account_guard'`);
    const indexNames = [...new Set(migrationFiles.flatMap((f) => expectedObjects(f.sql).indexes.map((i) => i.index)))].sort();
    return { files: migrationFiles, tables, indexNames, guardTriggers: g[0].n };
  } finally {
    await pg.close();
  }
}

const header = (title: string, lines: string[]) =>
  [`-- ${title}`, '--', ...lines.map((l) => (l ? `-- ${l}` : '--')), '--', '-- GENERATED by `node scripts/generate-manual-setup.ts`. Do not edit by hand.', ''].join('\n');

/** One migration file as an SQL Editor step. */
export function stepSql(files: MigrationFile[], index: number, stepNumber: number): string {
  const f = files[index];
  if (f.sql.includes(BODY_TAG) || f.sql.includes(STEP_TAG)) throw new Error(`${f.name} contains a reserved quote tag`);
  const earlier = files.slice(0, index);
  const { tables, indexes } = expectedObjects(f.sql);
  const compat = [
    ...tables.map(
      (t) => `  SELECT array_agg(c ORDER BY c) INTO missing_columns
    FROM unnest(${arr(t.columns)}) AS c
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${lit(t.table)} AND column_name = c);
  IF to_regclass(${lit('public.' + t.table)}) IS NOT NULL AND missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing: existing table ${t.table} is missing columns %. Nothing was changed.', missing_columns;
  END IF;`
    ),
    ...indexes.map(
      (i) => `  SELECT tablename INTO other_table FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${lit(i.index)};
  IF other_table IS NOT NULL AND other_table <> ${lit(i.table)} THEN
    RAISE EXCEPTION 'Refusing: index ${i.index} already exists on %, not ${i.table}. Nothing was changed.', other_table;
  END IF;
  other_table := NULL;`
    ),
  ].join('\n');
  const earlierValues = earlier.length
    ? `(VALUES ${earlier.map((e) => `(${lit(e.name)}, ${lit(e.checksum)})`).join(',\n               ')}) AS e(name, checksum)`
    : '';
  const orderCheck = earlier.length
    ? `  SELECT array_agg(e.name ORDER BY e.name) INTO not_recorded
    FROM ${earlierValues}
    LEFT JOIN ${MIGRATIONS_TABLE} m ON m.name = e.name AND m.checksum = e.checksum
    WHERE m.name IS NULL;
  IF not_recorded IS NOT NULL THEN
    RAISE EXCEPTION 'Run the earlier steps first. Not recorded (or recorded with a different checksum): %. Nothing was changed.', not_recorded;
  END IF;
`
    : '';
  return `${header(`Backlot manual setup, step ${String(stepNumber).padStart(2, '0')}: migration ${f.name}`, [
    `Source: src/db/migrations/${f.name}`,
    `sha256 of that file: ${f.checksum}`,
    '',
    'Run in the Supabase SQL Editor (role postgres), after the previous step. One transaction:',
    'either the whole migration and its record are committed, or nothing is. Re-running after',
    'success changes nothing; a record with a different checksum stops it.',
  ])}
BEGIN;
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(hashtextextended(${lit(LOCK_KEY)}, 0));
${MIGRATIONS_TABLE_DDL};

DO ${STEP_TAG}
DECLARE
  recorded text;
  not_recorded text[];
  missing_columns text[];
  other_table text;
BEGIN
  SELECT checksum INTO recorded FROM ${MIGRATIONS_TABLE} WHERE name = ${lit(f.name)};
  IF recorded = ${lit(f.checksum)} THEN
    RAISE NOTICE '${f.name} is already applied. Nothing to do.';
    RETURN;
  END IF;
  IF recorded IS NOT NULL THEN
    RAISE EXCEPTION '${f.name} is recorded with a different checksum (%). Nothing was changed.', recorded;
  END IF;
${orderCheck}  IF EXISTS (SELECT 1 FROM ${MIGRATIONS_TABLE} WHERE name > ${lit(f.name)}) THEN
    RAISE EXCEPTION 'A later migration is already recorded, but ${f.name} is not. Stop and report this. Nothing was changed.';
  END IF;

  -- Preflight (same rules as db:migrate): no silent skip of an existing, different object.
${compat}

  EXECUTE ${BODY_TAG}${f.sql}${BODY_TAG};

  INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES (${lit(f.name)}, ${lit(f.checksum)});
  RAISE NOTICE 'Applied ${f.name}.';
END ${STEP_TAG};

COMMIT;

-- Result: the migration history so far.
SELECT name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name;
`;
}

const row = (ord: number, check: string, ok: string, detail = `''`) => `  SELECT ${ord} AS ord, ${lit(check)} AS "check", (${ok}) AS ok, (${detail})::text AS detail`;
const resultQuery = (rows: string[]) => `SELECT "check", CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS result, detail FROM (\n${rows.join('\nUNION ALL\n')}\n) AS checks ORDER BY ord;\n`;

/** Read-only state check before step 01. */
export function preflightSql(ref: Reference): string {
  const appTables = ref.tables.map((t) => t.table);
  const legacyCount = `(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'legacy_init' AND table_name IN ('channels', 'items', 'files'))`;
  const legacyRows = `CASE WHEN ${legacyCount} = 3 THEN (xpath('/row/n/text()', query_to_xml('SELECT (SELECT count(*) FROM legacy_init.channels) + (SELECT count(*) FROM legacy_init.items) + (SELECT count(*) FROM legacy_init.files) AS n', false, true, '')))[1]::text::bigint END`;
  const present = `(SELECT string_agg(t, ', ' ORDER BY t) FROM unnest(${arr([...appTables, MIGRATIONS_TABLE])}) AS t WHERE to_regclass('public.' || t) IS NOT NULL)`;
  const idx = `(SELECT string_agg(indexname || ' on ' || tablename, ', ' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY (${arr(ref.indexNames)}))`;
  const roles = `(SELECT string_agg(rolname, ', ' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('backlot_app', 'backlot_backup'))`;
  const rows = [
    row(1, 'running as postgres', `current_user = 'postgres'`, `current_user`),
    row(2, 'Postgres 15 or newer', `current_setting('server_version_num')::int >= 150000`, `current_setting('server_version')`),
    row(3, 'default schema is public', `current_schema() = 'public'`, `current_schema()`),
    row(4, 'legacy tables are in legacy_init (transition done)', `${legacyCount} = 3`, `${legacyCount} || ' of 3'`),
    row(5, 'legacy tables are empty', `coalesce(${legacyRows}, -1) = 0`, `coalesce((${legacyRows})::text, 'not checked')`),
    row(6, 'no old-design tables left in public', `to_regclass('public.items') IS NULL AND to_regclass('public.files') IS NULL AND to_regclass('public.channels') IS NULL`, `concat_ws(', ', CASE WHEN to_regclass('public.items') IS NOT NULL THEN 'items' END, CASE WHEN to_regclass('public.files') IS NOT NULL THEN 'files' END, CASE WHEN to_regclass('public.channels') IS NOT NULL THEN 'channels' END)`),
    row(7, `fresh: none of the ${appTables.length} Backlot tables or ${MIGRATIONS_TABLE} exist yet`, `${present} IS NULL`, `coalesce(${present}, 'none')`),
    row(8, 'no Backlot index names in use', `${idx} IS NULL`, `coalesce(${idx}, 'none')`),
    row(9, 'roles backlot_app / backlot_backup not created yet', `${roles} IS NULL`, `coalesce(${roles}, 'none')`),
    row(10, 'event triggers (information; none expected besides Supabase\'s own)', `true`, `coalesce((SELECT string_agg(evtname || ' on ' || evtevent, ', ' ORDER BY evtname) FROM pg_event_trigger), 'none')`),
    row(11, 'other schemas (information)', `true`, `(SELECT string_agg(nspname, ', ' ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema')`),
  ];
  return `${header('Backlot manual setup, step 00: read-only preflight', [
    'Run in the Supabase SQL Editor before step 01. It only reads; it changes nothing.',
    'Every row should say ok (rows marked information always do). If any says FAIL, stop and share the output.',
  ])}${resultQuery(rows)}`;
}

/** Read-only verification after steps 01 to 10. */
export function verifySql(ref: Reference): string {
  const appTables = ref.tables.map((t) => t.table);
  const expectedRecords = `(VALUES ${ref.files.map((f) => `(${lit(f.name)}, ${lit(f.checksum)})`).join(', ')}) AS e(name, checksum)`;
  const failing = (predicate: string) => `(SELECT count(*) FROM unnest(${arr(appTables)}) AS t WHERE NOT (${predicate}))`;
  const failingList = (predicate: string) => `coalesce((SELECT string_agg(t, ', ' ORDER BY t) FROM unnest(${arr(appTables)}) AS t WHERE NOT (${predicate})), '')`;
  // OIDs, not names: a name is resolved (and can error) before other filters apply, and a
  // missing table must show as FAIL rather than stop the whole script.
  const tbl = `to_regclass('public.' || t)`;
  const priv = (r: string, p: string) => `coalesce(has_table_privilege('${r}', ${tbl}, '${p}'), false)`;
  const noPriv = (r: string, p: string) => `coalesce(NOT has_table_privilege('${r}', ${tbl}, '${p}'), false)`;
  const dml = (r: string) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((p) => priv(r, p)).join(' AND ');
  const publicTables = `pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;
  const anyPriv = (r: string) => `has_table_privilege('${r}', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`;
  let ord = 0;
  const rows = [
    row(++ord, 'running as postgres', `current_user = 'postgres'`, `current_user`),
    row(
      ++ord,
      `migration history: ${ref.files.length} records, exact checksums`,
      `(SELECT count(*) FROM ${MIGRATIONS_TABLE} m JOIN ${expectedRecords} USING (name, checksum)) = ${ref.files.length} AND (SELECT count(*) FROM ${MIGRATIONS_TABLE}) = ${ref.files.length}`,
      `(SELECT string_agg(m.name || CASE WHEN e.checksum IS NULL THEN ' (unexpected)' WHEN e.checksum <> m.checksum THEN ' (checksum differs)' ELSE '' END, ', ' ORDER BY m.name) FROM ${MIGRATIONS_TABLE} m LEFT JOIN ${expectedRecords} ON e.name = m.name)`
    ),
    row(
      ++ord,
      `all ${appTables.length} Backlot tables exist`,
      `${failing(`to_regclass('public.' || t) IS NOT NULL`)} = 0`,
      `'missing: ' || ${failingList(`to_regclass('public.' || t) IS NOT NULL`)}`
    ),
    ...ref.tables.map((t) =>
      row(
        ++ord,
        `schema of ${t.table} matches the migration files`,
        `${columnsFingerprint(t.table)} = ${lit(t.columns)} AND ${indexesFingerprint(t.table)} = ${lit(t.indexes)} AND ${constraintsFingerprint(t.table)} = ${lit(t.constraints)}`,
        `concat_ws(', ', CASE WHEN ${columnsFingerprint(t.table)} <> ${lit(t.columns)} THEN 'columns differ' END, CASE WHEN ${indexesFingerprint(t.table)} <> ${lit(t.indexes)} THEN 'indexes differ' END, CASE WHEN ${constraintsFingerprint(t.table)} <> ${lit(t.constraints)} THEN 'constraints differ' END)`
      )
    ),
    row(
      ++ord,
      `account-deletion guard triggers: ${ref.guardTriggers}`,
      `(SELECT count(DISTINCT c.relname) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE g.tgname = 'backlot_account_guard' AND n.nspname = 'public' AND g.tgenabled = 'O') = ${ref.guardTriggers}`,
      `(SELECT count(*) FROM pg_trigger WHERE tgname = 'backlot_account_guard')::text || ' found'`
    ),
    row(
      ++ord,
      'row-level security off on Backlot tables (backlot_app has no policies and no bypass)',
      `${failing(`NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = ${tbl}), true)`)} = 0`,
      `'RLS on: ' || ${failingList(`NOT coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = ${tbl}), true)`)}`
    ),
    row(++ord, 'legacy objects kept in legacy_init', `(SELECT count(*) FROM information_schema.tables WHERE table_schema = 'legacy_init') = 3 AND to_regprocedure('legacy_init.set_updated_at()') IS NOT NULL`, `(SELECT string_agg(table_name, ', ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema = 'legacy_init')`),
    row(++ord, 'legacy_init not usable by anon / authenticated', `NOT has_schema_privilege('anon', 'legacy_init', 'USAGE') AND NOT has_schema_privilege('authenticated', 'legacy_init', 'USAGE')`),
    row(
      ++ord,
      'anon / authenticated have no access to any public table',
      `(SELECT count(*) FROM ${publicTables} AND (${anyPriv('anon')} OR ${anyPriv('authenticated')})) = 0`,
      `(SELECT string_agg(c.relname, ', ' ORDER BY c.relname) FROM ${publicTables} AND (${anyPriv('anon')} OR ${anyPriv('authenticated')}))`
    ),
    row(
      ++ord,
      'backlot_app: login, no superuser / createrole / createdb / replication / bypassrls, noinherit',
      `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backlot_app' AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)`
    ),
    row(
      ++ord,
      'backlot_app owns nothing and is a member of no role',
      `NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'backlot_app') AND NOT EXISTS (SELECT 1 FROM pg_namespace s JOIN pg_roles r ON r.oid = s.nspowner WHERE r.rolname = 'backlot_app') AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE r.rolname = 'backlot_app') AND NOT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'backlot_app')`
    ),
    row(++ord, 'backlot_app: SELECT/INSERT/UPDATE/DELETE on every Backlot table', `${failing(dml('backlot_app'))} = 0`, `'missing on: ' || ${failingList(dml('backlot_app'))}`),
    row(++ord, 'backlot_app: no TRUNCATE / REFERENCES / TRIGGER', `${failing(noPriv('backlot_app', 'TRUNCATE,REFERENCES,TRIGGER'))} = 0`),
    row(++ord, `backlot_app: no access to ${MIGRATIONS_TABLE}`, `coalesce(NOT has_table_privilege('backlot_app', to_regclass('public.${MIGRATIONS_TABLE}'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'), false)`),
    row(
      ++ord,
      'backlot_app: USAGE and UPDATE on every public sequence',
      `(SELECT count(*) FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = 'public' AND NOT (has_sequence_privilege('backlot_app', s.oid, 'USAGE') AND has_sequence_privilege('backlot_app', s.oid, 'UPDATE'))) = 0`
    ),
    row(++ord, 'backlot_backup: login, no write roles', `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backlot_backup' AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls)`),
    row(++ord, 'backlot_backup: SELECT on every Backlot table', `${failing(priv('backlot_backup', 'SELECT'))} = 0`, `'missing on: ' || ${failingList(priv('backlot_backup', 'SELECT'))}`),
    row(++ord, 'backlot_backup: cannot write', `${failing(noPriv('backlot_backup', 'INSERT,UPDATE,DELETE,TRUNCATE'))} = 0`),
    row(
      ++ord,
      'backlot_backup read access path (information)',
      `true`,
      `CASE WHEN pg_has_role('backlot_backup', 'pg_read_all_data', 'MEMBER') THEN 'pg_read_all_data' ELSE 'per-table SELECT grants' END`
    ),
  ];
  return `${header('Backlot manual setup, step 11: read-only verification', [
    'Run in the Supabase SQL Editor after steps 01 to 10. It only reads; it changes nothing.',
    'Every row should say ok. Share the whole result. Expected values come from a database built',
    'from the same migration files (src/db/migrations), so a FAIL means this database differs.',
  ])}${resultQuery(rows)}`;
}

/** Restricted roles and Data API lockdown (same grants as ops/supabase/roles.sql), no passwords. */
export function rolesSql(ref: Reference): string {
  // Roles need the original setup's 8 migrations; later ones (steps 12+) run after this step.
  const setupFiles = ref.files.slice(0, 8);
  const expectedRecords = `(VALUES ${setupFiles.map((f) => `(${lit(f.name)}, ${lit(f.checksum)})`).join(', ')}) AS e(name, checksum)`;
  const n = setupFiles.length;
  return `${header('Backlot manual setup, step 09: restricted roles and Data API access', [
    'Run in the Supabase SQL Editor after step 08. One transaction; safe to re-run (it only',
    'creates what is missing and re-applies the same grants).',
    '',
    'Roles are created WITHOUT passwords, so they cannot sign in until step 10 sets them.',
    'No secret appears in this file.',
    '',
    '- anon / authenticated (Supabase Data API) lose all access to Backlot tables, now and for',
    '  tables created later by postgres. Also turn the Data API off in the dashboard.',
    '- backlot_app: the runtime role (DATABASE_URL). Data access only, owns nothing, so it',
    '  cannot change the schema or disable the account-deletion guard triggers.',
    `- backlot_backup: read-only, public schema only (the backup dumps only public). Explicit`,
    '  grants instead of pg_read_all_data, which would also expose Supabase\'s auth schema.',
  ])}
BEGIN;
SET LOCAL search_path = public;

DO ${STEP_TAG}
DECLARE
  n int;
BEGIN
  IF to_regclass('public.${MIGRATIONS_TABLE}') IS NULL THEN
    RAISE EXCEPTION 'Run steps 01 to ${String(n).padStart(2, '0')} first (no migration history). Nothing was changed.';
  END IF;
  SELECT count(*) INTO n FROM ${MIGRATIONS_TABLE} m JOIN ${expectedRecords} USING (name, checksum);
  IF n <> ${n} THEN
    RAISE EXCEPTION 'Run steps 01 to ${String(n).padStart(2, '0')} first (% of ${n} recorded with the expected checksum). Nothing was changed.', n;
  END IF;
END ${STEP_TAG};

-- 1. Supabase Data API roles: no access to Backlot's tables.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 2. Create the two login roles if missing (no password yet).
DO ${STEP_TAG}
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backlot_app') THEN
    CREATE ROLE backlot_app LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backlot_backup') THEN
    CREATE ROLE backlot_backup LOGIN;
  END IF;
END ${STEP_TAG};

-- 3. Runtime role: data access only; never the migration history.
GRANT USAGE ON SCHEMA public TO backlot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO backlot_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO backlot_app;
REVOKE ALL ON public.${MIGRATIONS_TABLE} FROM backlot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO backlot_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO backlot_app;

-- 4. Backup role: read-only on public (including the migration history, so a restore knows
--    which migrations it has).
GRANT USAGE ON SCHEMA public TO backlot_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backlot_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backlot_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO backlot_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO backlot_backup;

COMMIT;

-- Result: the two roles.
SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname IN ('backlot_app', 'backlot_backup') ORDER BY rolname;
`;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Every generated file, keyed by its path under ops/supabase/manual-setup. */
export async function generateManualSetup(): Promise<GeneratedFile[]> {
  const ref = await buildReference();
  const out: GeneratedFile[] = [{ path: '00_preflight_readonly.sql', content: preflightSql(ref) }];
  // The first 8 migrations are steps 01-08 (the original setup). Later migrations come after
  // roles (09) and verification (11), as steps 12, 13, ...; each still checks the earlier ones ran.
  if (ref.files.length < 8) throw new Error(`Step numbers assume at least 8 migrations; found ${ref.files.length}.`);
  ref.files.forEach((f, i) => {
    const step = i < 8 ? i + 1 : i + 4;
    out.push({ path: `${String(step).padStart(2, '0')}_migration_${f.name}`, content: stepSql(ref.files, i, step) });
  });
  out.push({ path: '09_roles.sql', content: rolesSql(ref) });
  out.push({ path: '11_verify_readonly.sql', content: verifySql(ref) });
  return out;
}
