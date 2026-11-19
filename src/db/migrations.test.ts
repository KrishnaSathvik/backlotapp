import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.ts';
import { planMigrations, readMigrationFiles, runMigrations, sha256, type SqlClient } from './migrate.ts';
import { resolveDbConfig, checkDbConfig } from './connection-config.ts';

/** Supabase migration I2: the SQL files alone build the schema the app expects. */

// PGlite's multi-statement SQL runner (an in-process database call, not a shell).
const runSqlScript = (pg: PGlite, text: string) => pg['exec'](text);

const adapter = (pg: PGlite): SqlClient => ({
  async query(text, params) {
    if (params?.length) return (await pg.query(text, params)) as { rows: Record<string, unknown>[] };
    const results = await runSqlScript(pg, text);
    return { rows: (results.at(-1)?.rows ?? []) as Record<string, unknown>[] };
  },
});

test('a fresh database built from the migration files matches src/db/schema.ts', async () => {
  const pg = new PGlite();
  const client = adapter(pg);
  const first = await runMigrations(client, { apply: true, sessionLock: false });
  assert.ok(first.applied.length >= 8, 'baseline + seven feature migrations');
  assert.equal(first.applied[0], '2026-11-16_baseline.sql');

  // Nothing left for drizzle to change: the files and the TypeScript schema agree.
  const { pushSchema } = await import('drizzle-kit/api');
  const db = drizzle(pg, { schema });
  const silence = console.log;
  console.log = () => undefined;
  let diff: string[];
  try {
    diff = (await pushSchema(schema, db as never)).statementsToExecute;
  } finally {
    console.log = silence;
  }
  // Not drift: the migrations bookkeeping table (not part of the app schema), and the one
  // expression index, which drizzle-kit can't compare and always proposes to recreate. That
  // index is checked directly below.
  const drift = diff.filter((s) => !/backlot_schema_migrations/.test(s) && !/"slate_preferences_scope_key_uq"/.test(s));
  assert.deepEqual(drift, []);
  const idx = await pg.query<{ def: string }>(`select indexdef as def from pg_indexes where indexname = 'slate_preferences_scope_key_uq'`);
  assert.match(idx.rows[0].def, /UNIQUE INDEX .*\(user_uid, COALESCE\(channel_id, 0\), key\)/);

  // The write guard is installed on all 13 account tables.
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'backlot_account_guard'`);
  assert.equal(rows[0].n, 13);

  // Re-running is a no-op.
  const second = await runMigrations(client, { apply: true, sessionLock: false });
  assert.deepEqual(second.applied, []);
  await pg.close();
});

test('an edited migration is refused, never silently re-applied', async () => {
  const pg = new PGlite();
  const client = adapter(pg);
  const files = await readMigrationFiles();
  await runMigrations(client, { apply: true, files, sessionLock: false });
  const edited = files.map((f, i) => (i === 1 ? { ...f, sql: f.sql + '\n-- edit', checksum: sha256(f.sql + '\n-- edit') } : f));
  await assert.rejects(runMigrations(client, { apply: true, files: edited, sessionLock: false }), /Refusing to migrate/);
  await assert.rejects(runMigrations(client, { apply: true, files: files.slice(2), sessionLock: false }), /missing/);
  await pg.close();
});

// The shape found in the Supabase `content-vault` project on 2026-11-19 (an earlier design,
// minus its auth.users foreign keys and RLS policies, which PGlite doesn't have).
const LEGACY_INIT_SQL = `
  CREATE TABLE channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, name));
  CREATE TABLE items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
    channel_id uuid REFERENCES channels(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE, r2_key text NOT NULL UNIQUE);
  CREATE INDEX items_user_idx ON items (user_id);
  CREATE INDEX channels_user_idx ON channels (user_id);
  CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TRIGGER items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;

test('preflight: an existing table with a different shape stops the run before anything changes', async () => {
  const pg = new PGlite();
  const client = adapter(pg);
  await runSqlScript(pg, LEGACY_INIT_SQL);
  for (const apply of [false, true]) {
    await assert.rejects(
      runMigrations(client, { apply, sessionLock: false }),
      (err: Error) => /Refusing to migrate: existing objects don't match/.test(err.message) &&
        /channels is missing columns: user_uid, handle/.test(err.message) &&
        /index channels_user_idx/.test(err.message) === false // same table: covered by the column check
    );
  }
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from ${'backlot_schema_migrations'}`);
  assert.equal(rows[0].n, 0, 'nothing recorded');
  const users = await pg.query(`select 1 from information_schema.tables where table_name = 'users'`);
  assert.equal(users.rows.length, 0, 'nothing created');
  await pg.close();
});

test('preflight: an index name used by another table stops the run', async () => {
  const pg = new PGlite();
  const client = adapter(pg);
  await runSqlScript(pg, `CREATE TABLE other (user_uid text); CREATE INDEX ideas_user_idx ON other (user_uid);`);
  await assert.rejects(runMigrations(client, { apply: true, sessionLock: false }), /index ideas_user_idx already exists on other, not ideas/);
  await pg.close();
});

const TRANSITION_SQL = await fsp.readFile(new URL('../../ops/supabase/legacy-init-transition.sql', import.meta.url), 'utf8');
const ROLLBACK_SQL = TRANSITION_SQL.split('-- Rollback')[1].split('\n').filter((l) => /^--   [A-Z]/.test(l)).map((l) => l.slice(5)).join('\n');
const legacyDb = async () => {
  const pg = new PGlite();
  await runSqlScript(pg, `CREATE ROLE anon; CREATE ROLE authenticated;` + LEGACY_INIT_SQL);
  return pg;
};

test('content-vault transition file: refuses when a legacy table has rows, and changes nothing', async () => {
  const pg = await legacyDb();
  await pg.query(`insert into channels (user_id, name) values (gen_random_uuid(), 'x')`);
  await assert.rejects(runSqlScript(pg, TRANSITION_SQL), /legacy tables hold 1 row/);
  await runSqlScript(pg, 'ROLLBACK').catch(() => undefined);
  const s = await pg.query(`select 1 from pg_namespace where nspname = 'legacy_init'`);
  assert.equal(s.rows.length, 0);
  await pg.close();
});

test('content-vault transition file: rollback restores the legacy objects to public', async () => {
  const pg = await legacyDb();
  await runSqlScript(pg, TRANSITION_SQL);
  await runSqlScript(pg, ROLLBACK_SQL);
  const t = await pg.query<{ s: string }>(`select table_schema as s from information_schema.tables where table_name in ('channels','items','files')`);
  assert.deepEqual(t.rows.map((r) => r.s), ['public', 'public', 'public']);
  assert.equal((await pg.query(`select 1 from pg_namespace where nspname = 'legacy_init'`)).rows.length, 0);
  await pg.close();
});

test('content-vault transition: legacy tables moved to legacy_init, then the migrations apply cleanly', async () => {
  const pg = await legacyDb();
  const client = adapter(pg);
  await runSqlScript(pg, TRANSITION_SQL);
  const run = await runMigrations(client, { apply: true, sessionLock: false });
  assert.ok(run.applied.length >= 8);
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'backlot_account_guard'`);
  assert.equal(rows[0].n, 13);
  // The legacy objects moved together and still work where they are.
  const legacy = await pg.query<{ schemaname: string; indexname: string }>(
    `select schemaname, indexname from pg_indexes where indexname in ('channels_user_idx', 'items_user_idx') order by 1, 2`);
  assert.deepEqual(legacy.rows.map((r) => `${r.schemaname}.${r.indexname}`), ['legacy_init.channels_user_idx', 'legacy_init.items_user_idx', 'public.channels_user_idx']);
  await pg.query(`insert into legacy_init.items (user_id, title) values (gen_random_uuid(), 't')`);
  await pg.query(`update legacy_init.items set title = 'u'`);
  await pg.close();
});

test('planMigrations sorts files into pending, up to date, changed and missing', () => {
  const f = (name: string, sql = name) => ({ name, sql, checksum: sha256(sql) });
  const plan = planMigrations([f('a'), f('b'), f('c')], [{ name: 'a', checksum: sha256('a') }, { name: 'b', checksum: 'x' }, { name: 'z', checksum: 'y' }]);
  assert.deepEqual(plan.pending.map((p) => p.name), ['c']);
  assert.deepEqual(plan.upToDate, ['a']);
  assert.deepEqual(plan.changed, ['b']);
  assert.deepEqual(plan.missing, ['z']);
});

test('connection config: Supabase pooler URL, TLS and local fallback', () => {
  const supa = 'postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require';
  const verified = resolveDbConfig({ DATABASE_URL: supa, DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----' });
  assert.equal(verified.tls, 'verified');
  assert.equal(verified.transactionPooler, true);
  assert.ok(!String(verified.pool.connectionString).includes('sslmode'));
  assert.ok((verified.pool.ssl as { ca: string }).ca.includes('\nX\n'));

  assert.match(checkDbConfig({ DATABASE_URL: supa }).errors.join(), /DATABASE_CA_CERT/);
  assert.deepEqual(checkDbConfig({ DATABASE_URL: supa, DATABASE_SSL: 'no-verify' }).errors, []);
  assert.match(checkDbConfig({ DATABASE_URL: supa, DATABASE_SSL: 'off' }).errors.join(), /unencrypted/);

  const migration = resolveDbConfig({ DATABASE_URL: supa, DATABASE_MIGRATION_URL: supa.replace(':6543', ':5432'), DATABASE_SSL: 'no-verify' }, 'migration');
  assert.equal(migration.source, 'DATABASE_MIGRATION_URL');
  assert.equal(migration.transactionPooler, false);

  const local = resolveDbConfig({ SQL_HOST: '127.0.0.1', SQL_USER: 'u', SQL_PASSWORD: 'p', SQL_DB_NAME: 'd' });
  assert.equal(local.source, 'SQL_*');
  assert.equal(local.pool.host, '127.0.0.1');
  assert.match(checkDbConfig({}).errors.join(), /No database configured/);
});
