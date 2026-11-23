import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateManualSetup } from './manual-setup.ts';
import { runMigrations, type SqlClient } from './migrate.ts';
import { scramVerifier } from './scram.ts';

/**
 * The SQL Editor scripts in ops/supabase/manual-setup, run in order against a database in the
 * state content-vault / backlot-staging are in (legacy tables moved to legacy_init).
 */

const DIR = new URL('../../ops/supabase/manual-setup/', import.meta.url);
// PGlite's multi-statement SQL runner (an in-process database call, not a shell).
const runSqlScript = (pg: PGlite, text: string) => pg['exec'](text);
const adapter = (pg: PGlite): SqlClient => ({
  async query(text, params) {
    if (params?.length) return (await pg.query(text, params)) as { rows: Record<string, unknown>[] };
    const results = await runSqlScript(pg, text);
    return { rows: (results.at(-1)?.rows ?? []) as Record<string, unknown>[] };
  },
});
const lastRows = async (pg: PGlite, sql: string) => ((await runSqlScript(pg, sql)).at(-1)?.rows ?? []) as Record<string, string>[];

// content-vault's init_content_vault, minus auth.users (PGlite has no auth schema).
const LEGACY = `
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, name));
  CREATE TABLE items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
    channel_id uuid REFERENCES channels(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE files (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE, r2_key text NOT NULL UNIQUE);
  CREATE INDEX channels_user_idx ON channels (user_id);
  CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TRIGGER items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  -- Supabase's default: API roles get access to new public tables.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;`;

const generated = await generateManualSetup();
const file = (prefix: string) => {
  const f = generated.find((g) => g.path.startsWith(prefix));
  assert.ok(f, prefix);
  return f.content;
};
const steps = generated.filter((g) => /^\d\d_migration_/.test(g.path)).map((g) => g.content);

async function transitionedDb() {
  const pg = new PGlite();
  await runSqlScript(pg, LEGACY);
  await runSqlScript(pg, await fsp.readFile(new URL('../../ops/supabase/legacy-init-transition.sql', import.meta.url), 'utf8'));
  return pg;
}

test('the checked-in scripts are exactly what the generator produces', async () => {
  const names = (await fsp.readdir(DIR)).filter((n) => n.endsWith('.sql')).sort();
  assert.deepEqual(names, generated.map((g) => g.path).sort());
  assert.equal(names.length, 14, '00, 01-08, 09, 11, 12, 13, 14');
  for (const g of generated) assert.equal(await fsp.readFile(new URL(g.path, DIR), 'utf8'), g.content, `${g.path} is stale: run node scripts/generate-manual-setup.ts`);
});

test('steps embed each migration verbatim with the sha256 of the file itself', async () => {
  const names = (await fsp.readdir(new URL('migrations/', import.meta.url))).filter((n) => n.endsWith('.sql')).sort();
  assert.equal(steps.length, names.length);
  for (const [i, name] of names.entries()) {
    const sql = await fsp.readFile(new URL(`migrations/${name}`, import.meta.url), 'utf8');
    const sum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
    assert.ok(steps[i].includes(`$backlot_migration$${sql}$backlot_migration$`), `${name} body`);
    assert.ok(steps[i].includes(`VALUES ('${name}', '${sum}')`), `${name} record`);
  }
});

test('preflight, steps 01-09 and verification, in order; then db:migrate sees nothing pending', async () => {
  const pg = await transitionedDb();
  const pre = await lastRows(pg, file('00_'));
  assert.deepEqual(pre.filter((r) => r.result !== 'ok'), [], JSON.stringify(pre));

  for (const s of steps) await runSqlScript(pg, s);
  await runSqlScript(pg, file('09_'));

  const verify = await lastRows(pg, file('11_'));
  assert.deepEqual(verify.filter((r) => r.result !== 'ok'), [], JSON.stringify(verify.filter((r) => r.result !== 'ok')));
  assert.ok(verify.length >= 30);

  // The migration runner agrees: every file applied with the same checksum, nothing pending.
  const plan = await runMigrations(adapter(pg), { apply: false, sessionLock: false });
  assert.equal(plan.plan.pending.length, 0);
  assert.equal(plan.plan.upToDate.length, 11);

  // The preflight now reports the database as no longer fresh.
  const again = await lastRows(pg, file('00_'));
  assert.equal(again.find((r) => r.check.startsWith('fresh'))?.result, 'FAIL');

  // Re-running every step changes nothing and still verifies.
  const before = await pg.query(`select name, checksum, applied_at from backlot_schema_migrations order by name`);
  for (const s of steps) await runSqlScript(pg, s);
  await runSqlScript(pg, file('09_'));
  const after = await pg.query(`select name, checksum, applied_at from backlot_schema_migrations order by name`);
  assert.deepEqual(after.rows, before.rows);
  assert.deepEqual((await lastRows(pg, file('11_'))).filter((r) => r.result !== 'ok'), []);

  // Verification notices drift: RLS switched on, an API role granted access, a dropped trigger.
  await runSqlScript(pg, `ALTER TABLE ideas ENABLE ROW LEVEL SECURITY; GRANT SELECT ON users TO anon; DROP TRIGGER backlot_account_guard ON channels;`);
  const drift = (await lastRows(pg, file('11_'))).filter((r) => r.result !== 'ok');
  assert.ok(drift.some((r) => r.check.startsWith('row-level security') && /ideas/.test(r.detail)));
  assert.ok(drift.some((r) => r.check.startsWith('anon / authenticated have no access') && /users/.test(r.detail)));
  assert.ok(drift.some((r) => r.check.startsWith('account-deletion guard triggers')));
  await pg.close();
});

test('steps refuse to run out of order, and leave nothing behind', async () => {
  const pg = await transitionedDb();
  await assert.rejects(runSqlScript(pg, steps[2]), /Run the earlier steps first/);
  await runSqlScript(pg, 'ROLLBACK').catch(() => undefined);
  assert.equal((await pg.query(`select 1 from pg_tables where tablename = 'slate_actions'`)).rows.length, 0);
  await assert.rejects(runSqlScript(pg, file('09_')), /Run steps 01 to 08 first/);
  await runSqlScript(pg, 'ROLLBACK').catch(() => undefined);
  assert.equal((await pg.query(`select 1 from pg_roles where rolname = 'backlot_app'`)).rows.length, 0);
  await pg.close();
});

test('a record with a different checksum stops the step', async () => {
  const pg = await transitionedDb();
  await runSqlScript(pg, steps[0]);
  await pg.query(`update backlot_schema_migrations set checksum = 'x'`);
  await assert.rejects(runSqlScript(pg, steps[0]), /different checksum/);
  await runSqlScript(pg, 'ROLLBACK').catch(() => undefined);
  await assert.rejects(runSqlScript(pg, steps[1]), /Run the earlier steps first/);
  await pg.close();
});

test('a failure inside a step rolls back the whole step, record included', async () => {
  const pg = await transitionedDb();
  await runSqlScript(pg, steps[0]);
  // Make step 02's CREATE TABLE collide with an incompatible table.
  await pg.query(`create table slate_preferences (id int)`);
  await assert.rejects(runSqlScript(pg, steps[1]), /slate_preferences is missing columns/);
  await runSqlScript(pg, 'ROLLBACK').catch(() => undefined);
  assert.equal((await pg.query(`select 1 from backlot_schema_migrations where name like '2026-11-17%'`)).rows.length, 0);
  await pg.close();
});

test('the preflight fails on an untransitioned content-vault', async () => {
  const pg = new PGlite();
  await runSqlScript(pg, LEGACY);
  const rows = await lastRows(pg, file('00_'));
  const failed = rows.filter((r) => r.result === 'FAIL').map((r) => r.check);
  assert.ok(failed.some((c) => c.startsWith('legacy tables are in legacy_init')));
  assert.ok(failed.some((c) => c.startsWith('no old-design tables')));
  assert.ok(failed.some((c) => c.startsWith('no Backlot index names')));
  await pg.close();
});

test('SCRAM verifier matches what Postgres computes for the same password and salt', async () => {
  const pg = new PGlite();
  await runSqlScript(pg, `SET password_encryption = 'scram-sha-256'; CREATE ROLE r LOGIN PASSWORD 'correct-horse-battery-staple-0123456789';`);
  const { rows } = await pg.query<{ p: string }>(`select rolpassword as p from pg_authid where rolname = 'r'`);
  const m = rows[0].p.match(/^SCRAM-SHA-256\$(\d+):([^$]+)\$/);
  assert.ok(m);
  assert.equal(scramVerifier('correct-horse-battery-staple-0123456789', Buffer.from(m[2], 'base64'), Number(m[1])), rows[0].p);
  // Postgres stores a supplied verifier as is.
  const v = scramVerifier('another-generated-password-0123456789abc');
  await pg.query(`alter role r password '${v}'`);
  assert.equal((await pg.query<{ p: string }>(`select rolpassword as p from pg_authid where rolname = 'r'`)).rows[0].p, v);
  assert.throws(() => scramVerifier('has space'), /printable ASCII/);
  await pg.close();
});
