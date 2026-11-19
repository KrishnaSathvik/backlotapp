// After a database restore: lists accounts in the RESTORED database that no longer have a Firebase
// Authentication user, as review candidates for re-deletion. Read-only: it changes nothing.
//
//   node scripts/find-deleted-accounts-after-restore.ts > firebase-missing-candidates.txt
//
// Needs: DATABASE_MIGRATION_URL (or SQL_*) pointing at the restored database (never production),
// and Firebase Admin credentials that can read users (FIREBASE_SERVICE_ACCOUNT_JSON, or ADC).
// To actually re-apply ledger-confirmed deletions, use scripts/reapply-deletions-after-restore.ts.
//
// What it reports is a list of CANDIDATES FOR REVIEW, never a deletion list. A missing Firebase
// user is consistent with a completed Backlot deletion (which removes the Firebase user last, and
// Firebase isn't restored with the database), but it isn't proof: the uid can also be missing
// after a sign-in migration, a Firebase project or tenant mismatch, or a user removed in the
// Firebase console. Only re-delete a uid that is also in the deletion ledger or the current
// database's account_deletions (docs/OPERATIONS.md "Restore procedure"). Disabled Firebase users
// still exist, so they're never reported.
//
// Safety: if more than MAX_MISSING_SHARE of accounts (default 5%) are missing, it stops without a
// list, because that pattern points to a configuration or migration problem, not to deletions.
import pg from 'pg';
import * as dotenv from 'dotenv';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { resolveDbConfig } from '../src/db/connection-config.ts';
import { firebaseProjectId, readFirebaseAdminCredential } from '../src/lib/firebase-admin-config.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();
const projectId = firebaseProjectId();
const { credential } = readFirebaseAdminCredential();
initializeApp(credential ? { credential: cert({ ...credential, projectId }), projectId } : { projectId });
const firebaseConfig = { projectId };
const auth = getAuth();
const pool = new pg.Pool(resolveDbConfig(process.env, 'migration').pool);

try {
  // Accounts already locked in the restored copy are handled by the worker; skip them.
  const { rows } = await pool.query<{ uid: string }>(
    'select u.uid from users u where not exists (select 1 from account_deletions d where d.user_uid = u.uid) order by u.uid'
  );
  const missing: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => ({ uid: r.uid }));
    const res = await auth.getUsers(batch);
    for (const id of res.notFound) if ('uid' in id) missing.push(id.uid);
  }
  const maxShare = Number(process.env.MAX_MISSING_SHARE ?? '0.05');
  console.error(`firebase project: ${firebaseConfig.projectId}; checked ${rows.length} accounts; ${missing.length} have no Firebase user`);
  if (rows.length > 0 && missing.length / rows.length > maxShare) {
    console.error(
      `STOP: ${Math.round((missing.length / rows.length) * 100)}% of accounts are missing from Firebase. Check the Firebase project, ` +
        'tenant and any sign-in migration before going further. No list printed.'
    );
    process.exitCode = 2;
  } else {
    console.error('These are candidates for review only. Re-delete a uid only when the deletion ledger or account_deletions confirms it.');
    for (const uid of missing) console.log(uid);
  }
} finally {
  await pool.end();
}
