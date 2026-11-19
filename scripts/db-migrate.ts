/**
 * Applies src/db/migrations/*.sql to the configured database (see src/db/migrate.ts).
 *
 *   npm run db:migrate              # dry run: shows applied and pending files, changes nothing
 *   npm run db:migrate -- --apply   # applies pending files, each in its own transaction
 *
 * Connection: DATABASE_MIGRATION_URL (Supabase session pooler, port 5432, or the direct
 * connection), falling back to DATABASE_URL / SQL_* with SQL_ADMIN_USER. TLS settings as in
 * src/db/connection-config.ts (DATABASE_CA_CERT). Loads .env.local / .env when present.
 *
 * Never point this at the old AI Studio Cloud SQL instance.
 */
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { resolveDbConfig } from '../src/db/connection-config.ts';
import { runMigrations } from '../src/db/migrate.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const apply = process.argv.includes('--apply');
const cfg = resolveDbConfig(process.env, 'migration');
if (cfg.source === 'none') {
  console.error('No database configured. Set DATABASE_MIGRATION_URL (or DATABASE_URL / SQL_*).');
  process.exit(2);
}
if (cfg.transactionPooler) {
  console.error('This URL is the Supabase transaction pooler (port 6543). Migrations need a session connection: use the session pooler (5432) or direct URL in DATABASE_MIGRATION_URL.');
  process.exit(2);
}

const client = new Client(cfg.pool);
console.log(`${apply ? 'Applying' : 'Dry run (add --apply to change the database)'} · host ${cfg.host} · via ${cfg.source} · TLS ${cfg.tls}`);
try {
  await client.connect();
  const { applied, plan } = await runMigrations(client, { apply, log: (l) => console.log(l) });
  if (apply) console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Nothing to apply.');
  else console.log(`${plan.pending.length} pending, ${plan.upToDate.length} already applied.`);
  if (apply) {
    const { rows } = await client.query(`select count(*)::int as n from pg_trigger where tgname = 'backlot_account_guard'`);
    console.log(`Account write guard triggers: ${rows[0].n} (expected 13).`);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
