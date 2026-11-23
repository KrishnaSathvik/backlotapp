// After a database restore: lists accounts in the RESTORED database that no longer have a Supabase
// Authentication user, as review candidates for re-deletion. Read-only: it changes nothing.
//
//   node scripts/find-deleted-accounts-after-restore.ts > auth-missing-candidates.txt
//
// Needs: DATABASE_MIGRATION_URL (or SQL_*) pointing at the restored database (never production),
// plus NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY of the project the app signs in with
// (only auth.admin.getUserById is called). To actually re-apply ledger-confirmed deletions, use
// scripts/reapply-deletions-after-restore.ts.
//
// What it reports is a list of CANDIDATES FOR REVIEW, never a deletion list. A missing Auth user
// is consistent with a completed Backlot deletion (which removes the Auth user last, and Supabase
// Auth isn't part of Backlot's database backup), but it isn't proof: the uid can also be missing
// after a sign-in migration (uids from before the move off Firebase are never Supabase users), a
// project mismatch, or a user removed in the Supabase dashboard. Only re-delete a uid that is also
// in the deletion ledger or the current database's account_deletions (docs/BACKUPS.md "Restore
// procedure"). Banned users still exist, so they're never reported.
//
// Safety: if more than MAX_MISSING_SHARE of accounts (default 5%) are missing, it stops without a
// list, because that pattern points to a configuration or migration problem, not to deletions.
import pg from 'pg';
import * as dotenv from 'dotenv';
import { resolveDbConfig } from '../src/db/connection-config.ts';
import { supabaseIdentityProvider } from '../src/lib/account/supabase-identity.ts';
import { supabaseAdmin } from '../src/lib/supabase/admin.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();
const identity = supabaseIdentityProvider(() => supabaseAdmin(process.env));
const pool = new pg.Pool(resolveDbConfig(process.env, 'migration').pool);

try {
  // Accounts already locked in the restored copy are handled by the worker; skip them.
  const { rows } = await pool.query<{ uid: string }>(
    'select u.uid from users u where not exists (select 1 from account_deletions d where d.user_uid = u.uid) order by u.uid'
  );
  const missing: string[] = [];
  for (const { uid } of rows) {
    if (!(await identity.exists(uid))) missing.push(uid);
  }
  const maxShare = Number(process.env.MAX_MISSING_SHARE ?? '0.05');
  console.error(`supabase auth: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(unset)'}; checked ${rows.length} accounts; ${missing.length} have no Auth user`);
  if (rows.length > 0 && missing.length / rows.length > maxShare) {
    console.error(
      `STOP: ${Math.round((missing.length / rows.length) * 100)}% of accounts are missing from Supabase Auth. Check the project ` +
        'and any sign-in migration before going further. No list printed.'
    );
    process.exitCode = 2;
  } else {
    console.error('These are candidates for review only. Re-delete a uid only when the deletion ledger or account_deletions confirms it.');
    for (const uid of missing) console.log(uid);
  }
} finally {
  await pool.end();
}
