# Release checklist: final verification

The single checklist for the final verification cycle. It replaces the earlier VERIFICATION.md.

**Status 2026-11-20:** the production database is set up and verified (INFRA_SETUP.md "Status"). There's no staging environment right now: the first staging database was deleted. Items that pause the database or break credentials must run on a staging environment, never on production, so creating one again is an open owner decision.

**Prepared, not executed.** Only local checks have passed so far: typecheck, lint, build and `npm test` (unit tests and PGlite migrations). Run this checklist against the **staging** environment (INFRA_SETUP.md §5), and only once the owner authorizes final verification. Then re-run the items marked **P** against production before inviting anyone.

Ground rules:

- Synthetic data and dedicated test Google accounts A, B and C only. Never production creator data, and never the old AI Studio app or its database.
- Record each result (pass/fail, date, evidence link or note) in the sign-off table. After any fix, re-run its section.
- "Logs" means Vercel runtime logs (JSON lines with an `event` field) unless stated otherwise.
- A failed item blocks release unless the owner records a decision for it.

## Infrastructure and configuration

| ID | Check | Expected |
| --- | --- | --- |
| S-INF1 | `npm run db:migrate` against the new project (session pooler): dry run, then `--apply`, then dry run again | 8 pending → applied, `Account write guard triggers: 13`; then `Nothing to apply` |
| S-INF2 | Edit a comment in an applied migration locally, dry run, then revert | `Refusing to migrate. Changed since applied: [...]`; nothing changes |
| S-INF3 | `db:migrate` with a port-6543 URL | Refused with the "needs a session connection" message |
| S-INF4 **P** | Deploy, open `/api/health?ready=1` | 200; logs show `config.ok`, no `config.error` |
| S-INF5 | Deploy once without `SUPABASE_SECRET_KEY` (then restore it) | `config.error` naming it, plus `config.refusing_to_start` |
| S-INF6 **P** | `vercel inspect <url>`, plus the project's Functions settings | Region `iad1`; Fluid compute on; chat 300 s, deletion request 300 s, deletion recovery 120 s, maintenance 180 s accepted by the plan |
| S-INF7 **P** | Plan | Vercel Pro; Spend Management configured |

## Authentication (Supabase Auth, Google)

| ID | Check | Expected |
| --- | --- | --- |
| S-AU1 | Sign in with Google as A on the staging URL | Back on the same page via `/auth/callback`; library loads; a `users` row exists for A's uid (a UUID equal to Supabase's `auth.users.id`). The consent screen says "Backlot" |
| S-AU2 | Staging isolation | A's Supabase Auth user exists only in the staging project; `backlot` has no user for A |
| S-AU3 | Reload while signed in; then sign out and reload | Still signed in after the reload (session cookies); after sign-out: signed out, `sb-…` cookies gone, API calls return 401 |
| S-AU4 | As B, request A's `/api/items/<id>`, `/api/files/<key>`, `/api/slate/conversations/<id>` | 404 each, never A's data |
| S-AU5 | Unlisted redirect | Sign-in started from an origin not in Supabase's Redirect URLs never returns to that origin (it lands on the Site URL) |
| S-AU6 | Expired session: leave the app idle past the access-token lifetime (1 h), then use it | Works without signing in again (refreshed by the client or `middleware.ts`) |
| S-AU9 | Email sign-up as D (email + password), sign out, sign in again; wrong password; existing email | Signed in at once with a `users` row; "Email or password is incorrect."; neutral "couldn’t create an account" message. No email is sent |
| S-AU11 | Same email via Google and via link | One Supabase user (identities linked), one Backlot account |
| S-AU12 | Delete account, email-only user | Confirmation link sent to their address; after opening it, Delete account reopens; typing DELETE again starts deletion |
| S-AU7 | Forged identity: call an API with a token from another Supabase project, the publishable key as a Bearer token, or a hand-edited `sb-…` cookie | 401 each |
| S-AU8 | Supabase Auth admin key (exercised by S-DEL) | No `account_deletion.revoke_deferred` in logs |

## Content

| ID | Check | Expected |
| --- | --- | --- |
| S-CO1 | Create a post, edit its title, change its stage | Saved; the version increments |
| S-CO2 | Edit the same post in two tabs and save both | The second save gets the conflict message |
| S-CO3 | Create an idea with a link and a screenshot; convert it to a post | The converted post links back |
| S-CO4 | Create a channel and filter by it | Scoped correctly |
| S-CO5 | Delete a post with a cover and slides | Post gone; its unused objects removed from R2 |

## Slate

| ID | Check | Expected |
| --- | --- | --- |
| S-SL1 | Ask a question | Tokens stream; `slate.reply status=done provider=openai` |
| S-SL2 | Invalid OpenAI key (staging only) | Claude answers; exactly one OpenAI attempt and one Anthropic attempt |
| S-SL3 | Interrupt OpenAI mid-answer (short `SLATE_DEADLINE_MS_GENERAL`) | Partial answer marked stopped; **no** Claude call |
| S-SL4 | Press Stop mid-reply | Saved as stopped; provider request aborted |
| S-SL5 | Ask about a post; save a preference; ask again in a new chat | Correct references; preference applied |
| S-SL6 | Apply a proposal; then try a stale one after editing the post elsewhere | First applies with a version bump; the stale one reports a conflict |
| S-SL7 | Open the conversation on a second device | Same conversation |
| S-SL8 | Search by meaning; then `SLATE_SEMANTIC_SEARCH=off` | Found via embeddings; text search still answers when off |
| S-SL9 | Ask about a cover stored in R2 | Answer uses the image; no copy kept |
| S-SL10 | 31 messages in 10 minutes; 3 concurrent; a low daily limit | Each refused with a clear message |
| S-SL11 | Database unreachable (pause staging) and ask Slate | 503 "temporarily unavailable"; `slate.limits_unavailable`; no provider call |
| S-SL12 | A long reply | Finishes within the chat route's 300 s and the configured Slate deadline |

## Uploads (R2, direct multipart)

| ID | Check | Expected |
| --- | --- | --- |
| S-UP1 | Upload a ~300 MB synthetic video | Part PUTs go to `*.r2.cloudflarestorage.com`, never through Vercel; object size matches; `uploaded_files` row exists |
| S-UP2 | Refresh mid-upload and pick the same file | Resumes; only missing parts are sent |
| S-UP3 | **Signed length:** copy a part URL; PUT a body longer than its `size`, then shorter (curl) | **Record what R2 does.** Either way, `/api/upload/complete` must then reject the upload (`part_size`), abort it and release the reservation. R2 accepting a different length is not a blocker, because completion is the authoritative check. Note it in STORAGE.md |
| S-UP4 | Part URL after its TTL; with `partNumber` or the key edited | Rejected |
| S-UP5 | Block one part request once (DevTools) | Complete → 409 `missingParts`; the client re-sends; completes |
| S-UP6 | `.html` renamed to `.mp4` | 415; object removed from R2; session `aborted`; quota released |
| S-UP7 | Quota: lower `STORAGE_QUOTA_GB` to 0.1 and upload past it | 413 storage-limit message |
| S-UP8 | 3 uploads at once | The third gets 429 |
| S-UP9 | `STORAGE_APP_CEILING_GB` just above usage; then a low warning threshold | 507 "beta storage is full" + `storage.app_ceiling_reached`; then `storage.app_usage_high` |
| S-UP10 | Cancel an upload | `cancelled:true`; multipart aborted; space released |
| S-UP11 | Quota accounting after S-UP3/S-UP6/S-UP10 | A's used storage equals the sum of A's finished files |

## Downloads and media delivery

| ID | Check | Expected |
| --- | --- | --- |
| S-DL1 | Open an image; inspect the redirect | 302 to R2 with a ~300 s expiry, `Referrer-Policy: no-referrer`; after expiry, or with the key edited, the URL fails |
| S-DL2 | Download one file; "Download all" | Original file name; the zip builds (R2 CORS GET for the app origin) |
| S-DL3 | Play a video and scrub, in Chrome and Safari | Range requests answered 206 by R2; seeking works; playback continues past the 300 s URL expiry, or the player reloads cleanly (record which) |
| S-DL4 | B requests A's `/api/files/<key>` | 404; no redirect |
| S-DL5 **P** | Object URL without a signature; r2.dev URL | Denied; r2.dev disabled |
| S-DL6 | CORS from a non-listed origin | Browser blocks it |

## Database (Supabase)

| ID | Check | Expected |
| --- | --- | --- |
| S-DB1 | Run S-CO, S-SL6 and S-UP through the transaction pooler | No prepared-statement or session errors in logs |
| S-DB2 | Two uploads at the same moment near the quota | Only one reserved |
| S-DB3 | Two concurrent deletion-worker calls | Each job runs once |
| S-DB4 | 20 concurrent edits to one post | One success per version; the rest get conflicts |
| S-DB5 **P** | Privileges (queries at the end of `ops/supabase/roles.sql`) and the Data API | `anon` has no table access; `backlot_app` has DML but not `backlot_schema_migrations`; 13 guard triggers; `curl https://<ref>.supabase.co/rest/v1/content_items` doesn't return data; security advisor clean |
| S-DB6 **P** | Runtime role | Logs/`pg_stat_activity` show the app connected as `backlot_app`, never `postgres` |
| S-DB7 | Verified TLS: correct CA, then a wrong CA (staging) | Readiness 200; then 503 `database` |
| S-DB8 | Pause staging, use the app, resume | 503 "database unavailable", never wrong data; recovers without a redeploy |
| S-DB9 | Database size after the cycle | Recorded |

## Scheduling

| ID | Check | Expected |
| --- | --- | --- |
| S-SC1 **P** | Vercel → Settings → Cron Jobs | `/api/internal/account-deletions`, hourly |
| S-SC2 **P** | Wait for the next hour | The cron run answered 200 |
| S-SC3 **P** | Trigger maintenance manually | `maintenance.run` with no failed parts, finished within 180 s |
| S-SC4 | No secret, the maintenance secret, a wrong `CRON_SECRET` | 401 `internal_auth.denied`; 404 for a job without a credential |
| S-SC5 | Orphan sweep: an object with no row (min age lowered for the test); then a preview pointed at an empty database | Deleted; then `storage.orphan_sweep_refused` and nothing deleted |
| S-SC6 | Abandoned multipart upload past the abandoned age (shortened for the test) | Aborted by maintenance |

## Account deletion

| ID | Check | Expected |
| --- | --- | --- |
| S-DEL1 | Request deletion more than 10 minutes after sign-in | `reauth_required`; proceeds after re-auth |
| S-DEL2 | Confirm "DELETE" | 202 with a status link; status "scheduled" (accepted and locked); every other call from A gets 403 `account_deleting` |
| S-DEL3 | Ledger | `ledger/account-deletions/<uid>.json` (uid, jobId, requestedAt; no email) |
| S-DEL4 | Prompt start | About 3 minutes after the request: `account_deletion.step` for each step in order, then `account_deletion.completed` and `account_deletion.prompt_start` |
| S-DEL5 | Data gone | No rows for A in the 13 guarded tables; A's R2 objects gone; multipart uploads aborted; Supabase Auth user gone |
| S-DEL6 | Status page signed out | "Completed"; `storagePurgeBy` null; a wrong token gets 404 |
| S-DEL7 | **Database paused before a request:** pause staging, request deletion as C | Refused: "Nothing was deleted"; no lock, no partial work. Resume, then request again: accepted |
| S-DEL8 | **Database paused after acceptance:** request as C, pause staging before the worker runs, wait, resume | While paused: status page says progress can't be checked, the account stays locked, deletion continues automatically; no "completed". After resuming: completes within one or two scheduler runs |
| S-DEL9 | R2 credentials broken for the worker during a deletion (staging), then restored | `account_deletion.retry` with backoff, then completion; "delayed" shown after repeated attempts; never completed early |
| S-DEL10 | B after A's deletion | B's content and files intact |

## Backups and restore (skip: no backups configured, owner decision)

| ID | Check | Expected |
| --- | --- | --- |
| S-BK1 **P** | Manual `db-backup` run | `db/backlot-<stamp>.dump.age` and `db/latest.json`; log shows only names and sizes |
| S-BK2 **P** | Download, check the SHA-256, `age -d`, `pg_restore` into an empty project (INFRA_SETUP.md §5 project limit), `db:migrate` dry run | Row counts match; `Nothing to apply`; 13 triggers |
| S-BK3 | Back up; delete account C fully; restore that backup; `restore:reapply-deletions` dry run, then `--apply`; point staging at it | C listed as "would lock"; then locked and re-deleted by the worker. A Supabase-Auth-only miss is never acted on |
| S-BK4 **P** | Backups bucket lifecycle | Deletes after 30 days |
| S-BK5 | Workflow triggers | `db-backup.yml` has only `workflow_dispatch`; no scheduled runs in the Actions tab |
| S-BK6 | Key rotation drill (BACKUPS.md) | A backup made with the new recipient decrypts with the new key; an old backup still decrypts with the old key |
| S-BK7 **P** | Key custody | Two copies of the private key exist and open; nothing in GitHub, Vercel, Supabase or Cloudflare holds it |

## SEO and public pages

| ID | Check | Expected |
| --- | --- | --- |
| S-SEO1 **P** | `/robots.txt`, `/sitemap.xml`, `/llms.txt`, canonical tags, OG image | All use the production `SITE_URL`; nothing names `localhost` or `*.vercel.app`; app and API routes carry `noindex` |
| S-SEO2 | Crawler policy | Search and AI-search bots allowed; training bots disallowed unless `ROBOTS_DISALLOW_AI_TRAINING=false` |
| S-SEO3 | `/llms.txt` and `/support` | Show the real limits (500 MB video, 30 MB image, 1 GB, 2 at a time) |
| S-SEO4 | Unknown URL | Branded 404, `noindex` |

## Privacy and legal

| ID | Check | Expected |
| --- | --- | --- |
| S-PR1 **P** | `/privacy` | Names Vercel, Supabase (Auth: Google and email/password; database), Cloudflare (R2), OpenAI and Anthropic; explains no R2 recovery copy, ledger retention, no Backlot-run backups, and deletion in the background with no time promise; `support@getbacklot.app` (or `PRIVACY_CONTACT_EMAIL`) shown |
| S-PR2 | Backups wording | The privacy page mentions encrypted backups only once S-BK1 and S-BK2 have passed |
| S-PR3 **P** | Professional legal review of `/privacy` and `/terms` (items in the header comment of `app/privacy/page.tsx`) | Done before any public launch (owner decision, 2026-11-18) |

## Accessibility and responsiveness

| ID | Check | Expected |
| --- | --- | --- |
| S-A11Y1 | Keyboard only: landing, sign-in, library, detail, editor, ideas, Slate, account deletion | Every control reachable; visible focus; dialogs trap and return focus |
| S-A11Y2 | Screen reader (VoiceOver) on the same flows | Labels on controls; upload progress and the deletion status announced |
| S-A11Y3 | Contrast in light and dark themes | WCAG AA for text |
| S-A11Y4 | Phone, tablet, desktop | No horizontal scroll; uploads and Slate usable on a phone |
| S-A11Y5 | Reduced motion | Respected |

## Sign-off

| Section | Result | Date | Notes |
| --- | --- | --- | --- |
| Infrastructure | | | |
| Authentication | | | |
| Content | | | |
| Slate | | | |
| Uploads | | | |
| Downloads | | | |
| Database | | | |
| Scheduling | | | |
| Account deletion | | | |
| Backups and restore | | | |
| SEO | | | |
| Privacy and legal | | | |
| Accessibility | | | |

Release to invited testers only when every section passes, or carries a recorded owner decision.
