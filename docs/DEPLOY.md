# Deploying Backlot

The short path from this repository to a live site. Background and details are in [DEPLOYMENT.md](DEPLOYMENT.md).

**Already done:** the Supabase `backlot` project (database, roles, migrations, Google and Email sign-in, "Confirm email" off) and the R2 bucket `backlot-media`.

**Before anything else:** run these in the Supabase SQL Editor, in order (each is safe to re-run). The app, including local development, can't load a workspace until both have run.

1. [`12_migration_2026-11-24_channel_platform.sql`](../ops/supabase/manual-setup/12_migration_2026-11-24_channel_platform.sql): each channel's platform.
2. [`13_migration_2026-11-25_idea_images.sql`](../ops/supabase/manual-setup/13_migration_2026-11-25_idea_images.sql): reference images on ideas.

## 1. Push the code

Commit and push `main` to GitHub. Vercel deploys from it.

## 2. Create the Vercel project

1. vercel.com → **Add New… → Project** → import the repository. Framework: Next.js; root: the repository root. The region (`iad1`) and the hourly deletion cron come from `vercel.json`.
2. Before the first deploy, open **Environment Variables** and add these for **Production**:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `backlot_app` transaction-pooler URL (port 6543). Sensitive |
   | `DATABASE_CA_CERT` | Supabase CA certificate (PEM) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `SUPABASE_SECRET_KEY` | Supabase secret key. Sensitive |
   | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client id |
   | `STORAGE_BACKEND` | `r2` |
   | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | From Cloudflare. Secret key Sensitive |
   | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Slate. Sensitive |
   | `CRON_SECRET` | `openssl rand -base64 48`. Sensitive |
   | `SITE_URL` | `https://<your-domain>`, no trailing slash |

   Don't add `DATABASE_MIGRATION_URL` (local only) or any `BACKUP_*` variable.
3. **Deploy.**

## 3. Domain

1. Vercel → Project → **Settings → Domains** → add your domain and set the DNS records it shows.
2. If the domain differs from what you put in `SITE_URL`, fix `SITE_URL` and **redeploy** (`NEXT_PUBLIC_*` values and the site URL are read at build or request time; a redeploy applies them).

## 4. Point the services at the domain

| Where | Change |
| --- | --- |
| Supabase → Authentication → URL Configuration | Site URL `https://<domain>`; Redirect URLs add `https://<domain>/**` |
| Google Cloud → Credentials → OAuth client → Authorized JavaScript origins | add `https://<domain>` |
| Google Cloud → OAuth consent screen | app name Backlot, support email `support@getbacklot.app`, privacy `https://<domain>/privacy`, terms `https://<domain>/terms`, authorized domain |
| Cloudflare R2 → `backlot-media` → CORS | add `https://<domain>` to `AllowedOrigins` (GET, HEAD, PUT; expose `ETag`) |
| Cloudflare R2 → `backlot-media` → Lifecycle | abort incomplete multipart uploads after 7 days |

## 5. Check it works

| Check | Expected |
| --- | --- |
| `https://<domain>/api/health?ready=1` | `{"status":"ok"}`. A 503 names the failing check |
| Sign up with email and password, then sign out and in | Lands in the workspace |
| Sign in with Google | Lands in the workspace |
| Upload a cover and a video, open them, download them | Works; files appear in R2 |
| Ask Slate something | A reply streams in |
| Vercel → Settings → **Cron Jobs** | `/api/internal/account-deletions`, hourly |
| Delete a test account (the trash icon) | Signed out; the status page reaches "Deletion completed" within a few minutes |
| `https://<domain>/sitemap.xml` and `/robots.txt` | The 5 public pages; robots points to the sitemap |
| Share the home URL in a chat app | Preview with title, description and image |

Then add the site to **Google Search Console** and submit `https://<domain>/sitemap.xml`.

## 6. Spending limits

Set budgets or alerts in OpenAI, Anthropic, Vercel (Spend Management) and Cloudflare billing.

## Known limits (owner decisions)

- **No backups.** Data recovery isn't guaranteed (BACKUPS.md).
- **Email addresses aren't verified** ("Confirm email" is off). Someone could sign up with another person's address first; turning confirmation on needs custom SMTP (INFRA_SETUP.md §2, security note).
- **No password reset.** A forgotten password means a lost account.
- **Maintenance job has no schedule.** Old Slate suggestions and abandoned uploads aren't cleaned up automatically; the Privacy Policy's suggestion-retention wording assumes they are.
- **Legal review** of Privacy and Terms (marked `OWNER REVIEW` / `LEGAL REVIEW` in the source) before inviting the public.

## Roll back

Vercel → Deployments → the previous deployment → **Instant Rollback**. To stop the deletion cron, disable it under Settings → Cron Jobs.
