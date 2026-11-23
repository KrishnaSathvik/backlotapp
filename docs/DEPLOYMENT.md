# Deploying Backlot (Vercel + Supabase + Cloudflare R2)

**Nothing in this runbook has been run.** Every step that creates a resource, sets a secret or deploys needs the owner's approval. The old Google AI Studio app and its Cloud SQL database are **not** part of this deployment: don't connect to, migrate, change or delete them.

Related docs: [STORAGE.md](STORAGE.md) (R2 bucket), [WORKERS.md](WORKERS.md) (scheduler), [BACKUPS.md](BACKUPS.md) (backups, restore, deletion ledger), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (final test plan), [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md), [LAUNCH_PUBLIC.md](LAUNCH_PUBLIC.md).

## Target architecture

| Piece | Service | Notes |
| --- | --- | --- |
| Web app, API routes, Slate streaming, public site | **Vercel** (Next.js, Node.js runtime, Fluid compute) | One project. Region pinned in `vercel.json` (`iad1`, Washington D.C.) to sit next to the database. |
| Database | **Supabase** Postgres, used through Drizzle + node-postgres | Runtime: transaction pooler (6543). Migrations: session pooler (5432) or direct. |
| Creator media + deletion ledger | **Cloudflare R2**, private bucket | Browser ↔ R2 directly via short-lived signed URLs; the app never relays video bytes. |
| Sign-in | **Supabase Authentication** (Google, and email + password), same `backlot` project | Replaced Firebase on 2026-11-20. Session cookies via `@supabase/ssr`; the server verifies every request. Admin key (account deletion) via env on Vercel. |
| Slate | OpenAI GPT-6.1 Sol → Anthropic Claude Opus 5.5 fallback | Unchanged. |
| Account deletion | Starts right after the request (Next.js `after()`); **Vercel Cron** runs recovery hourly | `vercel.json` `crons`, authenticated with `CRON_SECRET`. Maintenance has no schedule. |
| Database backups | **None** (owner decision) | `.github/workflows/db-backup.yml` is manual-only and not configured. Data recovery isn't guaranteed (BACKUPS.md). |

## Plan limits that shape this design

| Limit | Effect | How it's handled |
| --- | --- | --- |
| Plan: **Vercel Pro** (owner confirmed 2026-11-20) | Commercial use allowed; usage beyond the included amounts is billed | Set Spend Management before launch. |
| Vercel function request/response body ≈ 4.5 MB | Video uploads and downloads can't go through functions | Direct multipart uploads to R2, signed-URL reads. The legacy 2 MB chunk route is used only with the local store. |
| Vercel function max duration (Pro with Fluid compute allows well above 300 s; **verify in the dashboard**) | Long Slate replies and job runs must stop in time | Per route, by need: chat 300 s (Slate deadlines default to 60–90 s and can be raised to 300 s), deletion request 300 s (3-minute grace period + one bounded run), deletion recovery 120 s (stops taking jobs after 90 s, resumes on the next hourly run), daily maintenance 180 s (bounded batches), upload completion 60 s. All well within Vercel Pro limits. |
| Vercel Cron: one shared `CRON_SECRET`, sent as a GET bearer header | Can't give each job its own credential | Only the deletion recovery run is scheduled, so only it accepts `CRON_SECRET` (WORKERS.md). |
| Vercel runtime logs have limited retention (verify Pro's current retention) | Log-based alerts and audit trails don't survive long | The deletion ledger lives in R2, not in logs. Pro supports log drains for longer retention and alerts. |
| Supabase Free: 500 MB database, pauses after ~7 days of low activity, no downloadable backups | Outages after quiet weeks; no restore path by default | Graceful 503s, Slate fails closed; growth alerts. No backups (owner decision, BACKUPS.md). Don't generate fake traffic to stop pausing; upgrade if that's unacceptable. |
| R2 Free: 10 GB-month storage | 1 GB per creator fills it at ~10 creators | Beta limits: 1 GB/creator, app-wide warning at 8 GB, hard ceiling at 9.5 GB. |

## Setup runbook (each step needs approval)

This is the summary. The exact click-by-click procedure, billing notes, staging layout and secret locations are in [INFRA_SETUP.md](INFRA_SETUP.md). Step 4 is followed by `ops/supabase/roles.sql` (limited runtime role, Data API access removed).

Don't start a step until the previous step's check passes.

| # | Step | Check |
| --- | --- | --- |
| 1 | **Plan:** Vercel Pro (decided 2026-11-20). Configure Spend Management. | Spend limit set. |
| 2 | **Sign-in (Supabase Auth):** in `backlot`, Google provider enabled (done 2026-11-20); Authentication → URL Configuration: Site URL and Redirect URLs (INFRA_SETUP.md §2). | Google sign-in returns to the app. |
| 3 | **Create the Supabase project** (Free) in **US East (N. Virginia)** to match Vercel `iad1`, or pick another region and change `vercel.json` `regions` to the closest Vercel region. Save the database password in a password manager. Download the CA certificate (Database → Settings → SSL configuration). | Project is up. |
| 4 | **Apply migrations.** Locally, with `DATABASE_MIGRATION_URL` = session pooler URL and `DATABASE_CA_CERT` set: `npm run db:migrate` (dry run, expect 8 pending), then `npm run db:migrate -- --apply`. | The run ends with `Account write guard triggers: 13 (expected 13)`. A second dry run shows 0 pending. |
| 5 | **Create the R2 media bucket** with CORS and lifecycle as in STORAGE.md "Bucket setup", and a bucket-scoped API token. Create the separate **backups** bucket and its own token (BACKUPS.md). | Bucket is private (no r2.dev, no public domain); CORS shows only your origins. |
| 6 | **Supabase secret key** for account deletion: Project Settings → API Keys → Secret keys. Store it only in Vercel (`SUPABASE_SECRET_KEY`, Sensitive) and your password manager. | Key set; nowhere else. |
| 7 | **Create the Vercel project** from the GitHub repo (framework: Next.js, root: repo root). Add the environment variables in the table below (Production; Preview only where marked). Generate `CRON_SECRET` with `openssl rand -base64 48`. | `vercel env ls` lists every required variable. |
| 8 | **Deploy a Preview** and open `https://<preview>/api/health?ready=1`. | 200 `{ status: "ok" }`, and the logs show `config.ok`. A config error shows `config.refusing_to_start` and the failing setting names. |
| 9 | **Supabase redirect URLs**: add the Vercel production domain (and the custom domain, when ready) as `https://<domain>/**` under Authentication → URL Configuration. Add preview domains only for testing, then remove them. | Google sign-in works on that domain. |
| 10 | **Run the final verification** (RELEASE_CHECKLIST.md) against staging with test accounts. | All items pass or have a recorded decision. |
| 11 | **Promote to production** (`vercel promote` or the dashboard). Set `SITE_URL` to the production origin. | Readiness is 200 on the production URL. |
| 12 | **Check the deletion cron**: Vercel → Settings → Cron Jobs lists `/api/internal/account-deletions` hourly (from `vercel.json`). | The next run's log shows 200 (WORKERS.md). |
| 13 | **Alerts and spend limits**: OpenAI and Anthropic budgets, Cloudflare billing notifications, Supabase usage emails. | Each one set. |

## Account deletion processing

A deletion request locks the account at once. The job then starts right after the response (Next.js `after()` in `POST /api/account/deletion`: it waits out the 3-minute grace period and runs within that function's 300 s limit). That start is best effort. Vercel Cron calls `GET /api/internal/account-deletions` every hour (`vercel.json`) and resumes any job that was cut short or is due for a retry. All progress is in `account_deletions`, so nothing depends on a function finishing. Details: WORKERS.md, ACCOUNT_DELETION.md.

The daily maintenance job (`/api/internal/cleanup`: expired suggestions, retention, abandoned uploads, orphan sweep) has no schedule. It can be run by hand with `MAINTENANCE_SECRET`. The R2 lifecycle rule (abort incomplete multipart uploads after 7 days) is the backstop for abandoned uploads.

## Environment variables

### Vercel Pro environment checklist

Derived from the code's production config check (`src/lib/config-check.ts`), 2026-11-20. Set these in Vercel → Project → Settings → Environment Variables, scope **Production**. Mark every secret **Sensitive**. `NEXT_PUBLIC_*` values are inlined into the browser at **build** time, so set them before the first build and redeploy after changing them.

**Required: without any one of these, a production deployment refuses to start** (`config.refusing_to_start`).

| Variable | Value | Secret? |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://backlot_app.pdhymiqjlzaanarleucv:<backlot_app password>@aws-1-us-east-2.pooler.supabase.com:6543/postgres` (transaction pooler, **`backlot_app`**, never `postgres`) | yes |
| `DATABASE_CA_CERT` | Supabase root CA (`prod-ca-2021.crt`), PEM; one line with `\n` is accepted | no (public), but keep it with the DB settings |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://pdhymiqjlzaanarleucv.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | no (public by design) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` (account deletion: revoke and delete the Auth user). Never `NEXT_PUBLIC_` | **yes** |
| `STORAGE_BACKEND` | `r2` | no |
| `R2_ACCOUNT_ID` | Cloudflare account id | no |
| `R2_BUCKET` | `backlot-media` | no |
| `R2_ACCESS_KEY_ID` | Bucket-scoped token (Object Read & Write) | **yes** |
| `R2_SECRET_ACCESS_KEY` | Same token | **yes** |
| `OPENAI_API_KEY` | Slate primary | **yes** |
| `CRON_SECRET` | 32+ random characters (`openssl rand -base64 48`). Vercel Cron sends it to the hourly deletion recovery run | **yes** |
| `PRIVACY_CONTACT_EMAIL` | Shown on `/privacy` | no |

**Recommended: the app runs without these, but works worse.**

| Variable | Without it |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | `843813897401-o1cit9981k5j7kuvpa28rurdc26vo80n.apps.googleusercontent.com`. Without it, Google sign-in falls back to the redirect flow ("continue to pdhymiqjlzaanarleucv.supabase.co"). Add the production origin to the OAuth client's JavaScript origins. |
| `ANTHROPIC_API_KEY` | No Claude fallback: Slate fails when OpenAI does. |
| `SITE_URL` | `https://<domain>`. No canonical URLs, an empty sitemap, no social preview image. |

**Optional tuning: defaults are the beta's settings; set only to change them.**

| Variable | Default |
| --- | --- |
| `R2_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` (set only for an EU bucket; harmless if it equals the default) |
| `R2_PREFIX`, `R2_LEDGER_PREFIX`, `R2_LEDGER_BUCKET` | `uploads/`, `ledger/account-deletions/`, same bucket |
| `FILE_URL_TTL_SEC`, `STORAGE_DELIVERY` | 300 s signed reads; redirect (not `proxy`) |
| `STORAGE_QUOTA_GB`, `UPLOAD_MAX_CONCURRENT`, `STORAGE_APP_WARN_GB`, `STORAGE_APP_CEILING_GB` | 1, 2, 8, 9.5 (beta limits; change only with approval) |
| `NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB`, `NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB` | 30, 500 (beta limits; change only with approval) |
| `STORAGE_SOFT_DELETE_DAYS` | 0 (must stay 0 for R2) |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL` | `gpt-6.1-sol`, `claude-opus-5-5` |
| `SLATE_ENABLE_FALLBACK`, `SLATE_ALLOW_FALLBACK_ONLY`, `SLATE_SEMANTIC_SEARCH`, `SLATE_IMAGE_ANALYSIS`, `SLATE_EMBEDDING_MODEL`, `SLATE_PRICE_*` | see `.env.example` |
| `DB_POOL_MAX`, `DB_CONNECT_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` | 5, 15000, 10000 on Vercel |
| `ROBOTS_DISALLOW_AI_TRAINING` | see `.env.example` |

**Never set in Vercel:**

| Variable | Why |
| --- | --- |
| `DATABASE_MIGRATION_URL`, Supabase `postgres` password | Admin access; the owner's machine and the SQL Editor only |
| `SQL_*`, `STORAGE_ALLOW_LOCAL`, `GCS_*`, `UPLOAD_SESSION_KEY` | Local development or legacy stores; R2 doesn't need a session key |
| `FIREBASE_*`, `NEXT_PUBLIC_FIREBASE_*` | Firebase was removed |
| `INTERNAL_OIDC_AUDIENCE`, `*_INVOKER`, `CLEANUP_SECRET` | Legacy Google Cloud scheduling; Backlot uses the job secrets |
| `BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL` | Rollout-only flag |
| `VERCEL_PROTECTION_BYPASS` | Belongs only to a staging scheduler (there is none) |
| Google OAuth client secret | Lives only in Supabase's Google provider settings |

### Full inventory


Scope: **P** = Production, **Pv** = Preview, **L** = local `.env.local`. "Secret" means: mark it *Sensitive* in Vercel; never `NEXT_PUBLIC_`.

| Variable | Scope | Secret | Purpose |
| --- | --- | --- | --- |
| `SITE_URL` | P | | Canonical origin (sitemap, robots, OG, llms.txt) |
| `PRIVACY_CONTACT_EMAIL` | P, Pv | | Optional: overrides the default contact `support@getbacklot.app` on public pages |
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
| `NEXT_PUBLIC_SUPABASE_URL` | P, Pv | | Supabase project URL (public; build-time) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | P, Pv | | Publishable key (public; build-time) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | P, Pv | | Google OAuth client id (public; build-time) for Google's own sign-in button. Unset: redirect sign-in |
| `SUPABASE_SECRET_KEY` | P, Pv | yes | Supabase Auth admin (account deletion: revoke + delete sign-in). Server only |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | P, Pv | yes | Slate providers |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `SLATE_*` | optional | | Slate tuning (README "Slate") |
| `CRON_SECRET` | P | yes | Deletion recovery run credential (Vercel Cron) |
| `MAINTENANCE_SECRET` | optional | yes | Only to run the maintenance job by hand; must differ from `CRON_SECRET` |
| `SLATE_ACTION_RETENTION_DAYS`, `SLATE_AUDIT_RETENTION_DAYS`, `ACCOUNT_DELETION_RECORD_DAYS`, `LEDGER_RETENTION_DAYS` | optional | | Retention (30 / 180 / 30 / 90) |
| `UPLOAD_SESSION_KEY` | optional | yes | Seals upload ids at rest (required only with legacy GCS) |
| `BACKLOT_SKIP_CONFIG_CHECK` | emergency only | | Logged as CRITICAL |

Not needed any more on Vercel: `SQL_*` (local only), `GCS_*`, `INTERNAL_OIDC_AUDIENCE` and the `*_INVOKER` variables (Cloud Scheduler), `APP_URL`, `DISABLE_HMR` (AI Studio).

Backups aren't configured, so there are no `BACKUP_*` secrets.

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
- **Deletion cron:** pause it in Vercel → Settings → Cron Jobs, or unset `CRON_SECRET` (the route then returns 404). Jobs are idempotent and safe to resume.
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
