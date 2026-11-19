# Deploying Backlot (Vercel + Supabase + Cloudflare R2 + Firebase Auth)

**Nothing in this runbook has been run.** Every step that creates a resource, sets a secret or deploys needs the owner's approval. The old Google AI Studio app and its Cloud SQL database are **not** part of this deployment: don't connect to, migrate, change or delete them.

Related docs: [STORAGE.md](STORAGE.md) (R2 bucket), [WORKERS.md](WORKERS.md) (scheduler), [BACKUPS.md](BACKUPS.md) (backups, restore, deletion ledger), [COSTS.md](COSTS.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (final test plan), [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md), [LAUNCH_PUBLIC.md](LAUNCH_PUBLIC.md). The overall migration report is [MIGRATION_REPORT.md](MIGRATION_REPORT.md).

## Target architecture

| Piece | Service | Notes |
| --- | --- | --- |
| Web app, API routes, Slate streaming, public site | **Vercel** (Next.js, Node.js runtime, Fluid compute) | One project. Region pinned in `vercel.json` (`iad1`, Washington D.C.) to sit next to the database. |
| Database | **Supabase** Postgres, used through Drizzle + node-postgres | Runtime: transaction pooler (6543). Migrations: session pooler (5432) or direct. |
| Creator media + deletion ledger | **Cloudflare R2**, private bucket | Browser ↔ R2 directly via short-lived signed URLs; the app never relays video bytes. |
| Sign-in | **Firebase Authentication** (Google) | Unchanged. Admin credential via env on Vercel. |
| Slate | OpenAI GPT-6.1 Sol → Anthropic Claude Opus 5.5 fallback | Unchanged. |
| Scheduled jobs | **Cloudflare Worker** cron (`ops/scheduler`) | Deletions every 5 min, maintenance daily, separate secrets. |
| Database backups | **GitHub Actions** → encrypted dump → private R2 backups bucket | `.github/workflows/db-backup.yml`. |

## Plan limits that shape this design

| Limit | Effect | How it's handled |
| --- | --- | --- |
| Vercel Hobby is personal, non-commercial use only | A commercial Backlot needs Vercel Pro (or written confirmation from Vercel) | **Owner decision before public launch.** Don't work around it. |
| Vercel function request/response body ≈ 4.5 MB | Video uploads and downloads can't go through functions | Direct multipart uploads to R2, signed-URL reads. The legacy 2 MB chunk route is used only with the local store. |
| Vercel function max duration (300 s assumed for Hobby with Fluid compute; **verify in the dashboard**) | Long Slate replies and job runs must stop in time | Per route, by need: chat 300 s (Slate deadlines default to 60–90 s and can be raised to 300 s), deletion worker 120 s (stops taking jobs after 90 s, resumes on the next 5-minute call), daily maintenance 180 s (bounded batches), upload completion 60 s. All within the 300 s Hobby maximum. |
| Vercel Hobby cron: once a day, one shared `CRON_SECRET`, GET | Can't run the 5-minute deletion worker or give each job its own credential | External scheduler: Cloudflare Worker cron (WORKERS.md). |
| Vercel Hobby runtime logs are kept briefly | Log-based alerts and audit trails don't survive | The deletion ledger lives in R2, not in logs. Alerts need a log drain (paid) or the scheduler's own checks. |
| Supabase Free: 500 MB database, pauses after ~7 days of low activity, no downloadable backups | Outages after quiet weeks; no restore path by default | Graceful 503s, Slate fails closed; growth alerts (COSTS.md); our own encrypted backups (BACKUPS.md). Don't generate fake traffic to stop pausing; upgrade if that's unacceptable. |
| R2 Free: 10 GB-month storage | 1 GB per creator fills it at ~10 creators | Beta limits: 1 GB/creator, app-wide warning at 8 GB, hard ceiling at 9.5 GB. |

## Setup runbook (each step needs approval)

This is the summary. The exact click-by-click procedure, billing notes, staging layout and secret locations are in [INFRA_SETUP.md](INFRA_SETUP.md). Step 4 is followed by `ops/supabase/roles.sql` (limited runtime role, Data API access removed).

Don't start a step until the previous step's check passes.

| # | Step | Check |
| --- | --- | --- |
| 1 | **Decide the plan question.** Personal/private beta on Vercel Hobby, or commercial (Vercel Pro). Record the answer in MIGRATION_REPORT.md "Owner decisions". | Decision written down. |
| 2 | **Confirm the Firebase project.** `firebase-applet-config.json` points at `gen-lang-client-0425820524`, which was created by Google AI Studio. Confirm it's owned by the Google account you intend to run Backlot with (Firebase console → Project settings → Users and permissions). If not, create a new Firebase project, enable Google sign-in, and replace the public config in that file. | Owner listed on the project. |
| 3 | **Create the Supabase project** (Free) in **US East (N. Virginia)** to match Vercel `iad1`, or pick another region and change `vercel.json` `regions` to the closest Vercel region. Save the database password in a password manager. Download the CA certificate (Database → Settings → SSL configuration). | Project is up; region noted in MIGRATION_REPORT.md. |
| 4 | **Apply migrations.** Locally, with `DATABASE_MIGRATION_URL` = session pooler URL and `DATABASE_CA_CERT` set: `npm run db:migrate` (dry run, expect 8 pending), then `npm run db:migrate -- --apply`. | The run ends with `Account write guard triggers: 13 (expected 13)`. A second dry run shows 0 pending. |
| 5 | **Create the R2 media bucket** with CORS and lifecycle as in STORAGE.md "Bucket setup", and a bucket-scoped API token. Create the separate **backups** bucket and its own token (BACKUPS.md). | Bucket is private (no r2.dev, no public domain); CORS shows only your origins. |
| 6 | **Create the Firebase Admin service account key** for account deletion: Google Cloud console for the Firebase project → IAM → service account with only **Firebase Authentication Admin** → JSON key. Store it only in Vercel (`FIREBASE_SERVICE_ACCOUNT_JSON`) and your password manager. | Key created; nowhere else. |
| 7 | **Create the Vercel project** from the GitHub repo (framework: Next.js, root: repo root). Add the environment variables in the table below (Production; Preview only where marked). Generate the two job secrets with `openssl rand -base64 48` (different values). | `vercel env ls` lists every required variable. |
| 8 | **Deploy a Preview** and open `https://<preview>/api/health?ready=1`. | 200 `{ status: "ok" }`, and the logs show `config.ok`. A config error shows `config.refusing_to_start` and the failing setting names. |
| 9 | **Firebase authorized domains**: add the Vercel production domain (and the custom domain, when ready) under Authentication → Settings → Authorized domains. Add preview domains only for testing, then remove them. | Google sign-in works on that domain. |
| 10 | **Run the final verification** (RELEASE_CHECKLIST.md) against staging with test accounts. | All items pass or have a recorded decision. |
| 11 | **Promote to production** (`vercel promote` or the dashboard). Set `SITE_URL` to the production origin. | Readiness is 200 on the production URL. |
| 12 | **Deploy the scheduler Worker** (WORKERS.md) with `BACKLOT_ORIGIN` = production origin and the same two secrets. | Worker logs show `/api/internal/account-deletions` → 200 every 5 minutes, and the daily cleanup → 200. |
| 13 | **Enable backups**: push `.github/workflows/db-backup.yml`, add its secrets, run it once manually, then do a restore test (BACKUPS.md). | `db/latest.json` in the backups bucket is updated; restore test recorded. |
| 14 | **Alerts and spend limits** (COSTS.md): OpenAI and Anthropic budgets, Cloudflare billing notifications, Supabase usage emails. | Each one set. |

## Environment variables

Scope: **P** = Production, **Pv** = Preview, **L** = local `.env.local`. "Secret" means: mark it *Sensitive* in Vercel; never `NEXT_PUBLIC_`.

| Variable | Scope | Secret | Purpose |
| --- | --- | --- | --- |
| `SITE_URL` | P | | Canonical origin (sitemap, robots, OG, llms.txt) |
| `PRIVACY_CONTACT_EMAIL` | P, Pv | | Contact on legal pages (required in production) |
| `DATABASE_URL` | P, Pv, L | yes | Supabase transaction pooler URL (port 6543) as the limited `backlot_app` role (ops/supabase/roles.sql). Use a **separate Supabase project for Preview** testing, never production data. |
| `DATABASE_CA_CERT` | P, Pv, L | | Supabase CA (PEM) for verified TLS |
| `DATABASE_MIGRATION_URL` | L only | yes | Session pooler/direct URL for `db:migrate` and restore scripts |
| `DB_POOL_MAX` | optional | | Connections per instance (default 5 on Vercel) |
| `STORAGE_BACKEND` | P, Pv | | `r2` |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | P, Pv | | Bucket (use a separate test bucket for Preview) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | P, Pv | yes | Bucket-scoped token, Object Read & Write |
| `R2_ENDPOINT`, `R2_PREFIX`, `R2_LEDGER_PREFIX`, `R2_LEDGER_BUCKET` | optional | | See .env.example |
| `NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB`, `NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB` | optional (build-time) | | Per-file limits (30 / 500) |
| `STORAGE_QUOTA_GB`, `UPLOAD_MAX_CONCURRENT`, `STORAGE_APP_WARN_GB`, `STORAGE_APP_CEILING_GB` | optional | | Beta limits (1 / 2 / 8 / 9.5) |
| `FILE_URL_TTL_SEC`, `UPLOAD_PART_URL_TTL_SEC`, `STORAGE_DELIVERY`, `STORAGE_ORPHAN_SWEEP`, `STORAGE_ORPHAN_MIN_AGE_DAYS` | optional | | Storage tuning |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | P, Pv | yes | Firebase Admin (revoke + delete sign-in) |
| `NEXT_PUBLIC_FIREBASE_CONFIG` | Pv (staging) | | Build-time override of firebase-applet-config.json, so staging signs in to its own Firebase project |
| `FIREBASE_PROJECT_ID` | optional | | Override the server's project id (must match the browser's project) |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | P, Pv | yes | Slate providers |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `SLATE_*` | optional | | Slate tuning (README "Slate") |
| `DELETION_WORKER_SECRET` | P | yes | Deletion job credential (also in the Worker) |
| `MAINTENANCE_SECRET` | P | yes | Maintenance job credential (also in the Worker) |
| `SLATE_ACTION_RETENTION_DAYS`, `SLATE_AUDIT_RETENTION_DAYS`, `ACCOUNT_DELETION_RECORD_DAYS`, `LEDGER_RETENTION_DAYS` | optional | | Retention (30 / 180 / 30 / 90) |
| `UPLOAD_SESSION_KEY` | optional | yes | Seals upload ids at rest (required only with legacy GCS) |
| `BACKLOT_SKIP_CONFIG_CHECK` | emergency only | | Logged as CRITICAL |

Not needed any more on Vercel: `SQL_*` (local only), `GCS_*`, `INTERNAL_OIDC_AUDIENCE` and the `*_INVOKER` variables (Cloud Scheduler), `APP_URL`, `DISABLE_HMR` (AI Studio).

The GitHub Actions backup secrets (`BACKUP_*`) and the Worker secrets live in GitHub and Cloudflare respectively, not in Vercel.

`checkProductionConfig` (src/lib/config-check.ts) runs at startup and on `/api/health?ready=1`. It names missing or invalid settings, never their values.

## Database migrations

- Production schema changes are **only** `npm run db:migrate` (scripts/db-migrate.ts → src/db/migrate.ts). It applies `src/db/migrations/*.sql` in name order, each in its own transaction, records each file's SHA-256 in `backlot_schema_migrations`, and **refuses to run** if an applied file was edited or removed. Never edit an applied file: add a new one.
- Files: `2026-11-16_baseline.sql` (new: the five core tables, which were previously only ever created by `db:push`) and the seven feature migrations `2026-11-17_…` through `2026-11-23_…`, unchanged.
- `npm run db:push` is for a disposable local database only. `drizzle.config.ts` refuses to run with `NODE_ENV=production` or on Vercel. It doesn't install the account write guard.
- `npm test` includes `src/db/migrations.test.ts`: it builds a fresh database from the files alone and checks it matches `src/db/schema.ts` and has all 13 guard triggers.
- To write to a locked account's rows (a backfill or restore), use one transaction with `SET LOCAL backlot.account_guard = 'off'` (ACCOUNT_DELETION.md, "Write guard"). This works through either pooler because it's transaction-scoped.

### Why the transaction pooler is safe for Backlot

Every lock and setting the app uses is transaction-scoped: `pg_advisory_xact_lock` (upload reservations, the Slate limiter), `SELECT … FOR UPDATE SKIP LOCKED` (deletion jobs, cleanup), `SET LOCAL`. Nothing uses session advisory locks, `LISTEN/NOTIFY`, temp tables or named prepared statements (node-postgres sends unnamed ones). The only session lock is the migration runner's, which is why migrations use the session pooler. **Verify** under load in the final test (RELEASE_CHECKLIST.md, "Database").

## Deployment and rollback

- **Deploys:** every push to the production branch builds a Vercel deployment. Test on the Preview URL (step 8) before promoting. Migrations go first, and must stay additive so that the previous deployment keeps working on the new schema.
- **Code rollback:** Vercel → Deployments → previous deployment → *Instant Rollback* (or `vercel rollback`). All migrations are additive, so older code runs on the newer schema.
- **Config rollback:** fix the variable and redeploy. Vercel applies env changes only to new deployments.
- **Scheduler:** pause it by removing the cron triggers (`wrangler triggers` / dashboard) or by unsetting the secret in Vercel (the job route then returns 404). Every job is idempotent and safe to resume.
- **Database:** a schema rollback is the commented SQL at the end of each file. Only use it when no deletion is in progress, because a deletion row is what keeps an account locked. For data damage, restore into a **new** Supabase project (BACKUPS.md, "Restore").
- **Storage:** nothing is moved or deleted by deploying. The orphan sweep is the only bulk deleter. It refuses to delete when most of the objects look orphaned, and `STORAGE_ORPHAN_SWEEP=off` disables it.

## Moving from the Cloud Run setup

There's no production data to move unless the owner says otherwise. This local Backlot project has never served real creators from the AI Studio deployment. If data does need to come across later, that's a separate, approved task: export, then `pg_restore` into the new Supabase project, then `db:migrate`; copy objects from GCS to R2 with the same keys under `uploads/`. Neither step has been written or run.

## Earlier milestone notes (versions, actions, shared limits)

The Slate Milestone 3–5 and Launch L1–L2 schema notes still describe what each feature migration does:

- Versions are `integer not null default 1`, metadata-only.
- `BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL` is a dated rollout flag.
- Shared limits: 30 requests per 10 minutes, 2 at a time, and `SLATE_DAILY_MESSAGE_LIMIT` (default 200) per rolling 24 hours, with 150 s leases.
- If the database is unreachable (including a paused Supabase project), Slate fails closed with a 503 and logs `slate.limits_unavailable`.
