import type { PoolConfig } from 'pg';

/**
 * How the app connects to Postgres.
 *
 * Production (Vercel + Supabase): DATABASE_URL, the Supabase **transaction pooler** (Supavisor,
 * port 6543). Serverless instances come and go, so they must not each hold direct connections.
 * Transaction mode is safe for Backlot because every lock and setting the app uses is
 * transaction-scoped (pg_advisory_xact_lock, SELECT … FOR UPDATE SKIP LOCKED, SET LOCAL), and
 * node-postgres only sends unnamed prepared statements, which the pooler supports.
 *
 * Migrations and operator scripts use DATABASE_MIGRATION_URL instead: the session pooler
 * (port 5432) or the direct connection, because the migration runner holds a session-level
 * advisory lock for the whole run (scripts/db-migrate.ts).
 *
 * Local development: DATABASE_URL, or the older SQL_HOST / SQL_USER / SQL_PASSWORD /
 * SQL_DB_NAME variables, unchanged.
 *
 * TLS: Supabase's server certificate is signed by Supabase's own CA. Put that CA (PEM, from the
 * dashboard's Database → SSL configuration) in DATABASE_CA_CERT to get a verified connection.
 * DATABASE_SSL=no-verify encrypts without verifying (the config check warns about it);
 * DATABASE_SSL=off is for local databases only.
 */

type Env = Record<string, string | undefined>;

export type DbTarget = 'runtime' | 'migration';

export interface ResolvedDbConfig {
  pool: PoolConfig;
  /** Where the settings came from (never the values). */
  source: 'DATABASE_URL' | 'DATABASE_MIGRATION_URL' | 'SQL_*' | 'none';
  tls: 'verified' | 'unverified' | 'off';
  /** Host name only, for messages (no credentials). */
  host: string;
  /** Supabase pooler port 6543 (transaction mode). */
  transactionPooler: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);

function intIn(raw: string | undefined, min: number, max: number, fallback: number) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** The CA certificate, accepting a PEM with literal "\n" sequences (as some env editors store it). */
export function readCaCert(env: Env = process.env): string | undefined {
  const raw = env.DATABASE_CA_CERT?.trim();
  if (!raw) return undefined;
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

/** Removes sslmode/ssl parameters so the explicit `ssl` option below is the only TLS setting. */
function stripSslParams(url: URL) {
  for (const k of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(k);
  return url.toString();
}

export function resolveDbConfig(env: Env = process.env, target: DbTarget = 'runtime'): ResolvedDbConfig {
  const onVercel = !!env.VERCEL;
  const max = intIn(env.DB_POOL_MAX, 1, 50, onVercel ? 5 : 10);
  const base: PoolConfig = {
    max,
    connectionTimeoutMillis: intIn(env.DB_CONNECT_TIMEOUT_MS, 1000, 60_000, 15_000),
    // Short-lived serverless instances: let idle connections go quickly so the pooler can reuse them.
    idleTimeoutMillis: intIn(env.DB_IDLE_TIMEOUT_MS, 1000, 600_000, onVercel ? 10_000 : 30_000),
  };

  const urlRaw = (target === 'migration' ? env.DATABASE_MIGRATION_URL?.trim() : '') || env.DATABASE_URL?.trim() || '';
  if (urlRaw) {
    let url: URL;
    try {
      url = new URL(urlRaw);
    } catch {
      throw new Error('DATABASE_URL is not a valid postgres:// URL.');
    }
    const host = url.hostname;
    const sslSetting = (env.DATABASE_SSL ?? '').trim().toLowerCase();
    const ca = readCaCert(env);
    let tls: ResolvedDbConfig['tls'];
    let ssl: PoolConfig['ssl'];
    if (sslSetting === 'off' || (!sslSetting && !ca && LOCAL_HOSTS.has(host))) {
      tls = 'off';
      ssl = false;
    } else if (ca) {
      tls = 'verified';
      ssl = { ca, rejectUnauthorized: true };
    } else if (sslSetting === 'no-verify') {
      tls = 'unverified';
      ssl = { rejectUnauthorized: false };
    } else {
      // Verify against the system trust store. Supabase needs DATABASE_CA_CERT for this to pass.
      tls = 'verified';
      ssl = { rejectUnauthorized: true };
    }
    return {
      pool: { ...base, connectionString: stripSslParams(url), ssl },
      source: target === 'migration' && env.DATABASE_MIGRATION_URL?.trim() ? 'DATABASE_MIGRATION_URL' : 'DATABASE_URL',
      tls,
      host,
      transactionPooler: url.port === '6543',
    };
  }

  if (env.SQL_HOST?.trim()) {
    const admin = target === 'migration' && env.SQL_ADMIN_USER;
    return {
      pool: {
        ...base,
        host: env.SQL_HOST,
        user: admin ? env.SQL_ADMIN_USER : env.SQL_USER,
        password: admin ? env.SQL_ADMIN_PASSWORD : env.SQL_PASSWORD,
        database: env.SQL_DB_NAME,
      },
      source: 'SQL_*',
      tls: 'off',
      host: env.SQL_HOST,
      transactionPooler: false,
    };
  }

  return { pool: base, source: 'none', tls: 'off', host: '', transactionPooler: false };
}

/** Problems for the production config check (names and kinds only, never values). */
export function checkDbConfig(env: Env = process.env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let cfg: ResolvedDbConfig;
  try {
    cfg = resolveDbConfig(env);
  } catch (e) {
    return { errors: [(e as Error).message], warnings };
  }
  if (cfg.source === 'none') {
    errors.push('No database configured (set DATABASE_URL, or SQL_HOST/SQL_USER/SQL_PASSWORD/SQL_DB_NAME).');
    return { errors, warnings };
  }
  if (cfg.source === 'SQL_*') {
    for (const k of ['SQL_USER', 'SQL_PASSWORD', 'SQL_DB_NAME']) if (!env[k]?.trim()) errors.push(`${k} is not set.`);
  }
  const remote = !LOCAL_HOSTS.has(cfg.host) && !cfg.host.startsWith('/');
  if (remote && cfg.tls === 'off') errors.push('DATABASE_SSL=off for a remote database: connections would be unencrypted.');
  if (remote && cfg.tls === 'unverified') warnings.push('DATABASE_SSL=no-verify: the database certificate is not verified. Set DATABASE_CA_CERT.');
  if (cfg.source === 'DATABASE_URL' && /\.supabase\.(co|com)$/.test(cfg.host) && !readCaCert(env) && cfg.tls === 'verified') {
    errors.push('Supabase needs DATABASE_CA_CERT (its certificate is signed by Supabase\'s own CA), or DATABASE_SSL=no-verify.');
  }
  if (env.VERCEL && remote && /pooler\.supabase\.com$/.test(cfg.host) && !cfg.transactionPooler) {
    warnings.push('DATABASE_URL uses the Supabase session pooler; serverless functions should use the transaction pooler (port 6543).');
  }
  return { errors, warnings };
}
