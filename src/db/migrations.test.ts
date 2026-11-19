import test from 'node:test';
import assert from 'node:assert/strict';
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
