# Account and data deletion (Launch L2)

Creators delete their own account from **Settings → Delete account**. The request-based option (email, see `/privacy#deletion`) still works for anyone who can't sign in. An operator handles those requests with the same job (see "Operator actions").

## Flow

| Stage | What happens | Code |
| --- | --- | --- |
| Confirm | The creator types `DELETE`. The server also requires a sign-in from the last 10 minutes, so the app asks for Google sign-in again first (`reauthenticateWithPopup`). | `AccountSettingsSheet.tsx`, `POST /api/account/deletion` |
| Lock | One `account_deletions` row is inserted (idempotent: a repeat returns the same job). From then on: (1) `requireUser` refuses the account on **every** route with `403 account_deleting`, checked on every request and before the profile upsert, so a token that's still valid can't start anything new; (2) the database **write guard** refuses any INSERT or UPDATE of the account's rows in all 13 tables, from any code path (see below). Firebase refresh tokens are revoked, so no new ID tokens are issued. The browser forgets the account's local Slate keys, keeps only the status token, signs out and opens the status page. | `auth-server.ts`, `account-guard.ts`, `deletion.ts: requestAccountDeletion` |
| Grace period | 3 minutes before the job starts. It's a drain window, not permission: no new request gets past the gate, and work already running can't write either (the guard refuses it). Requests already in flight just finish or fail. The final check is a third line of defence. | `DEFAULT_GRACE_MS` |
| Job | A worker claims the job with a 10-minute lease (`FOR UPDATE SKIP LOCKED`, so only one worker runs it) and runs the steps below in order. Each step is idempotent, and its completion time is saved as soon as it finishes, so a crash resumes at the step that didn't finish. | `deletion.ts: processDueDeletions` |
| Retry | A failed step saves a short error code (never content or tokens) and retries after 1, 5, 15, 30 and 60 minutes, then every 6 hours, **indefinitely**. After 4 attempts the status page says it's taking longer, and each retry logs `account deletion retry … needs_attention`. | `backoffMs` |
| Complete | Only after `verify` finds no rows for the uid in any table and no Firebase user. | `verify` step |
| Record | The completed row (uid, public id, step times; no email, no content) stays `ACCOUNT_DELETION_RECORD_DAYS` (30) days for the status page, then the daily cleanup removes it. | `purgeDeletionRecords` |

### Steps

| # | Step | Removes | Notes |
| --- | --- | --- | --- |
| 1 | `revoke_sessions` | Firebase refresh tokens | Also done when the request is made. |
| 2 | `cancel_uploads` | `upload_sessions` rows, partial objects | Cancels each active resumable session (so its URI stops working), then deletes any object it produced. |
| 3 | `delete_workspace` | `content_items` (captions, tags, notes, references), `ideas` (links, source relationships), `channels` | One transaction. |
| 4 | `delete_slate` | `slate_conversations` (incl. condensed notes in `summary`), `slate_messages`, `slate_embeddings`, `slate_preferences`, `slate_actions`, `slate_action_events`, `slate_usage_leases` | One transaction. Audit events hold no content but are tied to the account, so they go too. `slate_breaker_state` is global (per provider), not user data. |
| 5 | `delete_files` | R2 objects, then `uploaded_files` rows | Batches of 200, 8 deletes at a time. Object first, then row, so a partial failure leaves rows pointing at what's still there. |
| 6 | `delete_sign_in` | Firebase Authentication user | After everything the sign-in could reach is gone. The job doesn't need it (it runs server-side by uid). Doesn't touch the person's Google account. |
| 7 | `delete_profile` | `users` row | |
| 8 | `verify` | — | Counts rows for the uid in all 13 user tables and checks Firebase. If something is there (a late write), the job is sent back to the step that clears that table and retried in a minute. |

### Write guard (no writes after deletion starts)

`src/db/migrations/2026-11-23_account_deletions.sql` installs a `BEFORE INSERT OR UPDATE` trigger on every user table (`ACCOUNT_TABLES` in `src/db/account-guard.ts`). If the row's account has a deletion row, the write fails with SQLSTATE `BKDEL`. DELETE is never blocked. This covers the paths that run after a request has passed the gate:

| Path | What happens after the lock |
| --- | --- |
| Slate reply still streaming | Saving the reply, the condensed notes and suggested changes is refused. Logged as `slate.reply_not_saved` (NOTICE). |
| Lazy search indexing (embeddings) | Refused. |
| Upload chunk / finalization | The chunk or the final `uploaded_files` row is refused (`403 account_deleting`). `cancel_uploads` deletes the session and any object it wrote. |
| Applying a suggested change, editing a post or idea | Refused at the gate; a request already past it is refused by the guard. |
| Usage-limiter leases | New leases refused; releasing an old one is a no-op. |
| Daily maintenance | Expiring suggestions and aborting abandoned uploads skip locked accounts (the job deletes those rows anyway). Retention deletes still run. |
| Deletion job | Only deletes, so it's unaffected. |

The trigger isn't created by `npm run db:push`: always apply the SQL file. The final `verify` step still catches anything left, for example on a database that was set up without the trigger.

What the guard deliberately allows, so deletion, cleanup, migrations and recovery keep working:

| Kind of write | Allowed? | Why |
| --- | --- | --- |
| Creator-data INSERT/UPDATE on a locked account (any code path) | **Refused** (`BKDEL`) | The point of the guard. |
| Deletion-job bookkeeping (`account_deletions`: claims, steps, retries, completion, purge) | Allowed | That table has no guard; only the worker and the request route write it. |
| DELETE of a locked account's rows (deletion job, retention cleanup) | Allowed | The guard only fires on INSERT and UPDATE. |
| Updates made by a foreign-key action, e.g. `repurposed_from_post_id` set to NULL when the post it was adapted from is deleted | Allowed | They run inside the delete (`pg_trigger_depth() > 1`). Without this, deleting a source post would fail. |
| Operator writes during a migration, backfill or restore | Allowed only inside a transaction that runs `SET LOCAL backlot.account_guard = 'off'` | The setting ends with the transaction. The app never sets it. It's a guard against app bugs, not a security boundary against someone who can already run SQL. |

Migrations that add columns with constant defaults, or create tables and indexes, don't fire the trigger. A backfill (`UPDATE ... SET new_col = ...`) on a table with locked accounts does: run it with the setting above, or exclude locked accounts. Restoring a backup (Cloud SQL restore or clone) doesn't run triggers.

### Three kinds of "deleted"

| Kind | When | Shown as |
| --- | --- | --- |
| **Logical** (access) | At request time. Nothing in the account can be opened or changed. | "Access removed" |
| **Actual** (rows and objects) | Steps 2–7. Database rows are gone. Cloud Storage objects are deleted (live versions removed). | "Workspace and Slate data deleted", "Uploaded files deleted" |
| **Provider recovery** | None on R2 (no soft delete, no versioning): objects are erased when deleted. The legacy Cloud Storage bucket kept them 7 days. | Nothing extra shown (`STORAGE_SOFT_DELETE_DAYS` unset = 0) |

Database backups (encrypted nightly dumps, docs/BACKUPS.md) can hold deleted rows until they expire (30 days by design). The deletion ledger (R2, `ledger/account-deletions/`, 90 days) records each request outside the database, written when the creator asks and again by the job's first step (`record_ledger`), so a restore can re-apply it.

## API

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `POST /api/account/deletion` `{ "confirm": "DELETE" }` | Signed in, sign-in < 10 min old (else `401 reauth_required`), also on a repeat request | Start. `202` new, `200` already started. Returns `{ deletion: { statusToken, …progress } }`. A repeat issues a new token and retires the old one. |
| `GET /api/account/deletion` | Signed in (allowed while locked) | This account's progress, or `null`. Never returns a token. |
| `POST /api/account/deletion/status` `{ "token": "…" }` | Status token | Progress for the status page. See "Status link" below. |
| `POST /api/internal/account-deletions` | Job `deletions`: OIDC from `DELETION_WORKER_INVOKER`, or `Bearer DELETION_WORKER_SECRET` | Worker. Runs due jobs for up to 90 s (route limit 120 s); the rest continues on the next call. |
| `POST /api/internal/cleanup` (daily) | Job `maintenance`: OIDC from `MAINTENANCE_INVOKER`, or `Bearer MAINTENANCE_SECRET` | Purges completed deletion records after the record period (plus Slate and upload housekeeping). It doesn't run deletion jobs. |

### Status link

- **Token:** a separate random status token (32 bytes, base64url) is returned once, to the freshly signed-in creator. The database stores only its SHA-256. The uid, the job id and the stored hash don't work as a token.
- **Link:** `/account/deleted#<token>`. The token sits in the URL fragment, which browsers never send to the server, and the page sends it in a POST body. So it never appears in request logs, proxies or `Referer` headers. The browser also keeps it in `localStorage` (`backlot_deletion_status`) so reopening the app finds the page.
- **Response:** state, request time, four progress flags, the soft-delete date (day only), completion time and a "taking longer" flag. No uid, email, job id, attempt count, error or content.
- **Expiry:** malformed, unknown and expired tokens all get the same 404. A token stops working once the completed record is older than `ACCOUNT_DELETION_RECORD_DAYS`, even before the daily purge runs.
- **Enumeration:** guessing is infeasible (256 bits), and a valid token only shows that one deletion's progress.

## Operational setup (not done; needs approval)

1. Apply all migrations with `npm run db:migrate -- --apply` **before** deploying the code (docs/DEPLOYMENT.md). `requireUser` queries `account_deletions` on every request. `db:push` alone isn't enough: it doesn't create the write guard.
2. Scheduler: the Cloudflare Worker in `ops/scheduler` calls `POST https://<host>/api/internal/account-deletions` every 5 minutes with `DELETION_WORKER_SECRET` (docs/WORKERS.md). **Deletion isn't operational until it runs.**
3. Firebase Admin credential on Vercel: `FIREBASE_SERVICE_ACCOUNT_JSON`, a service account with only Firebase Authentication Admin in the Firebase project. The R2 token covers file deletion and the ledger.
4. The worker route has `maxDuration = 300`; the worker stops taking jobs after 240 s.
5. Optional: `ACCOUNT_DELETION_RECORD_DAYS` (default 30), `LEDGER_RETENTION_DAYS` (default 90). Leave `STORAGE_SOFT_DELETE_DAYS` unset on R2.
6. Alerting: `account_deletion.retry` with `needs_attention=true`, and a "no successful worker run" alert (docs/OPERATIONS.md, "Alerts").

## Operator actions

- **Email request:** after verifying the requester controls the sign-in email, find the uid (`select uid from users where email = …`) and start the job the same way the app does (also revoke tokens: the job's first step does it):
  ```sh
  TOKEN=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')   # 43 characters; don't store it
  ```
  ```sql
  insert into account_deletions (user_uid, status_token_hash, status, steps, attempts, requested_at, next_attempt_at, updated_at)
  values ('<uid>', encode(sha256(convert_to('<TOKEN>', 'UTF8')), 'hex'), 'pending', '{}', 0, now(), now(), now())
  on conflict (user_uid) do nothing
  returning id;
  ```
  Then send the requester `https://<host>/account/deleted#<TOKEN>` and discard the token. If the insert returned no row, a deletion already exists. Issue a new token with `update account_deletions set status_token_hash = encode(sha256(convert_to('<NEW TOKEN>','UTF8')),'hex') where user_uid = '<uid>';`.
- **Stuck job:** `select id, status, attempts, last_error, steps from account_deletions where status <> 'completed';` Fix the cause; the job retries by itself. To retry now: `update account_deletions set next_attempt_at = now(), locked_until = null where id = …;`
- There's deliberately no "undo". Removing a row by hand before completion unlocks the account but doesn't restore data that was already deleted.

## Final-verification scenarios (for the test cycle)

1. Delete an account that has every kind of data (channels, posts with cover/video/slides, ideas with screenshots, a repurposed post, Slate chats long enough to have notes, preferences, pending and applied suggestions, an unfinished upload). Afterwards: zero rows for the uid in all 13 tables, zero objects for its keys in the R2 bucket, a ledger entry under `ledger/account-deletions/`, no Firebase user, status page "deleted".
2. A second account's data, files and sign-in are untouched.
3. Old sign-in: the app asks for Google sign-in again before deleting. Cancel the popup: nothing is deleted. Sign in with a different Google account: refused.
4. Typo in the confirmation: the button stays disabled; the API returns 400 without `"DELETE"`.
5. Double-click / two tabs: one job. The most recent status link works; an earlier one shows "isn't valid any more".
6. After requesting, every API route returns 403 for that account (try `/api/workspace`, `/api/files/<key>` in another tab, an upload chunk, a Slate message). Reloading the app goes to the status page.
7. Start a Slate reply or a large upload, then delete the account in another tab. The reply isn't saved (`slate.reply_not_saved`, NOTICE), and the next chunk gets 403. Afterwards, zero rows and zero objects remain.
7a. In psql, try `update content_items set title = 'x' where user_uid = '<locked uid>'`: it fails with `BKDEL`. The same update for another account works.
8. Make storage or Firebase fail (e.g. remove the IAM binding temporarily in a test project): the status stays "in progress", shows "taking longer" after 4 attempts, logs `needs_attention`, and finishes once access is restored. It's never shown as complete early.
9. Kill the worker mid-job (deploy during a run): the next run after the lease (10 min) continues from the unfinished step.
10. The status page works signed out, from another browser (with the link), and after the Firebase user is deleted. An altered or unknown token shows "not valid". Vercel request logs for `/account/deleted` and `/api/account/deletion/status` contain no token.
11. After 30 days (or with `ACCOUNT_DELETION_RECORD_DAYS=1`), the daily cleanup removes the completed record.
12. In R2, a deleted object is gone at once (no soft delete); the status page shows no recovery date.
13. Email path: operator inserts a job for a uid and the same flow completes.
14. The worker with the wrong credentials: a maintenance secret or the maintenance scheduler's OIDC token gets 401 from the deletion worker, and the other way round.

Lightweight checks done in development:

- `npm test` runs on PGlite with real SQL, including the migration's trigger. `src/lib/account/deletion.test.ts` covers:
  - full deletion across all tables and files, and isolation from other accounts;
  - idempotent requests and token rotation, and the grace period;
  - retry with backoff and resume, and worker leases;
  - a late write caught by `verify` (with the guard off);
  - status tokens: hash-only storage, malformed and expired tokens, uid and id not usable as tokens;
  - the write guard on every path, including upload finalization, with maintenance still working;
  - the guard allowing foreign-key cascades and the transaction-scoped operator bypass, and nothing else;
  - record purging.
- `src/lib/ops.test.ts` covers per-job worker credentials.
- `npm run typecheck`, and lint on changed files.
