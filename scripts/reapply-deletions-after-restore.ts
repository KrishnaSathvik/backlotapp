/**
 * After a database restore: re-applies every account deletion recorded in the deletion ledger
 * (src/lib/account/ledger.ts) that the restored database has forgotten. docs/BACKUPS.md, "Restore".
 *
 *   npm run restore:reapply-deletions               # dry run: lists what would be locked
 *   npm run restore:reapply-deletions -- --apply    # inserts the account_deletions rows
 *
 * For each ledger entry whose uid still has data in the restored database and no
 * account_deletions row, it inserts a pending deletion (fresh, unknown status token). That locks
 * the account at once (sign-in gate + database write guard) and the deletion worker deletes it
 * again. Run it BEFORE the restored database takes traffic.
 *
 * Evidence rule: only the ledger (or the old database's account_deletions) proves Backlot was
 * asked to delete an account. A missing Firebase user is never enough on its own
 * (scripts/find-deleted-accounts-after-restore.ts lists those for review only).
 *
 * Needs: DATABASE_MIGRATION_URL pointing at the RESTORED database, and the R2 settings
 * (STORAGE_BACKEND=r2, R2_*) so the ledger can be read.
 */
import crypto from 'node:crypto';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { resolveDbConfig } from '../src/db/connection-config.ts';
import { ACCOUNT_TABLES } from '../src/db/account-guard.ts';
import { getDeletionLedger } from '../src/lib/account/ledger.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const apply = process.argv.includes('--apply');
const ledger = getDeletionLedger();
if (!ledger) {
  console.error('No deletion ledger configured (STORAGE_BACKEND=r2 with R2_* settings).');
  process.exit(2);
}
const cfg = resolveDbConfig(process.env, 'migration');
if (cfg.source === 'none') {
  console.error('Set DATABASE_MIGRATION_URL to the restored database.');
  process.exit(2);
}

const client = new Client(cfg.pool);
await client.connect();
try {
  const entries = await ledger.list();
  console.error(`${apply ? 'APPLYING' : 'Dry run'} · restored db host ${cfg.host} · ${entries.length} ledger entries (${ledger.kind})`);
  let locked = 0;
  for (const e of entries.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))) {
    const { rows: existing } = await client.query('select status from account_deletions where user_uid = $1', [e.uid]);
    if (existing.length) {
      console.log(`${e.uid}\talready recorded (${existing[0].status})`);
      continue;
    }
    let rows = 0;
    for (const [table, col] of ACCOUNT_TABLES) {
      const r = await client.query(`select count(*)::int as n from ${table} where ${col} = $1`, [e.uid]);
      rows += Number(r.rows[0].n);
    }
    if (!rows) {
      console.log(`${e.uid}\tno data in the restored database (nothing to do)`);
      continue;
    }
    console.log(`${e.uid}\t${rows} rows restored → ${apply ? 'locking for deletion' : 'would lock for deletion'}`);
    if (apply) {
      const now = new Date().toISOString();
      const tokenHash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
      await client.query(
        `insert into account_deletions (user_uid, status_token_hash, status, steps, attempts, requested_at, next_attempt_at, updated_at)
         values ($1, $2, 'pending', '{}'::jsonb, 0, $3::timestamp, $4::timestamp, $4::timestamp)
         on conflict (user_uid) do nothing`,
        [e.uid, tokenHash, e.requestedAt.replace('Z', ''), now.replace('Z', '')]
      );
      locked += 1;
    }
  }
  console.error(apply ? `Locked ${locked} account(s); the deletion worker will remove them again.` : 'Dry run only. Re-run with --apply.');
} finally {
  await client.end();
}
