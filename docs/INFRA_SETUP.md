# Infrastructure setup: staging first, then production

**Nothing in this guide has been done.** It's the exact procedure for the owner to follow, or to authorize step by step. Every step marked **[confirm]** creates a resource, adds billing details, stores a secret or deploys, so the owner confirms it at the time it's done. Approval of this document is not approval of the steps.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) (env inventory, migrations, rollback), [STORAGE.md](STORAGE.md) (R2 CORS JSON), [WORKERS.md](WORKERS.md) (scheduler), [BACKUPS.md](BACKUPS.md) (backups, key custody, restore), [COSTS.md](COSTS.md) (allowances), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (final verification).

## Owner decisions this guide follows (2026-11-18)

| Decision | Value |
| --- | --- |
| Use | Personal, noncommercial, limited-access private beta. A commercial launch means moving off Vercel Hobby first. |
| Hosting | Vercel Hobby, region `iad1` (Washington, D.C.) |
| Database | Supabase Free. **Production reuses the existing project `content-vault`** (East US, Ohio, `us-east-2`; decision 2026-11-19). Staging is a separate, disposable `backlot-staging` project in the same region. Vercel stays `iad1` until staging measures the latency. |
| Media | Private Cloudflare R2 bucket |
| Authentication | Firebase Authentication with Google sign-in, in a **dedicated Backlot Firebase project** (if the check in §2 finds no real users in the old project) |
| Slate | OpenAI GPT-6.1 Sol primary, Claude Opus 5.5 fallback. No other providers. |
| Supabase pausing | Accepted during the private beta (see the note in §4) |
| Backup decryption key | Held by the owner only |
| Legal review | Required before any public launch |

## 1. Billing: what needs payment details and what can charge

Free allowances are **not** spending caps. "Can charge" means usage beyond an allowance turns into a bill unless something stops it.

| Service | Needs billing details? | Can it charge? | What stops or limits a bill |
| --- | --- | --- | --- |
| Vercel Hobby | No | No overage billing on Hobby; over-limit usage is paused instead (verify the current Hobby terms) | Plan limits. **Hobby is personal, non-commercial use only.** |
| Supabase Free | No | No | Free-plan limits (500 MB database, 2 active projects per organization); the project pauses after low activity |
| Cloudflare R2 | **Yes.** Enabling R2 goes through a checkout that adds a payment method, even to use only the free allowance | **Yes**, beyond 10 GB-month storage and the Class A/B operation allowances (egress is free) | No hard cap. Backlot's own limits (1 GB per creator, 9.5 GB app ceiling) plus Cloudflare billing notifications |
| Cloudflare Workers (scheduler) | No, on the Free plan | No, on the Free plan. Don't upgrade to Workers Paid; ~290 calls a day is far within Free | Free plan request limits |
| Firebase Authentication (Spark plan) | No | No for Google sign-in on Spark. Upgrading to Blaze or to Identity Platform adds usage billing; neither is needed | Stay on Spark; decline upgrade prompts |
| Google Cloud (service-account key for Firebase Admin) | No | No | Creating a service account and key doesn't need billing |
| GitHub Actions (backups) | No for a private repository within the free minutes | Only if the account's Actions spending limit is above $0 | The nightly job uses about 2–3 minutes a day. Keep the spending limit at $0 |
| OpenAI API | **Yes** (prepaid credits or billing) | **Yes**, per token | Project budget and usage limits in the OpenAI dashboard, plus Backlot's per-creator Slate limits |
| Anthropic API | **Yes** | **Yes**, per token (only on fallback) | Workspace spend limit in the Anthropic Console |
| Domain name | **Yes** (registrar) | Yearly renewal | Registrar auto-renew settings |

## 2. Firebase: identity decision

**What was checked.** Nothing in this repository records a production Firebase user. The repository has no export of user records, and no code or script reads the old AI Studio database. As instructed, that database was not accessed. The Firebase project in `firebase-applet-config.json` (`gen-lang-client-0425820524`) was created by AI Studio, and this machine's `gcloud` account can't read it (docs/OPERATIONS.md, discovery).

So whether real people already depend on it can't be determined from here. The owner checks two things, both read-only:

1. **Firebase console** → project `gen-lang-client-0425820524` → **Authentication → Users**. Is there anyone other than the owner and test accounts?
2. **Whether the old AI Studio app is in use by anyone.** Its data lives in its own database, which stays untouched.

**Decision rule:**

| Result | Action |
| --- | --- |
| **No real users** (expected) | Create a **dedicated Backlot Firebase project** (below). Nothing migrates. The old project and the AI Studio app are left as they are. |
| **Real users exist** | Stop before changing projects. In a new Firebase project each person signing in gets a **new uid**, and Backlot keys all their data by uid, so their content would no longer be theirs. Keeping uids requires exporting users from the old project and importing them into the new one (`firebase auth:export` / `auth:import`). That's an identity migration needing its own approval, plus access to the old project, which this machine doesn't have. The alternative is to keep the old project once the owner has confirmed they own it. Don't create or delete any accounts until that's decided. |

### Dedicated Firebase projects [confirm]

Create **two** projects: `backlot` (production) and `backlot-staging` (disposable). Staging must have its own project, because deleting a staging account deletes its Firebase user. With a shared project, a staging test could delete a real person's production sign-in.

For each project:

1. [Firebase console](https://console.firebase.google.com) → **Add project**. Google Analytics: **off** (Backlot doesn't use it, and the privacy page doesn't cover it). Plan: **Spark**.
2. **Authentication → Get started → Sign-in method → Google → Enable.** Set the public-facing name to "Backlot" and the support email to the owner's address.
3. **Authentication → Settings → Authorized domains:** add the domains that will host sign-in (production: the custom domain and `<project>.vercel.app`; staging: the staging branch domain, §5). Remove anything else except `localhost`, which only the staging project keeps, for local development.
4. **Google Cloud console** for the same project → **APIs & Services → OAuth consent screen (Google Auth Platform → Branding):** app name "Backlot", support email, privacy and terms URLs (`/privacy`, `/terms`), authorized domain. Without this, Google's sign-in screen shows the raw project id.
5. **Project settings → General → Your apps → Add app → Web.** Copy the config (`apiKey`, `authDomain`, `projectId`, `appId`, `messagingSenderId`, `storageBucket`). These values are public by design.
   - **Production:** replace the values in `firebase-applet-config.json` (a code change the owner commits). The default build then signs in to `backlot`.
   - **Staging:** don't edit the file. Set the same JSON as one line in the Vercel variable `NEXT_PUBLIC_FIREBASE_CONFIG`, scoped to the staging branch (§3.4). It's a build-time value: redeploy after changing it.
6. **Admin credential** (account deletion revokes sessions and deletes the sign-in): Google Cloud console → **IAM & Admin → Service accounts → Create** `backlot-auth-admin`, role **Firebase Authentication Admin** only → **Keys → Add key → JSON**. Put the JSON only into Vercel (`FIREBASE_SERVICE_ACCOUNT_JSON`, marked Sensitive) and the owner's password manager. Delete the downloaded file. If key creation is blocked by an organization policy, use an account outside that organization.
7. Optional hardening: Google Cloud → **APIs & Services → Credentials** → the browser API key → restrict it to HTTP referrers for the app's domains, and to the Identity Toolkit and Token Service APIs.

The startup config check refuses to run when the service account, `FIREBASE_PROJECT_ID` and the browser config point at different projects.

## 3. Setup steps by service

Do **staging first** (§5), run the release checklist against it, then repeat for production. Use separate resources and separate secrets for each. Never reuse a staging secret in production.

### 3.1 Supabase [confirm]

1. [supabase.com](https://supabase.com) → create an organization (Free plan) → **New project**: name `backlot` (or `backlot-staging`), region **East US (North Virginia)**. Generate the database password with the dashboard's generator; save it in the password manager.
2. **Database → Settings → SSL configuration:** download the CA certificate (→ `DATABASE_CA_CERT`), and turn on **Enforce SSL on incoming connections**.
3. **Project Settings → Data API:** **turn the Data API off**. Backlot never uses it (it talks to Postgres directly), and Backlot's tables have no row-level security policies.
4. **Connect** (top bar): copy
   - the **Session pooler** URI (port 5432) → `DATABASE_MIGRATION_URL`, kept in the owner's local `.env.local` only;
   - the **Transaction pooler** host (port 6543), for `DATABASE_URL` below.
5. Migrations: either in the SQL Editor with [`ops/supabase/manual-setup/`](../ops/supabase/manual-setup/README.md) (steps 00–11, including roles and verification; no database password on the owner's machine; chosen 2026-11-19), or from the owner's machine with `npm run db:migrate` (dry run: 8 pending), then `-- --apply`. Both record the same migration history.
6. **SQL editor** (skip if you used manual-setup, whose steps 09–10 do this): run [`ops/supabase/roles.sql`](../ops/supabase/roles.sql) with two generated passwords. It removes the Data API roles' table access, creates the limited runtime role `backlot_app` (data access only; it can't alter the schema or disable the guard triggers), and creates the read-only `backlot_backup` role.
7. `DATABASE_URL` = `postgresql://backlot_app.<project-ref>:<password>@<transaction-pooler-host>:6543/postgres`. Check it locally before putting it in Vercel: `DATABASE_URL=… npm run dev`, then sign in and load the library.
8. **Advisors** (Database → Advisors): the security advisor should show no exposed tables, because the Data API is off.

### 3.1a Existing `content-vault` database (production) [confirm]

`content-vault` already has one Supabase-dashboard migration, `init_content_vault`, with three **empty** tables (`channels`, `items`, `files`: uuid keys, `auth.users` foreign keys, RLS) and a `set_updated_at()` function. That's an earlier design, not Backlot's. Its `channels` table and `channels_user_idx` index share Backlot's names, so the migration runner's preflight refuses to run against it, and nothing is changed. Backlot is **not** rewritten to fit it.

Procedure: rehearse each step on staging first, with the same legacy objects created from the same SQL (`supabase_migrations.schema_migrations` of `content-vault`). Then do it on `content-vault`:

1. **Pre-check (read-only):** the three tables still have 0 rows; no other objects in `public`; no views, other tables' foreign keys or other triggers depend on them. If anything unexpected turns up, stop and report it.
2. **Move aside:** run [`ops/supabase/legacy-init-transition.sql`](../ops/supabase/legacy-init-transition.sql) in the SQL editor. It's one transaction. It re-checks the rows and dependencies and stops without changes if either check fails. Otherwise it moves the tables (with their indexes, constraints, policies and trigger) and the function into the schema `legacy_init`. It deletes nothing, and the Supabase migration history is left as it is.
3. **Migrate:** `npm run db:migrate` (dry run: **8 pending**, no preflight error), then `-- --apply`. Expect `Account write guard triggers: 13`.
4. **Roles:** `ops/supabase/roles.sql`, then its verification queries.
5. **Verify:** the security advisor is clean; `legacy_init` isn't exposed through the Data API.

**Rollback:**
- **Before step 3:** the rollback block at the end of the transition file moves everything back to `public` and drops the then-empty `legacy_init`.
- **After step 3:** only while Backlot's tables are still empty, drop them first (the rollback comment in the baseline migration, plus `backlot_schema_migrations`), then run the same rollback block.
- Both paths are tested in `src/db/migrations.test.ts`.

### 3.2 Cloudflare R2 [confirm: adds a payment method]

1. Cloudflare dashboard → **R2 Object Storage → Purchase/Enable R2** (the checkout adds the payment method; the free allowance still applies).
2. **Create bucket:** `backlot-media` (staging: `backlot-media-staging`). Location hint **Eastern North America**, Standard storage class, no jurisdiction.
3. Bucket → **Settings:**
   - **Public access:** r2.dev subdomain **disabled**, no custom domain.
   - **CORS policy:** the JSON in [STORAGE.md](STORAGE.md) "Bucket setup", with only that environment's origins.
   - **Object lifecycle rules:** "Abort incomplete multipart uploads" after **7 days** (backstop to the app's 2-day sweep). No object-expiration rule on the media bucket.
4. **Create bucket:** `backlot-db-backups` (staging: `backlot-db-backups-staging`). Private, same location. Lifecycle rule: **delete objects after 30 days**.
5. **R2 → Manage API tokens → Create API token**, twice:
   - `backlot-media-rw`: **Object Read & Write**, applied to the media bucket only → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Note the account id → `R2_ACCOUNT_ID`.
   - `backlot-backups-rw`: **Object Read & Write**, the backups bucket only → GitHub secrets (§3.5).
6. **Billing → Notifications:** set a usage/billing notification at a small amount (for example $1). It's an alert, not a cap.

### 3.3 Cloudflare Worker scheduler [confirm]

Account deletion and maintenance don't run until this is deployed (WORKERS.md).

1. In `ops/scheduler/wrangler.toml`, set `BACKLOT_ORIGIN` (production) or `[env.staging.vars] BACKLOT_ORIGIN` (staging) to the exact https origin.
2. From `ops/scheduler/`: `npx wrangler login`, then for production:
   `npx wrangler secret put DELETION_WORKER_SECRET`, `npx wrangler secret put MAINTENANCE_SECRET`, `npx wrangler deploy`.
   For staging, add `--env staging` to each command, plus `npx wrangler secret put VERCEL_PROTECTION_BYPASS --env staging` (§5).
3. Use the same two secret values as that environment's Vercel variables. They must differ from each other and be 32+ characters (`openssl rand -base64 48`).
4. Check that the Worker is on the **Free** plan and shows both Cron Triggers.

### 3.4 Vercel [confirm]

Prerequisite: the code is committed and pushed to a GitHub repository (the owner's commit; the agent doesn't commit). A **private** repository is recommended (BACKUPS.md: workflow logs and the 60-day schedule rule).

1. [vercel.com](https://vercel.com) → Hobby account → **Add New → Project** → import the repository. Framework: Next.js (detected); root: repository root; build command: default (`next build`).
2. **Settings → Functions:** confirm **Fluid compute** is on, the region is `iad1` (from `vercel.json`), and the maximum duration allows 300 s. `vercel.json` asks for chat 300 s, the deletion worker 120 s and maintenance 180 s. A rejected value fails the deployment, which is the signal to adjust.
3. **Settings → General → Node.js version:** the newest LTS offered.
4. **Settings → Environment Variables:** enter the variables from DEPLOYMENT.md "Environment variables", marking secrets **Sensitive**.
   - **Production** environment: production values only.
   - **Preview** environment, **scoped to the branch `staging`**: the staging values, including `NEXT_PUBLIC_FIREBASE_CONFIG`. Don't define production secrets for "all Preview branches".
5. **Settings → Deployment Protection:** keep **Vercel Authentication** on for Preview deployments. For staging scheduling, create a **Protection Bypass for Automation** secret and give it only to the staging Worker (`VERCEL_PROTECTION_BYPASS`).
6. Deploy (staging: push the `staging` branch). Open `/api/health?ready=1`: expect 200 and `config.ok` in the logs.

### 3.5 GitHub Actions backups [confirm]

1. **Key pair** on the owner's machine (BACKUPS.md "Key custody"): `age-keygen -o backlot-backup.key`. Two copies of the private key: password manager plus an offline copy. The printed `age1…` public key is the only part GitHub gets.
2. Repository → **Settings → Secrets and variables → Actions:** `BACKUP_DATABASE_URL` (the **session pooler** URL as `backlot_backup.<ref>`), `BACKUP_AGE_RECIPIENT`, `BACKUP_R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`. For staging, point a manual run at the staging project, or use a fork's secrets, and keep the production secrets separate.
3. The owner must be the person who commits `.github/workflows/db-backup.yml` (GitHub sends scheduled-run failures to whoever last changed its cron line) and must have **Settings → Notifications → Actions** email on.
4. **Actions → db-backup → Run workflow** once. Then do the restore test (RELEASE_CHECKLIST S-BK2). Backups count as operational only after that restore passes.

### 3.6 Slate providers [confirm: paid]

1. OpenAI: a dedicated project for Backlot → API key → `OPENAI_API_KEY`. Set the project's monthly budget and usage limits.
2. Anthropic: a dedicated workspace → API key → `ANTHROPIC_API_KEY`. Set the workspace spend limit.
3. Use separate keys for staging (low budgets) and production.

### 3.7 Domain and DNS [confirm: paid registration]

1. Register the domain (any registrar). If it's on Cloudflare DNS, set the Vercel records to **DNS only** (grey cloud), so Vercel issues and serves the certificate.
2. Vercel → Project → **Settings → Domains → Add** the apex and `www`. Create exactly the records Vercel shows (typically an `A` record for the apex and a `CNAME` for `www`). Choose one canonical host and redirect the other to it.
3. Once the certificate is valid, update everything that names the origin:

   | Where | Value |
   | --- | --- |
   | Vercel `SITE_URL` (Production) | `https://<domain>` |
   | Firebase `backlot` → Authorized domains | add `<domain>` |
   | Google OAuth consent screen → Authorized domains | add `<domain>` |
   | R2 `backlot-media` CORS `AllowedOrigins` | add `https://<domain>` |
   | Worker `BACKLOT_ORIGIN` | `https://<domain>`, then `npx wrangler deploy` |

   Redeploy production after changing `SITE_URL`.

## 4. Supabase pausing and the deletion job

Supabase pauses a Free project when **database activity** has been low for 7 days, and only the owner can resume it (dashboard → project → Resume). While it's paused, Backlot's API returns 503 everywhere. A deletion request can't be accepted: the creator sees "Couldn't start deleting your account. Nothing was deleted." A deletion that was already accepted stays locked and waiting, and the status page says progress can't be checked and that deletion continues automatically.

The deletion scheduler queries the database every 5 minutes (about 2,000 small queries a week). Supabase says a few requests a day typically prevent pausing, so in practice **the scheduler will probably keep the project from pausing**. That traffic is the deletion job doing its real work, not traffic added to avoid pausing, and nothing more should be added for that purpose. Don't rely on it either way: Supabase doesn't guarantee it, and the owner's decision to accept pausing stands. If the project does pause, resume it from the dashboard; queued deletions then complete within one or two scheduler runs.

## 5. Disposable staging environment

Purpose: run the full release checklist against **real** Vercel, Supabase, R2 and Firebase, with **synthetic** data only, then throw it away.

| Piece | Staging | Production |
| --- | --- | --- |
| Code | Git branch `staging` → Vercel Preview (protected) at its stable branch URL `https://<project>-git-staging-<scope>.vercel.app` | `main` → Vercel Production |
| Vercel variables | Preview, scoped to branch `staging` | Production |
| Database | Supabase project `backlot-staging` (same region) | `backlot` |
| Media and backups | `backlot-media-staging`, `backlot-db-backups-staging`, their own tokens | `backlot-media`, `backlot-db-backups` |
| Identity | Firebase project `backlot-staging` (`NEXT_PUBLIC_FIREBASE_CONFIG`) and its own service account | Firebase project `backlot` (`firebase-applet-config.json`) |
| Scheduler | `backlot-scheduler-staging` (`--env staging`), with `VERCEL_PROTECTION_BYPASS` | `backlot-scheduler` |
| Slate keys | Separate low-budget keys | Production keys |
| Accounts | Dedicated test Google accounts (A, B, C), never anyone's real account | Real creators |
| Data | Synthetic only: made-up posts and ideas, generated test images, a public-domain or self-made test video | Real |

**Supabase project limit:** the Free plan allows **two active projects** per organization. Staging plus production uses both, so the restore drill (S-BK2) needs a third. Restore into the staging project after a `--clean` reset, or pause or delete staging first. Don't restore over production.

**Teardown after sign-off:** `npx wrangler delete --env staging`; delete the staging Vercel variables and the `staging` branch deployments; delete the staging Supabase project; empty and delete both staging buckets and revoke their tokens; delete the staging Firebase service-account key (and the project, if no further testing is planned); revoke the staging Slate keys; delete the test Google accounts' Backlot data through the app's account deletion first.

## 6. Secrets: where each one lives

| Secret | Lives in | Never in |
| --- | --- | --- |
| `DATABASE_URL` (as `backlot_app`) | Vercel (Sensitive) | Git, the browser |
| `DATABASE_MIGRATION_URL` (postgres) | Owner's `.env.local`, password manager | Vercel, GitHub |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (media) | Vercel | GitHub, Worker |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Vercel, password manager | Git, local disk after setup |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Vercel | Git |
| `DELETION_WORKER_SECRET`, `MAINTENANCE_SECRET` | Vercel and the Worker (same values, per environment) | Git |
| `VERCEL_PROTECTION_BYPASS` | Staging Worker only | Production |
| `BACKUP_*` (backup role, R2 backups token, age **public** key) | GitHub Actions secrets | Vercel |
| age **private** key | Owner's password manager plus one offline copy | GitHub, Vercel, Supabase, Cloudflare, the backups bucket |
| Supabase `postgres` password | Password manager | Anywhere the app runs |

Nothing secret uses a `NEXT_PUBLIC_` name. `NEXT_PUBLIC_FIREBASE_CONFIG` holds only the public web config.
