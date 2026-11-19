# Migration report: Google Cloud → Vercel + Supabase + Cloudflare R2

Status, 2026-11-17: **code adaptation and documentation complete. Nothing has been provisioned, deployed or migrated, and nothing has been committed.** All checks below are local checks. No integration has been tested live.

## 1. Existing architecture (before)

The Next.js 15 App Router app ran in one Cloud Run service. Dependencies:

| Area | Before | Kind |
| --- | --- | --- |
| Hosting | Cloud Run, `output: 'standalone'`, 300 s request timeout | Replaced |
| Database | Cloud SQL Postgres via `SQL_HOST` (Unix socket), node-postgres + Drizzle, pool of 10 | Replaced (connection only) |
| Schema management | `drizzle-kit push`, plus 7 hand-applied SQL files. The 5 core tables had **no SQL migration at all**. | Fixed |
| Media | Private GCS bucket, server-relayed 2 MB chunks into GCS resumable sessions, server-streamed reads, 7-day soft delete | Replaced (GCS kept as legacy) |
| Identity | Firebase Auth. Admin SDK initialized with the project id only, relying on Cloud Run's ADC for revoke/delete | Kept; credential adapted |
| Jobs | Cloud Scheduler with OIDC tokens (`google-auth-library`), or bearer secrets | Replaced (secrets kept) |
| Deletion evidence outside the DB | Cloud Logging events | Replaced (R2 ledger) |
| Backups | Cloud SQL automated backups (never verified) | Replaced (own encrypted dumps) |
| Slate | OpenAI → Anthropic, DB-backed limiter and breaker, embeddings as `real[]`, image analysis read from the store | Unchanged |

Portability findings:

- Every lock and setting the app uses is transaction-scoped, so the Supabase transaction pooler works: `pg_advisory_xact_lock`, `FOR UPDATE SKIP LOCKED`, and `SET LOCAL backlot.account_guard`.
- No extensions are needed. Embeddings are `real[]` and similarity is computed in app code.
- Nothing ran in the background after a response. All job work was already inside the request.

## 2. Target architecture

Vercel (Next.js and APIs, `iad1`) · Supabase Postgres (US East, to be confirmed) · Cloudflare R2 (private media + deletion ledger; a separate backups bucket) · Firebase Auth · OpenAI → Anthropic · Cloudflare Worker cron · GitHub Actions backups. See DEPLOYMENT.md, "Target architecture".

## 3. Files changed

**New**

| File | Purpose |
| --- | --- |
| `src/db/connection-config.ts` | `DATABASE_URL` / `DATABASE_MIGRATION_URL` / `SQL_*` resolution, TLS with `DATABASE_CA_CERT`, pool sizing, config checks |
| `src/db/migrate.ts`, `scripts/db-migrate.ts` | Checksummed migration runner (`npm run db:migrate`) |
| `src/db/migrations/2026-11-16_baseline.sql` | Core tables that previously existed only via `db:push` |
| `src/db/migrations.test.ts` | Builds a DB from the files alone, compares it to schema.ts, checks 13 guard triggers and checksum refusal |
| `src/lib/storage/r2.ts` | R2 store: multipart, per-part presigned PUT with signed `content-length`, presigned GET, listing |
| `src/lib/storage/direct.test.ts` | Direct-upload state machine and orphan sweep tests (fake R2, real SQL) |
| `app/api/upload/session/route.ts`, `parts/route.ts`, `complete/route.ts` | Direct-upload API (start/resume/cancel, sign parts, complete+validate) |
| `src/lib/account/ledger.ts`, `ledger.test.ts` | Deletion ledger outside the database |
| `scripts/reapply-deletions-after-restore.ts` | Re-locks ledger-confirmed accounts after a restore |
| `src/lib/firebase-admin-config.ts` | Firebase Admin credential parsing (no side effects) |
| `ops/scheduler/worker.js`, `wrangler.toml` | Cloudflare Worker cron for both jobs |
| `.github/workflows/db-backup.yml` | Nightly encrypted `pg_dump` to R2 |
| `vercel.json` | Region and function durations |
| Docs | `docs/STORAGE.md` (rewritten), `BACKUPS.md`, `WORKERS.md`, `COSTS.md`, `INFRA_SETUP.md`, `RELEASE_CHECKLIST.md` (replaces VERIFICATION.md), this report |

**Modified**

| File | Change |
| --- | --- |
| `src/db/index.ts` | Pool from connection-config; `attachDatabasePool` on Vercel |
| `src/db/drizzle.config.ts` | Refuses production/Vercel; uses the new resolver |
| `src/lib/storage/types.ts`, `index.ts` | `r2` backend; optional `direct`, `signedReads` and `inventory` capabilities |
| `src/lib/storage/uploads.ts` | Shared atomic reservation (+ app-wide ceiling); direct-upload start/sign/complete/cancel; R2 orphan sweep with safety stop; beta defaults |
| `src/lib/upload-limits.ts`, `src/lib/upload-client.ts` | Configurable beta limits; direct uploads with resume, cancel and missing-part repair; chunked fallback for local |
| `app/api/files/[key]/route.ts` | Owner check, then 302 to a 5-minute signed R2 URL (proxy still available) |
| `app/api/upload/chunk/route.ts` | Local and legacy only |
| `app/api/chat/route.ts` | `maxDuration = 300` |
| `src/lib/account/deletion.ts` | New first step `record_ledger`; soft-delete default 0 for R2 |
| `app/api/account/deletion/route.ts`, `app/api/internal/*` | Ledger write; bucket sweep and ledger purge in maintenance; route config |
| `src/lib/firebase-admin.ts` | Service-account credential from env |
| `src/lib/config-check.ts`, `src/lib/ops.test.ts` | Checks for the new stack (legacy setup still validates) |
| `src/lib/internal-auth.ts` | Docs only |
| `next.config.ts` | `standalone` only off Vercel; `serverExternalPackages` |
| `package.json` | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `@vercel/functions`; `db:migrate` and `restore:reapply-deletions` scripts; tests include `src/db` |
| Public pages and UI | `app/privacy/page.tsx`, `app/support/page.tsx`, `app/llms.txt/route.ts`, `ItemEditorModal`, `AccountSettingsSheet`, `DeletionStatus`: new providers, no soft delete, real limits |
| Other | `scripts/find-deleted-accounts-after-restore.ts`; `.env.example`; README; DEPLOYMENT.md (rewritten); ACCOUNT_DELETION.md; LAUNCH_PUBLIC.md; OPERATIONS.md (marked legacy) |

The `.env.example` and README diffs also contain earlier, uncommitted work from before this migration. Review `git diff` as a whole.

## 4. Schema and migration compatibility

- All 15 tables are unchanged; this adds one bookkeeping table, `backlot_schema_migrations`.
- Applying the baseline plus the 7 files in order to an empty Postgres matches `schema.ts` exactly. The single exception is the `coalesce(channel_id, 0)` expression index, which drizzle-kit always re-proposes; it is checked directly instead.
- All 13 write-guard triggers are installed.
- Re-running is a no-op, and an edited or removed applied file stops the run.
- Verified on PGlite (Postgres 17 in-process), **not yet on Supabase**.

## 5. Supabase connection strategy

- **Runtime:** transaction pooler (6543), pool of 5 per instance, 10 s idle timeout, closed on suspension via `attachDatabasePool`.
- **Migrations and restore scripts:** session pooler (5432) or direct, because the migration runner holds a session advisory lock. The runner refuses port 6543.
- **TLS:** verified with `DATABASE_CA_CERT`; production refuses a Supabase URL without it unless `DATABASE_SSL=no-verify` (warned).

## 6. R2 multipart uploads

STORAGE.md has the full flow. In short:

- The server reserves quota atomically (per-account and global xact locks), then creates the multipart upload.
- It signs one URL per part. Each URL is valid 15 minutes and signs `content-length;host`, confirmed offline by inspecting a generated URL.
- At completion, R2's ListParts is the source of truth. Every part must have its exact size; then the object's size and first 64 bytes are checked.
- Rejected uploads are aborted, deleted and released. Completion is idempotent, including recovery after a database failure.
- Resume across refreshes works through a localStorage fingerprint plus server ListParts. Out-of-order parts are reconciled, not rejected.

## 7. Vercel runtime configuration

- Node.js runtime on all changed routes. `maxDuration` is 300 on chat and the jobs and 60 on upload completion.
- Region `iad1`. No `standalone` output on Vercel.
- No work happens after a response.
- Config check runs at start and on `/api/health?ready=1`.

## 8. Firebase compatibility

- Google sign-in, token verification, the `cv_session` cookie, recent-sign-in checks and the account lock are unchanged.
- On Vercel, Admin needs `FIREBASE_SERVICE_ACCOUNT_JSON`. Production refuses to start on Vercel without it, and refuses a credential from a different project.
- Authorized domains must be added for the Vercel domains (DEPLOYMENT.md step 9).

## 9. Slate compatibility

No Slate logic changed:

- The provider order is unchanged, and fallback still happens only before visible output.
- Limiter, breaker, actions, versioning, conversations, embeddings and search are untouched.
- They all depend on the database, and the transaction-pooler analysis applies to them.
- Image analysis reads from R2 server-side through the same size-capped `readBuffer`. No image passes through a request body.

## 10. Account deletion and workers

- **Deletion steps:** `record_ledger` → revoke → cancel uploads (multipart abort + delete) → workspace → Slate → files (R2) → sign-in → profile → verify.
- **Scheduler:** a Cloudflare Worker cron calls the deletions job every 5 minutes and maintenance daily, each with its own secret.
- **Maintenance additions:** an R2 multipart sweep (after 2 days), an orphan-object sweep (after 7 days, with a stop when more than 50% look orphaned), and a ledger purge (after 90 days).
- **Status:** deletion is not operational until the Worker is deployed (WORKERS.md).

## 11. Backup and recovery

- **Design:** nightly `pg_dump`, encrypted with `age` to an offline key, stored in a separate R2 bucket, 30-day lifecycle.
- **Deletion ledger:** kept in R2, survives restores.
- **Restore:** into a new Supabase project, then `restore:reapply-deletions` before any traffic.
- **Status:** not operational until the workflow is pushed, its secrets are set, and a restore test passes (BACKUPS.md).

## 12. Security and privacy changes

- Bucket credentials stay server-side. The browser only ever holds per-part and per-object URLs that expire in minutes.
- File reads happen on R2's origin, not Backlot's.
- The orphan sweep never deletes unknown keys and never deletes after a failed query.
- The ledger holds the uid and request date only.
- The privacy page names Vercel, Supabase, Cloudflare and GitHub, says deleted files have no recovery copy, and describes the ledger. **Legal review is still required**: the header comment lists hosting regions, DPAs, backup retention wording and international transfers.

## 13. Plan limitations (actual)

See DEPLOYMENT.md, "Plan limits".

- Vercel Hobby is **non-commercial only**.
- Hobby cron is daily only (hence the Worker).
- Function duration: 300 s assumed; **verify** in the Vercel dashboard for the chosen plan.
- Vercel logs are kept only briefly.
- Supabase Free: 500 MB, pausing, no downloadable backups.
- R2 free tier: 10 GB-month.

## 14. Estimated operating costs

COSTS.md has the full model:

- **10 creators:** about $0 for infrastructure, excluding AI and subject to the commercial-use question.
- **100 creators:** R2 and probably Supabase become paid.
- **1,000 creators:** paid plans everywhere.

## 15. Development checks completed

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: succeeds.
- `npm test`: 191 pass, 0 fail (2 skipped). New tests cover migration integrity, connection config, the direct-upload state machine, the orphan sweep with its safety stop, the ledger, and the production config check.
- Offline inspection of generated presigned URLs.

## 16. Unverified behavior

Everything that needs a real service:

- Supabase pooler behavior under load.
- Whether R2 enforces the signed `content-length`.
- R2 CORS, including the "Download all" redirect.
- `<video>` range requests after the 302.
- ListParts pagination beyond 1,000 parts.
- Firebase Admin from Vercel.
- Vercel duration limits.
- Worker cron delivery.
- The GitHub backup job and an actual restore.
- The Supabase CA chain.

## 17. Infrastructure setup instructions

DEPLOYMENT.md "Setup runbook" (14 steps), STORAGE.md "Bucket setup", WORKERS.md, BACKUPS.md.

## 18. Final verification checklist

RELEASE_CHECKLIST.md (prepared, not run).

## 19. Deployment and rollback plan

DEPLOYMENT.md "Deployment and rollback".

## 20. Owner decisions remaining

1. **Commercial or personal beta?** Commercial needs Vercel Pro before public launch.
2. **Firebase project ownership:** `gen-lang-client-0425820524` was created by AI Studio. Keep it, or move to a new project you own.
3. **Regions:** Supabase US East + Vercel `iad1` (proposed), or another pair, considering where creators are and privacy law.
4. **Supabase pausing:** accept it for the beta, or use Supabase Pro.
5. **Beta limits:** 500 MB video, 30 MB image, 1 GB per creator, 2 concurrent uploads, 9.5 GB app ceiling. Keep or change.
6. **Scheduler:** Cloudflare Worker (proposed), or another provider.
7. **Backups:** GitHub Actions + `age` + R2 with 30-day retention (proposed). Who holds the private key?
8. **Retention:** ledger 90 days, deletion records 30 days, Slate actions 30 / audit 180 days.
9. **Legal review** of the privacy page and terms.
10. **Existing data:** confirm there is nothing in the old Cloud Run / Cloud SQL / GCS setup to bring over. If there is, approve a separate migration task.
11. **Approval to provision** the resources in DEPLOYMENT.md steps 3–14, and to run the final verification.

**Answered 2026-11-18** (INFRA_SETUP.md "Owner decisions"): 1 personal noncommercial beta on Hobby; 2 a dedicated Backlot Firebase project if the old one has no real users; 3 Supabase US East + `iad1`; 4 pausing accepted for the beta; 7 the owner holds the backup key; 9 legal review before public launch; 11 setup **preparation** approved, while creating resources, deploying and final verification each still need confirmation. Items 5, 6, 8 and 10 are taken as proposed unless the owner says otherwise.

## Setup-preparation review (2026-11-18)

Review of the whole uncommitted diff plus the owner's three issues. Code changes were limited to concrete compatibility fixes:

| Change | Why |
| --- | --- |
| Function limits per route: chat 300 s, deletion worker 120 s (90 s work budget), maintenance 180 s; scheduler timeouts 130 s / 190 s | Sized to each route's real work instead of 300 s everywhere. A deletion run now always ends before the next 5-minute tick |
| `NEXT_PUBLIC_FIREBASE_CONFIG` (`src/lib/firebase-public-config.ts`), with config checks for mismatched projects | Staging must sign in to its own Firebase project. With a shared project, a staging deletion would delete a production sign-in |
| `ops/supabase/roles.sql`: Data API roles lose table access; runtime role `backlot_app` (data access only); `backlot_backup` | Supabase grants its API roles access to `public` tables by default. Before this, the runtime ran as `postgres`, a step back from the old app-user/admin split |
| Scheduler: `[env.staging]` and an optional `x-vercel-protection-bypass` header | Vercel's Deployment Protection would block the staging scheduler |
| Backup workflow: `AWS_*_CHECKSUM_*=when_required`; correct failure-notification note | Newer AWS CLI checksum defaults vs R2; GitHub notifies the last cron editor, not "the owner" |
| Deletion wording: status page 503 says the account stays locked and deletion resumes; privacy and settings say "usually within 15 minutes", and that a database pause can delay it | Never promise completion while the free database can pause |
| Code comment on part signing | It overstated that R2 enforces the signed length; that's unverified (S-UP3), and completion is the authoritative check |

Repository checks: the baseline migration sorts first; the runner refuses changed or missing applied files (PGlite tests); no production code path references the old AI Studio app or its Cloud SQL database. Remaining Google Cloud code (the `@google-cloud/storage` store and `scripts/migrate-uploads-to-gcs.ts`) is legacy, used only when `STORAGE_BACKEND=gcs`. The doc OPERATIONS.md is marked legacy.

Setup instructions: INFRA_SETUP.md. Final verification: RELEASE_CHECKLIST.md.

## Final audit (2026-11-19)

Local checks, re-run on the whole uncommitted tree:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run build` | Succeeds |
| `npm test` | 193 tests: 191 pass, 0 fail, 2 skipped |
| `npm audit --omit=dev` | 6 advisories (5 high, 1 moderate), none fixable without a breaking upgrade. `@grpc/grpc-js` only arrives through `firebase` → `@firebase/firestore`, and no code imports Firestore. `postcss` is Next's own copy, used at build time on Backlot's CSS only. Not a staging blocker. Re-check when moving to Next 16. |
| Secret scan of the 149 untracked files and the full diff (OpenAI/Anthropic keys, AWS keys, private keys, age keys, JWTs) | Nothing found. `.env.local` is ignored. |
| Consistency | `vercel.json` function limits, both `app/api/internal/*` routes, and the Worker's paths, secrets and timeouts all agree. |

Live account state, checked read-only: no Backlot Vercel project; no Backlot Supabase project (the unrelated `content-vault` project is still the only active one). **Nothing has been provisioned, deployed, committed or migrated.** No item in RELEASE_CHECKLIST.md has run yet.

Release blockers: every item in RELEASE_CHECKLIST.md, legal review (S-PR3) before any public launch, and the owner's explicit release approval.
