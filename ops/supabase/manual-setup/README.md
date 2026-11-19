# Manual Backlot database setup (Supabase SQL Editor)

These scripts initialize Backlot's database through the Supabase SQL Editor, without a database password on your machine. They do exactly what `npm run db:migrate -- --apply` followed by the role setup would do. Afterwards, `db:migrate` sees every migration as applied.

**Order of use:** `backlot-staging` (`rzgfyzsjbfvdallduxio`) first. `content-vault` only after staging's verification passes and the owner approves (INFRA_SETUP.md §3.1a). Both databases have already had their legacy tables moved into `legacy_init` (`ops/supabase/legacy-init-transition.sql`). Step 00 confirms that.

## Run order

Open the project's SQL Editor (Dashboard → SQL Editor → New query). Paste each file's **whole** contents and press Run, one file at a time, in this order. After each step, check its result before going on.

| Step | File | Changes the database? | Expected result |
| --- | --- | --- | --- |
| 00 | `00_preflight_readonly.sql` | No | Every row `ok`. Any `FAIL`: stop and share the output |
| 01 | `01_migration_2026-11-16_baseline.sql` | Yes | History lists 1 file |
| 02 | `02_migration_2026-11-17_slate_preferences.sql` | Yes | 2 files |
| 03 | `03_migration_2026-11-18_versions_and_slate_actions.sql` | Yes | 3 files |
| 04 | `04_migration_2026-11-19_shared_limits.sql` | Yes | 4 files |
| 05 | `05_migration_2026-11-20_slate_conversations.sql` | Yes | 5 files |
| 06 | `06_migration_2026-11-21_slate_m5.sql` | Yes | 6 files |
| 07 | `07_migration_2026-11-22_upload_sessions.sql` | Yes | 7 files |
| 08 | `08_migration_2026-11-23_account_deletions.sql` | Yes | 8 files |
| 09 | `09_roles.sql` | Yes | Two rows: `backlot_app` (login, no inherit) and `backlot_backup` (login), every other column `false` |
| 10 | Role passwords: generated on your machine (below), not a file | Yes | `ALTER ROLE` twice |
| 11 | `11_verify_readonly.sql` | No | Every row `ok`. Share the whole result |

If the editor warns that a query "contains destructive operations" (it flags `REVOKE`/`DROP` words), check that it's the step you meant to run, then confirm.

## What makes it safe to run, and to re-run

- **One transaction per step.** Each of steps 01–09 commits completely or not at all. A failure leaves the database exactly as it was before that step.
- **Migrations run verbatim.** Each step contains its migration file unchanged and runs it with `EXECUTE`.
- **Exact migration history.** In the same transaction, each step records the row the migration runner itself writes: the file name and the sha256 of that file's exact contents. The checksums are computed from the files, not typed in, and `src/db/manual-setup.test.ts` checks them. Because those rows match, `db:migrate` later reports `Nothing to apply`.
- **Ordering.** A step refuses to run until every earlier file is recorded with its expected checksum. Step 09 refuses until all 8 are recorded.
- **Re-runs.** Re-running a step that succeeded is a no-op. A record with a different checksum stops it.
- **Same preflight as `db:migrate`.** An existing table that lacks the migration's columns, or an index name already used on another table, stops the step instead of being silently skipped.
- **No interleaving.** Each step takes the runner's advisory lock, so a step and `db:migrate` can't run at the same time.
- **Tested.** The test suite runs every script in this order against a database in `content-vault`'s exact state (legacy tables moved aside). It also checks re-runs, out-of-order runs, a wrong checksum, a failing step, and that verification catches drift.

## Step 10: role passwords, without exposing them

Step 09 creates `backlot_app` and `backlot_backup` **without passwords**, so neither can sign in yet. Don't type a password into the SQL Editor: it saves queries in your snippet history. Paste a SCRAM verifier instead. Postgres stores it as is, and the plain password never leaves your machine.

For each role:

1. Generate a password and save it in your password manager under the project and role, for example "backlot-staging / backlot_app":
   ```
   openssl rand -hex 32
   ```
2. In the repository, run the command below and paste the password at the hidden prompt. It prints one line and stores nothing:
   ```
   node scripts/role-password-sql.ts backlot_app
   ```
   The line looks like `ALTER ROLE backlot_app WITH PASSWORD 'SCRAM-SHA-256$4096:…';`
3. Paste that line into the SQL Editor and run it.
4. Repeat for `backlot_backup`, with a **different** password.

Afterwards, delete those two queries from the SQL Editor's history. A verifier isn't the password, but it shouldn't be kept either.

Where each password goes later:
- `backlot_app`: only Vercel's `DATABASE_URL` (transaction pooler, user `backlot_app.<project-ref>`) and the password manager.
- `backlot_backup`: only GitHub's `BACKUP_DATABASE_URL` (session pooler) and the password manager.

Use different passwords for staging and production, and never reuse a staging password in production. Step 11 can't read passwords, so the sign-in itself is checked when the app first connects (release checklist S-DB6).

## Also in the dashboard

- **Project Settings → Data API:** turn it off. Backlot never uses it, and step 09 already removes the API roles' table access.
- **Advisors → Security advisor:** should show nothing for Backlot's tables.

## Regenerating

Never edit the generated `.sql` files by hand. After adding a migration, regenerate them with `node scripts/generate-manual-setup.ts`. That only uses a temporary in-process database and connects to nothing. The step numbers assume 8 migrations, and the generator stops if that changes.
