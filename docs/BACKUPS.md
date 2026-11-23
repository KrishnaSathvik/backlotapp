# Database backups, restore and the deletion ledger

**No automated backups run.** The owner has chosen not to configure them. `.github/workflows/db-backup.yml` is manual-only (no schedule) and has no secrets, so Backlot has no backup it can restore from, and **data recovery is not guaranteed**. Don't describe backups as working on the privacy page or anywhere else. Whatever Supabase keeps on its own isn't an application backup unless it's confirmed for this project and plan.

The rest of this page is the design and procedure, kept for if that decision changes.

## Why this is needed

Supabase Free doesn't provide downloadable managed backups or point-in-time recovery (verify the current plan terms). Backlot therefore makes its own encrypted logical backups, independent of any laptop being on.

## Design

| Part | Choice |
| --- | --- |
| Trigger | GitHub Actions, manual `workflow_dispatch` only (no schedule) |
| Dump | `pg_dump` 17, custom format (`pg_restore`-able), `public` schema only, `--no-owner --no-privileges` |
| Encryption | Piped straight into `age`, encrypted to an **age public key**. The private key is kept **offline** by the owner; nothing in GitHub or Cloudflare can decrypt a backup. The plaintext dump never touches disk. |
| Destination | A **separate private R2 bucket** for backups (not the media bucket), written with its **own token scoped to that bucket** |
| Integrity | Size sanity check (> 1 KB), SHA-256 stored as object metadata, `db/latest.json` marker with time, size and hash |
| Retention | R2 lifecycle rule on the backups bucket: delete objects after **30 days** |
| Monitoring | Check each manual run's result and `db/latest.json`. |
| Database access | A read-only `backlot_backup` role over the **session pooler (port 5432)** |

Cautions:

- **Public repository:** workflow logs are public. The workflow prints only file names and sizes, never secrets or data, but keep the repository private if possible.

## Setup (not done; the owner has chosen not to)

1. **Key pair**, on the owner's machine: `age-keygen -o backlot-backup.key`. Store the key file offline (password manager or hardware), with a second copy somewhere separate. The printed `age1…` public key becomes `BACKUP_AGE_RECIPIENT`.
2. **Backups bucket** in R2 (for example `backlot-db-backups`): private, no public URL. Add the lifecycle rule "delete after 30 days". Create an API token with *Object Read & Write* on this bucket only.
3. **Read-only role:** created by `ops/supabase/manual-setup/09_roles.sql` (or `ops/supabase/roles.sql`), password set as in that folder's README, step 10. It gets `SELECT` on the `public` schema only, which is all the dump reads. It is deliberately not given `pg_read_all_data`, which would also expose Supabase's `auth` schema.

4. **GitHub secrets:** `BACKUP_DATABASE_URL` (session pooler URL for `backlot_backup`), `BACKUP_AGE_RECIPIENT`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`.
5. Run the workflow once manually, then do the restore test.

## Key custody, rotation and loss

**Who holds the key:** the owner, and only the owner. The private key (`AGE-SECRET-KEY-1…`) is kept outside GitHub, Vercel, Supabase, Cloudflare and the backups bucket: one copy in the owner's password manager, one offline copy (for example an encrypted USB drive or a printed copy) stored separately. The GitHub workflow holds only the **public** recipient, which can encrypt but not decrypt.

**Rotation** (yearly, or at once if the private key may be exposed):

1. `age-keygen -o backlot-backup-<year>.key` on the owner's machine; store both copies as above.
2. Replace the `BACKUP_AGE_RECIPIENT` secret with the new public key. Run the workflow manually.
3. Decrypt that new backup with the new key to prove it works.
4. Keep the **old** private key until every backup encrypted with it has expired (30 days), then destroy it. If the old key was exposed, delete the backups made with it once a backup with the new key is verified.

**If the private key is lost:** every existing backup is permanently unreadable. Nothing (Backlot, GitHub, Cloudflare) can recover it. Generate a new key at once (rotation steps 1–3) so new backups are readable again. Until 30 days of new backups exist, the only copy of the data is the live Supabase database. Supabase Free doesn't offer downloadable backups (check the current plan terms). That is why the key has two copies and the quarterly check below.

## The deletion ledger

Restoring an older snapshot brings back the rows of accounts deleted after it, and the restored `account_deletions` table doesn't know about them. The ledger survives the restore, because it lives outside the database.

| | |
| --- | --- |
| Where | Private R2 media bucket, prefix `ledger/account-deletions/` (`R2_LEDGER_PREFIX`; or `R2_LEDGER_BUCKET`). Separate from `uploads/`, so the orphan sweep never sees it. |
| What | One JSON object per account: `{ uid, jobId, requestedAt }`. No email, no content. |
| When | Written when the creator asks (best effort), and again as the deletion job's first step (`record_ledger`), which retries until it succeeds. Every job that runs has an entry. |
| How long | `LEDGER_RETENTION_DAYS`, default **90**. That must stay longer than backup retention (30) plus the time it takes to notice a problem and restore. Purged by the daily maintenance job. |

**Evidence rules:** re-delete an account only when the **ledger** or the **old database's `account_deletions`** shows that Backlot was asked to delete it. A missing Supabase Auth user is review-only (`scripts/find-deleted-accounts-after-restore.ts`), never proof on its own: it also happens after a project or tenant mismatch, a sign-in migration, or a console deletion.

## Restore procedure (into a NEW Supabase project; never over production)

1. **Don't run the maintenance job** (the orphan sweep) and pause the deletion cron in Vercel (docs/WORKERS.md). Against an older database, files uploaded after the snapshot would look orphaned. The sweep's safety stop is a backstop, not the plan.
2. Create a new Supabase project in the same region. Note its session-pooler URL and CA certificate.
3. Download the backup (`aws s3 cp s3://<backups-bucket>/db/backlot-<stamp>.dump.age . --endpoint-url …`) and check its SHA-256 against the object metadata.
4. Decrypt on the owner's machine: `age -d -i backlot-backup.key -o backlot.dump backlot-<stamp>.dump.age`.
5. Restore into the **empty** database:
   `pg_restore --no-owner --no-privileges --dbname "$RESTORE_SESSION_URL" backlot.dump`
   The dump includes `public.backlot_schema_migrations`, so the migration history comes back with the data.
6. `DATABASE_MIGRATION_URL=$RESTORE_SESSION_URL npm run db:migrate`. A dry run should report every file as already applied. If the backup predates a newer migration, run it again with `--apply` to bring it forward. Then check that `select count(*) from pg_trigger where tgname = 'backlot_account_guard'` returns 13.
7. **Re-apply deletions before any traffic:**
   `DATABASE_MIGRATION_URL=$RESTORE_SESSION_URL npm run restore:reapply-deletions` (dry run), review the list, then the same command with `-- --apply`. Each listed account is locked at once (sign-in gate and write guard).
8. Optionally run `scripts/find-deleted-accounts-after-restore.ts` against the restored database. Its output is a review list; act on an account only with ledger or old-database evidence.
9. Check row counts and a few posts. Point Vercel's `DATABASE_URL` (transaction pooler of the new project) and `DATABASE_CA_CERT` at it, redeploy, and check `/api/health?ready=1`.
10. Resume the deletion cron. Confirm the re-applied deletions reach `completed`, then resume maintenance.
11. Keep the old project until you're satisfied. Delete the decrypted dump.

Media isn't part of the database backup: R2 objects aren't restored or versioned (docs/STORAGE.md).

## Routine checks

| Check | When | Who |
| --- | --- | --- |
| `db/latest.json` is less than 2 days old, and the workflow is still enabled | Monthly | Owner |
| Full restore test (steps 2–9 against a throwaway project, without step 9's traffic switch) | Monthly, and after any schema change | Owner |
| The age private key is readable from both stored copies | Quarterly | Owner |

## Retention summary

| Data | Kept | Where it's set |
| --- | --- | --- |
| Database backups | 30 days | R2 lifecycle rule (backups bucket) |
| Deletion ledger entries | 90 days after request | `LEDGER_RETENTION_DAYS` |
| Completed deletion records (status page) | 30 days | `ACCOUNT_DELETION_RECORD_DAYS` |
| Deleted media | Not kept (deleted immediately) | No soft delete on R2 |

Backups contain creator content for 30 days after it's deleted in the app (including deleted accounts). The privacy page must say so once backups are operational, and that wording needs legal review.
