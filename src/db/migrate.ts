import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Explicit, checksummed migrations (Supabase migration plan, Phase 2.5).
 *
 * - The SQL files in src/db/migrations are applied in file-name order, each in its own
 *   transaction together with its row in `backlot_schema_migrations` (name, sha256, time).
 * - A file already recorded with the same checksum is skipped.
 * - A file already recorded with a DIFFERENT checksum stops the run: migrations are never
 *   silently re-applied after being edited. Write a new file instead.
 * - A recorded migration whose file is missing also stops the run (the checkout is wrong).
 * - The run holds a session-level advisory lock, so two runs can't interleave. That needs a
 *   session connection: DATABASE_MIGRATION_URL (Supabase session pooler or direct), not the
 *   transaction pooler.
 *
 * Every existing file is idempotent, so recording a database that was set up by hand earlier
 * (or by `db:push` in development) is safe: applying a file it already has changes nothing.
 */

export const MIGRATIONS_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'migrations');
export const MIGRATIONS_TABLE = 'backlot_schema_migrations';
const LOCK_KEY = 'backlot:schema-migrations';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  upToDate: string[];
  /** Recorded with a different checksum than the file now has. */
  changed: string[];
  /** Recorded, but the file no longer exists. */
  missing: string[];
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export async function readMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await fsp.readFile(path.join(dir, name), 'utf8');
      return { name, sql, checksum: sha256(sql) };
    })
  );
}

export function planMigrations(files: MigrationFile[], applied: AppliedMigration[]): MigrationPlan {
  const byName = new Map(applied.map((a) => [a.name, a.checksum]));
  const fileNames = new Set(files.map((f) => f.name));
  const plan: MigrationPlan = { pending: [], upToDate: [], changed: [], missing: [] };
  for (const f of files) {
    const recorded = byName.get(f.name);
    if (recorded === undefined) plan.pending.push(f);
    else if (recorded === f.checksum) plan.upToDate.push(f.name);
    else plan.changed.push(f.name);
  }
  for (const a of applied) if (!fileNames.has(a.name)) plan.missing.push(a.name);
  return plan;
}

/** Minimal client surface (node-postgres PoolClient / Client, or PGlite via an adapter). */
export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function ensureMigrationsTable(client: SqlClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
}

export async function appliedMigrations(client: SqlClient): Promise<AppliedMigration[]> {
  const { rows } = await client.query(`SELECT name, checksum FROM ${MIGRATIONS_TABLE} ORDER BY name`);
  return rows.map((r) => ({ name: String(r.name), checksum: String(r.checksum) }));
}

export interface RunResult {
  applied: string[];
  plan: MigrationPlan;
}

/**
 * Applies pending migrations. Refuses to do anything if any recorded file changed or is
 * missing. `apply: false` only reports the plan.
 */
export async function runMigrations(
  client: SqlClient,
  opts: { apply: boolean; files?: MigrationFile[]; log?: (line: string) => void; sessionLock?: boolean }
): Promise<RunResult> {
  const log = opts.log ?? (() => undefined);
  const files = opts.files ?? (await readMigrationFiles());
  const lock = opts.sessionLock !== false;
  if (lock) await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [LOCK_KEY]);
  try {
    await ensureMigrationsTable(client);
    const plan = planMigrations(files, await appliedMigrations(client));
    if (plan.changed.length || plan.missing.length) {
      throw new Error(
        `Refusing to migrate. Changed since applied: [${plan.changed.join(', ')}]. Recorded but missing: [${plan.missing.join(', ')}]. ` +
          'Never edit an applied migration; add a new file.'
      );
    }
    for (const n of plan.upToDate) log(`  ok       ${n}`);
    if (!opts.apply) {
      for (const f of plan.pending) log(`  pending  ${f.name}`);
      return { applied: [], plan };
    }
    const applied: string[] = [];
    for (const f of plan.pending) {
      log(`  applying ${f.name}`);
      await client.query('BEGIN');
      try {
        await client.query(f.sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`, [f.name, f.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${f.name} failed and was rolled back: ${(err as Error).message}`);
      }
      applied.push(f.name);
    }
    return { applied, plan };
  } finally {
    if (lock) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_KEY]).catch(() => undefined);
  }
}
