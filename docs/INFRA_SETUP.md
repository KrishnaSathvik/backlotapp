# Infrastructure setup: staging first, then production

This is the exact procedure for the owner to follow, or to authorize step by step. Every step marked **[confirm]** creates a resource, adds billing details, stores a secret or deploys, so the owner confirms it at the time it's done. Approval of this document is not approval of the steps.

## Status (2026-11-20)

**Done (all local; nothing committed, pushed or deployed):**
- **Production database.** The Supabase project formerly named `content-vault` was renamed **`backlot`** (`pdhymiqjlzaanarleucv`, `us-east-2`). Set up in the SQL Editor on 2026-11-20: legacy tables moved into `legacy_init` (§3.1a), all 8 migrations with exact checksums, roles `backlot_app` and `backlot_backup` with passwords, `11_verify_readonly.sql` 33/33 `ok`. Data API off, SSL enforced. The app connects as `backlot_app` with the Supabase CA verified.
- **Sign-in: Supabase Auth** (Firebase removed): Google's own button (`signInWithIdToken`, Google shows "continue to Backlot") with a redirect fallback, and email + password (§2). Google OAuth client `843813897401-…` with `http://localhost:3000` and `http://localhost` as JavaScript origins.
- **Cloudflare R2:** bucket `backlot-media`, a bucket-scoped object token, CORS for `http://localhost:3000` (GET, HEAD, PUT). The owner ran the first real upload, preview, download and deletion through the local app.
- **Staging database deleted.** `backlot-staging` (`rzgfyzsjbfvdallduxio`) only ever held the legacy-table rehearsal. The owner deleted it on 2026-11-20. No staging resources exist anywhere.

**Owner decisions, 2026-11-20:** Vercel **Pro**, region `iad1` kept. No staging. Account deletion: prompt start + hourly Vercel Cron recovery (no Cloudflare Worker, no maintenance schedule). No backups. Custom SMTP deferred. GCS and other legacy code left in place.

**Left:**
1. **Set `CRON_SECRET` in Vercel** so the hourly deletion recovery run is accepted (WORKERS.md).
2. **Vercel Pro project and variables** (DEPLOYMENT.md "Vercel Pro environment checklist"), then the production domain in Supabase URL Configuration, the Google OAuth origins and the R2 CORS policy.
3. **No staging:** the release checklist's failure tests (pausing the database, a wrong CA, broken R2 credentials) must not run against production, so they're skipped or need a recorded decision.
4. Deferred: custom SMTP for sign-in emails (Supabase's built-in sender is rate-limited), the R2 lifecycle rule (abort incomplete multipart uploads after 7 days), Supabase security advisor check.
5. RELEASE_CHECKLIST.md, legal review, then the owner's explicit release approval.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) (env inventory, migrations, rollback), [STORAGE.md](STORAGE.md) (R2 CORS JSON), [WORKERS.md](WORKERS.md) (scheduler), [BACKUPS.md](BACKUPS.md) (backups, key custody, restore), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (final verification).

## Owner decisions this guide follows (2026-11-18)

| Decision | Value |
| --- | --- |
| Use | Limited-access private beta. |
| Hosting | **Vercel Pro** (owner confirmed 2026-11-20), region `iad1` (Washington, D.C.). Keep `iad1`; don't change the region based on estimated latency. |
| Database | Supabase Free. **Production reuses the existing project formerly named `content-vault`, renamed `backlot` on 2026-11-20** (`pdhymiqjlzaanarleucv`, East US, Ohio, `us-east-2`; decision 2026-11-19). Staging, if used, is a separate, disposable project in the same region (the first one was deleted on 2026-11-20). Vercel stays `iad1` until staging measures the latency. |
| Media | Private Cloudflare R2 bucket |
| Authentication | **Supabase Authentication with Google sign-in**, in the same `backlot` project (decision 2026-11-20; replaces the earlier Firebase plan). Identity only: data still goes through Drizzle and `backlot_app`, and the Data API stays off. |
| Slate | OpenAI GPT-6.1 Sol primary, Claude Opus 5.5 fallback. No other providers. |
| Supabase pausing | Accepted during the private beta (see the note in §4) |
| Backup decryption key | Held by the owner only |
| Legal review | Required before any public launch |

## 1. Billing: what needs payment details and what can charge

Free allowances are **not** spending caps. "Can charge" means usage beyond an allowance turns into a bill unless something stops it.

| Service | Needs billing details? | Can it charge? | What stops or limits a bill |
| --- | --- | --- | --- |
| Vercel Pro | Yes (subscription) | **Yes**: the monthly fee, plus usage beyond Pro's included amounts | **Spend Management** (Settings → Billing): set an amount and whether to pause projects when it's reached |
| Supabase Free | No | No | Free-plan limits (500 MB database, 2 active projects per organization); the project pauses after low activity |
| Cloudflare R2 | **Yes.** Enabling R2 goes through a checkout that adds a payment method, even to use only the free allowance | **Yes**, beyond 10 GB-month storage and the Class A/B operation allowances (egress is free) | No hard cap. Backlot's own limits (1 GB per creator, 9.5 GB app ceiling) plus Cloudflare billing notifications |
| Supabase Auth | No | No on Free (50,000 monthly active users included) | Free-plan limits |
| Google Cloud (OAuth client for Google sign-in) | No | No | Creating an OAuth client doesn't need billing |
| GitHub Actions (backups) | No for a private repository within the free minutes | Only if the account's Actions spending limit is above $0 | Manual-only; nothing runs unless started. Keep the spending limit at $0 |
| OpenAI API | **Yes** (prepaid credits or billing) | **Yes**, per token | Project budget and usage limits in the OpenAI dashboard, plus Backlot's per-creator Slate limits |
| Anthropic API | **Yes** | **Yes**, per token (only on fallback) | Workspace spend limit in the Anthropic Console |
| Domain name | **Yes** (registrar) | Yearly renewal | Registrar auto-renew settings |

## 2. Sign-in: Supabase Auth (Google, and email + password)

Decision 2026-11-20: Supabase Authentication replaces Firebase Authentication. Backlot has no users yet, so no accounts migrate. The old Firebase project (`gen-lang-client-0425820524`) and the AI Studio app are left untouched and are no longer used.

**How it works in code:**

| Piece | File | What it does |
| --- | --- | --- |
| Google button | `src/lib/google-identity.ts`, `src/components/GoogleSignInButton.tsx` | Google's official button (Google Identity Services) on Backlot's own origin returns a Google ID token; `signInWithIdToken` (with a hashed nonce) turns it into a Supabase session. Google's screens name Backlot's site, not the Supabase domain. Falls back to the redirect flow if the script can't load. |
| Email + password | `src/lib/supabase/browser.ts` (`signUpWithPassword`, `signInWithPassword`), `src/components/auth/AuthPanel.tsx` | `signUp` / `signInWithPassword`. Minimum 8 characters (checked in the browser; Supabase's own minimum still applies). "Confirm email" is **off** (owner decision), so sign-up signs the person in at once and no email is sent. No magic links and no password reset (owner decision). |
| Browser session | `src/lib/supabase/browser.ts` | The session is kept in first-party `sb-…` cookies and refreshed automatically. Redirect fallback: `signInWithOAuth` (PKCE). |
| Callback | `app/auth/callback/route.ts` | PKCE code exchange for the Google redirect fallback. Redirects only to a path on this site (`src/lib/supabase/redirect.ts`). |
| Session refresh | `middleware.ts` | Refreshes an expired access token on each request that has a session cookie. It isn't access control. |
| Server identity | `src/lib/supabase/server.ts`, `src/lib/auth-server.ts` | `requireUser` verifies the access token (Bearer header, else cookies) with `auth.getClaims()`. The uid is the token's `sub`, never anything the browser sends. Fails closed (401). |
| Account deletion | `src/lib/account/supabase-identity.ts` | Admin API with `SUPABASE_SECRET_KEY`: ban (revokes refresh), hard delete, existence check. |

Supabase user ids are UUIDs, stored in the existing text uid columns. No schema change.

### Setup [confirm]

Done by the owner on 2026-11-20: the Google provider is enabled with the Google OAuth client id and secret. Google's authorized redirect URI is `https://pdhymiqjlzaanarleucv.supabase.co/auth/v1/callback`.

Still to do:

1. **Authentication → URL Configuration:**
   - **Site URL:** `http://localhost:3000` for now (the production URL once Backlot is deployed).
   - **Redirect URLs:** add `http://localhost:3000/**`. The callback is `/auth/callback?next=…`, and the wildcard covers the query string. Later, add `https://<production-domain>/**`. Supabase sends anything not listed to the Site URL instead.
2. **Project Settings → API Keys:** copy the **publishable** key into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (already in `.env.local`). Create or copy a **secret** key into `SUPABASE_SECRET_KEY`: `.env.local` for local account-deletion testing, Vercel (Sensitive) in production. Never use a `NEXT_PUBLIC_` name for the secret key. The config check refuses one.
3. **Google Cloud → Credentials → the OAuth client (`843813897401-…`) → Authorized JavaScript origins:** add `http://localhost:3000` and `http://localhost` (later `https://<production-domain>`). Without it Google's button refuses to load ("The given origin is not allowed"). The client id goes in `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (public).
4. **Email + password:** the Email provider is enabled and "Confirm email" is off (owner decision, 2026-11-20). No SMTP is configured, so Backlot sends no auth emails. Known limits: no self-service password reset, and email addresses aren't verified (see the security note below).
5. **Google Cloud → OAuth consent screen (Branding):** app name "Backlot", support email, privacy and terms URLs, authorized domain. Otherwise Google's screen shows the Supabase domain.
6. **Optional:** Authentication → Providers: keep only Google and Email enabled. Anonymous sign-ins stay off (the server rejects them anyway).

**Security note (email confirmation off).** Nobody proves they own the address they sign up with. Supabase links a later Google sign-in to an existing user with the same email, and removes only *unconfirmed* identities when it does; with confirmation off, password sign-ups are auto-confirmed. So someone could register a victim's address with a password first, and when the victim later signs in with Google, both may reach the same account (pre-account takeover). Supabase's docs don't spell out this case; treat it as likely until tested. Turning "Confirm email" on (which needs custom SMTP) closes it. Also: there's no password reset, so a forgotten password means a lost account, and support can't safely reset one, because the registered address was never verified.

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

### 3.1a Existing `content-vault` database (production, now named `backlot`) [done 2026-11-20]

**Done on 2026-11-20** through the SQL Editor: the transition, then manual-setup steps 00–11 (in place of steps 3–4 below). Step 11 passed all 33 checks. The staging rehearsal covered only the transition. Kept for the record and for rollback.

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

### 3.3 Deletion cron

Nothing to set up outside Vercel: `vercel.json` defines the hourly cron, and `CRON_SECRET` (Vercel, Production) authenticates it (WORKERS.md).

### 3.4 Vercel [confirm]

Prerequisite: the code is committed and pushed to a GitHub repository (the owner's commit; the agent doesn't commit). A **private** repository is recommended (BACKUPS.md: workflow logs and the 60-day schedule rule).

1. [vercel.com](https://vercel.com) → Pro team → **Add New → Project** → import the repository. Framework: Next.js (detected); root: repository root; build command: default (`next build`).
2. **Settings → Functions:** confirm **Fluid compute** is on, the region is `iad1` (from `vercel.json`), and the maximum duration allows 300 s. `vercel.json` asks for chat 300 s, the deletion worker 120 s and maintenance 180 s. A rejected value fails the deployment, which is the signal to adjust.
3. **Settings → General → Node.js version:** the newest LTS offered.
4. **Settings → Environment Variables:** enter the variables from DEPLOYMENT.md "Environment variables", marking secrets **Sensitive**.
   - **Production** environment: production values only.
   - **Preview** environment, **scoped to the branch `staging`**: the staging values (its own Supabase URL and keys). Don't define production secrets for "all Preview branches".
5. **Settings → Deployment Protection:** keep **Vercel Authentication** on for Preview deployments. For staging scheduling, create a **Protection Bypass for Automation** secret and give it only to the staging Worker (`VERCEL_PROTECTION_BYPASS`).
6. Deploy (staging: push the `staging` branch). Open `/api/health?ready=1`: expect 200 and `config.ok` in the logs.

### 3.5 GitHub Actions backups (not configured: owner decision)

The workflow is manual-only. Only if that decision changes:

1. **Key pair** on the owner's machine (BACKUPS.md "Key custody"): `age-keygen -o backlot-backup.key`. Two copies of the private key: password manager plus an offline copy. The printed `age1…` public key is the only part GitHub gets.
2. Repository → **Settings → Secrets and variables → Actions:** `BACKUP_DATABASE_URL` (the **session pooler** URL as `backlot_backup.<ref>`), `BACKUP_AGE_RECIPIENT`, `BACKUP_R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), `BACKUP_R2_BUCKET`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`. For staging, point a manual run at the staging project, or use a fork's secrets, and keep the production secrets separate.
3. **Actions → db-backup → Run workflow**. Then do the restore test (RELEASE_CHECKLIST S-BK2). Backups count as operational only after that restore passes.

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
   | Supabase → Authentication → URL Configuration | Site URL `https://<domain>`; Redirect URLs add `https://<domain>/**` |
   | Google OAuth consent screen → Authorized domains | add `<domain>` |
   | R2 `backlot-media` CORS `AllowedOrigins` | add `https://<domain>` |

   Redeploy production after changing `SITE_URL`.

## 4. Supabase pausing and the deletion job

Supabase pauses a Free project when **database activity** has been low for 7 days, and only the owner can resume it (dashboard → project → Resume). While it's paused, Backlot's API returns 503 everywhere. A deletion request can't be accepted: the creator sees "Couldn't start deleting your account. Nothing was deleted." A deletion that was already accepted stays locked and waiting, and the status page says progress can't be checked and that deletion continues automatically.

The hourly deletion run queries the database (about 170 small queries a week). Supabase says a few requests a day typically prevent pausing, so it may keep the project awake, but don't rely on it: Supabase doesn't guarantee it, and the owner's decision to accept pausing stands. If the project does pause, resume it from the dashboard; queued deletions then complete on the next hourly run.

## 5. Disposable staging environment

Purpose: run the full release checklist against **real** Vercel, Supabase (database and Auth) and R2, with **synthetic** data only, then throw it away.

| Piece | Staging | Production |
| --- | --- | --- |
| Code | Git branch `staging` → Vercel Preview (protected) at its stable branch URL `https://<project>-git-staging-<scope>.vercel.app` | `main` → Vercel Production |
| Vercel variables | Preview, scoped to branch `staging` | Production |
| Database | Supabase project `backlot-staging` (same region) | `backlot` |
| Media and backups | `backlot-media-staging`, `backlot-db-backups-staging`, their own tokens | `backlot-media`, `backlot-db-backups` |
| Identity | Supabase Auth of the staging project (its own URL and keys) | Supabase Auth of `backlot` |
| Slate keys | Separate low-budget keys | Production keys |
| Accounts | Dedicated test Google accounts (A, B, C), never anyone's real account | Real creators |
| Data | Synthetic only: made-up posts and ideas, generated test images, a public-domain or self-made test video | Real |

**Supabase project limit:** the Free plan allows **two active projects** per organization. Staging plus production uses both, so the restore drill (S-BK2) needs a third. Restore into the staging project after a `--clean` reset, or pause or delete staging first. Don't restore over production.

**Teardown after sign-off:** delete the staging Vercel variables and the `staging` branch deployments; delete the staging Supabase project; empty and delete both staging buckets and revoke their tokens; revoke the staging Slate keys; delete the test Google accounts' Backlot data through the app's account deletion first.

## 6. Secrets: where each one lives

| Secret | Lives in | Never in |
| --- | --- | --- |
| `DATABASE_URL` (as `backlot_app`) | Vercel (Sensitive) | Git, the browser |
| `DATABASE_MIGRATION_URL` (postgres) | Owner's `.env.local`, password manager | Vercel, GitHub |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (media) | Vercel | GitHub |
| `SUPABASE_SECRET_KEY` (Auth admin, account deletion) | Vercel (Sensitive), owner's `.env.local`, password manager | Git, the browser, any `NEXT_PUBLIC_` name |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Vercel | Git |
| `CRON_SECRET` (deletion recovery run) | Vercel (Production) | Git, the browser |
| `MAINTENANCE_SECRET` (optional, manual runs) | Vercel, password manager | Git, the browser |
| `BACKUP_*` (backup role, R2 backups token, age **public** key) | GitHub Actions secrets | Vercel |
| age **private** key | Owner's password manager plus one offline copy | GitHub, Vercel, Supabase, Cloudflare, the backups bucket |
| Supabase `postgres` password | Password manager | Anywhere the app runs |

Nothing secret uses a `NEXT_PUBLIC_` name. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public by design. The Google OAuth client secret lives only in Supabase's provider settings.
