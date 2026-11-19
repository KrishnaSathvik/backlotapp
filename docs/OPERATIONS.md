# Production operations (Launch L3) — LEGACY Google Cloud plan

> **Superseded.** Backlot now targets Vercel + Supabase + Cloudflare R2 + Firebase Auth. Start from
> [DEPLOYMENT.md](DEPLOYMENT.md), [WORKERS.md](WORKERS.md), [BACKUPS.md](BACKUPS.md), [STORAGE.md](STORAGE.md)
> and [COSTS.md](COSTS.md). This file is kept for its still-valid parts: the log events and their meaning
> ("Observability"), the AI cost safeguards, and the deletion evidence rules (now also in BACKUPS.md).
> The Cloud Run, Cloud SQL, Cloud Scheduler, Secret Manager, IAM and `gcloud` steps below no longer apply.

How Backlot runs in production: identities, secrets, scheduled jobs, spending limits, monitoring and backups.

The code side is done. **No cloud resource has been created, changed or verified.** The gcloud account available while writing this couldn't access the Firebase project (see "Deployment discovery").

docs/DEPLOYMENT.md has the step-by-step launch runbook. docs/STORAGE.md covers the bucket, and docs/ACCOUNT_DELETION.md covers deletion.

## Deployment discovery

### Verified (from the repository and this machine)

| Item | Finding |
| --- | --- |
| Firebase project | `gen-lang-client-0425820524` (project number `754496992188`), from `firebase-applet-config.json`. The Admin SDK uses this project id with Application Default Credentials (`src/lib/firebase-admin.ts`). No key files. |
| Build | Next.js `output: 'standalone'`. The repo has no Dockerfile, Cloud Build config, `app.yaml` or CI workflow. |
| Deployment method | Not in the repository. Code comments and `.env.example` say "AI Studio injects the Cloud Run URL" (`APP_URL`), and there's an AI Studio `DISABLE_HMR` hook and an applet `metadata.json`. This points to Google AI Studio's Cloud Run deploy. **Inferred, not verified.** |
| Database client | `pg` pool from `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME` (`src/db/index.ts`). There's no Cloud SQL connector library: production must use the Cloud Run Cloud SQL socket (`SQL_HOST=/cloudsql/<connection name>`) or an address. The local `.env.local` points at `127.0.0.1` with placeholder values. |
| gcloud access | The active account on this machine can reach 9 other projects, including two other `gen-lang-client-*` projects, but not `gen-lang-client-0425820524`. `projects describe`, `run services list`, `sql instances list` and `iam service-accounts list` all returned permission denied. The default project is `trail-narrator`, which is unrelated. **Nothing was run against any other project.** |

### Not verified (needs an account with access)

| Item | Why it matters |
| --- | --- |
| The project hosting Cloud Run | It may differ from the Firebase project. `gen-lang-client-*` is the name pattern of projects AI Studio creates, so it's *likely* the same project, but that's unconfirmed. |
| Cloud Run service name, region, URL | Bucket region, scheduler location, `INTERNAL_OIDC_AUDIENCE`. |
| Runtime service account | Probably the default Compute Engine account, which usually has project-wide Editor. Replace it (IAM plan below). |
| Cloud SQL instance, region, connection method, backup settings | Backups and restore, `SQL_HOST`. |
| Existing env vars and secrets on the service | Whether keys are plain env vars or Secret Manager references. |
| Existing Scheduler jobs | The old single-secret cleanup job must be replaced. |
| Whether AI Studio redeploys overwrite service settings | If an AI Studio "deploy" resets env vars, secrets or the service account, settings made with gcloud could be lost. Check this before relying on them. |

Read-only commands to fill this in. Set `PROJECT` to the project that **hosts** the service, once found:

```sh
gcloud projects describe gen-lang-client-0425820524 --format='value(projectId,projectNumber)'
gcloud run services list --project=$PROJECT --format='table(metadata.name,region,status.url)'
gcloud run services describe $SERVICE --project=$PROJECT --region=$REGION \
  --format='yaml(spec.template.spec.serviceAccountName,spec.template.spec.timeoutSeconds,spec.template.metadata.annotations,spec.template.spec.containers[0].env)'
gcloud sql instances list --project=$PROJECT --format='table(name,region,connectionName,databaseVersion)'
gcloud sql instances describe $INSTANCE --project=$PROJECT --format='yaml(settings.backupConfiguration)'
gcloud secrets list --project=$PROJECT
gcloud scheduler jobs list --project=$PROJECT --location=$REGION
gcloud projects get-iam-policy $PROJECT --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:$RUNTIME_SA" --format='value(bindings.role)'
```

The `env` output shows secret *references* and plain values. Don't paste plain values anywhere.

**Missing access to request:** at least `roles/viewer`, plus `roles/run.viewer`, `roles/cloudsql.viewer`, `roles/secretmanager.viewer` and `roles/cloudscheduler.viewer`, on the hosting project (and on the Firebase project if it's different). Provisioning (L1, L3) also needs `roles/run.admin`, `roles/iam.serviceAccountAdmin`, `roles/storage.admin`, `roles/secretmanager.admin`, `roles/cloudscheduler.admin`, and `roles/resourcemanager.projectIamAdmin` (or an owner to run the commands).

## IAM plan (least privilege)

The identities, and what each one needs:

| Identity | Used by | Roles |
| --- | --- | --- |
| `backlot-run@$PROJECT.iam.gserviceaccount.com` (new, replaces the default Compute account) | The Cloud Run service | `roles/cloudsql.client` (project, or the SQL instance's project). `roles/storage.objectUser` **on the Backlot bucket only**. `roles/secretmanager.secretAccessor` **on each Backlot secret only**. `roles/firebaseauth.admin` **in the Firebase project**, unless the worker is split out (below). |
| `backlot-deletion-scheduler@…` (new) | Cloud Scheduler OIDC identity for the deletion worker | None. The app only checks the identity's email in the OIDC token. Add `roles/run.invoker` on the worker service only if that service doesn't allow public access. |
| `backlot-maintenance-scheduler@…` (new) | Cloud Scheduler OIDC identity for daily maintenance | Same as above. |
| Whoever creates the Scheduler jobs | Operator | `roles/iam.serviceAccountUser` on the two scheduler accounts (lets them attach the identity), plus `roles/cloudscheduler.admin`. |

What each permission is for:

- **Cloud Storage objects:** read, write and delete objects, and start and cancel resumable uploads. `objectUser` on the bucket covers all of these. No bucket-admin rights, no other buckets.
- **Firebase Authentication:** verifying ID tokens needs no role (it uses Google's public keys). Revoking refresh tokens, deleting a user and checking a user exists need `roles/firebaseauth.admin` (or a custom role with `firebaseauth.users.get`, `firebaseauth.users.update` and `firebaseauth.users.delete`) **in the Firebase project**.
- **Cloud SQL:** `roles/cloudsql.client` for the Cloud Run socket connection. Database rights come from the Postgres user: the app user owns no schema changes, and migrations use `SQL_ADMIN_USER` from an operator machine.
- **Secret Manager:** `secretAccessor` per secret, granted on the secret, not the project.
- **Scheduler:** the jobs sign OIDC tokens as their own service accounts. The app checks that the audience is `INTERNAL_OIDC_AUDIENCE` and the email is the configured invoker for that job (`src/lib/internal-auth.ts`).
- **Not needed:** Editor, Owner, `storage.admin`, `iam.serviceAccountTokenCreator` on the runtime account, and service-account keys.

**Optional dedicated worker identity.** The only extra power the deletion worker needs is Firebase Authentication admin. To keep that out of the public web service:

1. Deploy the same image a second time as `backlot-worker`. Give it its own service account `backlot-worker@…` with `firebaseauth.admin`, the bucket binding, Cloud SQL client, and access to the DB and `UPLOAD_SESSION_KEY` secrets.
2. Give `backlot-worker` no public invoker; grant `roles/run.invoker` to the two scheduler accounts.
3. Point both Scheduler jobs at `backlot-worker`.
4. Drop `firebaseauth.admin` from `backlot-run`. The request-time token revoke then fails quietly (`account_deletion.revoke_deferred`), and the worker's first step does it within minutes. The access lock doesn't depend on it.

No code change is needed. The cost is a second service to deploy and configure. If the AI Studio deployment flow can only manage one service, keep a single identity with the roles above.

**Cross-project note:** if Cloud Run and Firebase live in different projects, grant the runtime (or worker) account `roles/firebaseauth.admin` in the **Firebase** project. Everything else goes in the hosting project.

Provisioning sketch (needs approval, not run):

```sh
gcloud iam service-accounts create backlot-run --project=$PROJECT --display-name="Backlot web"
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:backlot-run@$PROJECT.iam.gserviceaccount.com --role=roles/cloudsql.client
gcloud storage buckets add-iam-policy-binding gs://$BUCKET --member=serviceAccount:backlot-run@$PROJECT.iam.gserviceaccount.com --role=roles/storage.objectUser
gcloud projects add-iam-policy-binding gen-lang-client-0425820524 --member=serviceAccount:backlot-run@$PROJECT.iam.gserviceaccount.com --role=roles/firebaseauth.admin
for s in backlot-openai-api-key backlot-anthropic-api-key backlot-upload-session-key backlot-sql-password; do
  gcloud secrets add-iam-policy-binding $s --project=$PROJECT --member=serviceAccount:backlot-run@$PROJECT.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
done
gcloud iam service-accounts create backlot-deletion-scheduler --project=$PROJECT
gcloud iam service-accounts create backlot-maintenance-scheduler --project=$PROJECT
gcloud run services update $SERVICE --project=$PROJECT --region=$REGION --service-account=backlot-run@$PROJECT.iam.gserviceaccount.com
```

## Secrets checklist

Store secrets in Secret Manager, and mount them as env vars with `--set-secrets=ENV=secret:latest`. Never put them in plain env vars, the repo, logs or tickets. The app never logs a value: config errors name the setting, and `src/lib/ops-log.ts` drops fields that look like secrets.

| Env var | Secret (suggested name) | Required | Notes |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | `backlot-openai-api-key` | Yes (unless `SLATE_ALLOW_FALLBACK_ONLY=true`) | Primary Slate provider and embeddings. Use a project-scoped key with a provider-side spend limit. |
| `ANTHROPIC_API_KEY` | `backlot-anthropic-api-key` | Recommended | Fallback provider. Use a workspace key with a spend limit. |
| `UPLOAD_SESSION_KEY` | `backlot-upload-session-key` | Yes with `STORAGE_BACKEND=gcs` | `openssl rand -base64 32`. **Rotation** makes in-flight resumable uploads unusable (they return 410 and the creator starts again). Rotate at a quiet time; finished files aren't affected. |
| `SQL_PASSWORD` | `backlot-sql-password` | Yes | Password of the runtime Postgres user. `SQL_ADMIN_PASSWORD` is for migrations from an operator machine. **Don't** give it to the service. |
| `DELETION_WORKER_SECRET` | `backlot-deletion-worker-secret` | Only without OIDC | 32+ characters. Must differ from the maintenance secret (startup check). |
| `MAINTENANCE_SECRET` | `backlot-maintenance-secret` | Only without OIDC | 32+ characters. `CLEANUP_SECRET` is accepted as a legacy name **for maintenance only**. Remove the old shared one. |

Plain (non-secret) env vars:

- `NODE_ENV=production`, `APP_URL`
- `SQL_HOST=/cloudsql/<connection name>`, `SQL_USER`, `SQL_DB_NAME`
- `STORAGE_BACKEND=gcs`, `GCS_BUCKET`, `GCS_PREFIX`, `STORAGE_SOFT_DELETE_DAYS`
- `INTERNAL_OIDC_AUDIENCE`, `DELETION_WORKER_INVOKER`, `MAINTENANCE_INVOKER`
- `PRIVACY_CONTACT_EMAIL`
- optional limits: `SLATE_DAILY_MESSAGE_LIMIT`, `STORAGE_QUOTA_GB`, `UPLOAD_MAX_CONCURRENT`, retention days

Firebase client config (`firebase-applet-config.json`) is public by design (the web API key identifies the project, it isn't a credential). The server uses no Firebase key at all.

**Startup validation:** `instrumentation.ts` runs `checkProductionConfig` (`src/lib/config-check.ts`) when an instance starts. In production, any error stops the instance (`config.refusing_to_start`), so a misconfigured revision never takes traffic. The check covers:

- the database settings;
- the storage backend and bucket;
- `UPLOAD_SESSION_KEY`;
- the Slate primary key;
- credentials for each job, which must not be shared;
- `PRIVACY_CONTACT_EMAIL`.

`BACKLOT_SKIP_CONFIG_CHECK=true` bypasses the check in an emergency, and logs CRITICAL.

## Scheduled jobs

There are two independent jobs, each with its own identity. Both run in the Cloud Run region. Create them in runbook step 8, after the deploy, or create them earlier and pause them right away (`gcloud scheduler jobs pause`).

```sh
AUD=https://<service url>          # = INTERNAL_OIDC_AUDIENCE

gcloud scheduler jobs create http backlot-account-deletions --project=$PROJECT --location=$REGION \
  --schedule='*/5 * * * *' --time-zone=Etc/UTC \
  --uri="$AUD/api/internal/account-deletions" --http-method=POST \
  --oidc-service-account-email=backlot-deletion-scheduler@$PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience="$AUD" \
  --attempt-deadline=300s --max-retry-attempts=0

gcloud scheduler jobs create http backlot-maintenance --project=$PROJECT --location=$REGION \
  --schedule='17 3 * * *' --time-zone=Etc/UTC \
  --uri="$AUD/api/internal/cleanup" --http-method=POST \
  --oidc-service-account-email=backlot-maintenance-scheduler@$PROJECT.iam.gserviceaccount.com \
  --oidc-token-audience="$AUD" \
  --attempt-deadline=300s --max-retry-attempts=3 --min-backoff=10m
```

| | Deletion worker | Daily maintenance |
| --- | --- | --- |
| Route | `POST /api/internal/account-deletions` | `POST /api/internal/cleanup` |
| Frequency | Every 5 min | Daily, 03:17 UTC |
| Does | Runs due deletion jobs for up to ~4 min, at most 20 per call | Expires pending Slate suggestions. Deletes closed ones after `SLATE_ACTION_RETENTION_DAYS` (30). Prunes audit events after `SLATE_AUDIT_RETENTION_DAYS` (180) and leases older than a day. Cancels abandoned uploads and deletes their orphaned objects. Purges completed deletion records after `ACCOUNT_DELETION_RECORD_DAYS` (30). |
| Retries | None from Scheduler: the next run is 5 minutes away, and failed steps keep their own backoff | 3, 10+ minutes apart. Every part is idempotent. |
| Overlap | Safe: jobs are leased (`FOR UPDATE SKIP LOCKED`, 10 min), so two calls never run the same job | Safe: row locks with `SKIP LOCKED`. Parts run independently, and one failing returns 503 so Scheduler retries |
| Auth | OIDC from `DELETION_WORKER_INVOKER`, or `DELETION_WORKER_SECRET` | OIDC from `MAINTENANCE_INVOKER`, or `MAINTENANCE_SECRET` |

The daily job no longer runs deletion jobs, so the two are fully separate. If OIDC isn't possible, use `--headers="Authorization=Bearer <secret>"` with each job's own secret instead of the `--oidc-*` flags. The secret is then stored in the Scheduler job configuration, which is one more reason to prefer OIDC.

## AI and storage cost safeguards

The limits that exist today:

| Safeguard | Setting | Where |
| --- | --- | --- |
| Slate requests per account | 30 per 10 min | `app/api/chat/route.ts`, shared across instances in Postgres |
| Concurrent Slate requests per account | 2 | same |
| **Daily Slate ceiling per account** (new in L3) | `SLATE_DAILY_MESSAGE_LIMIT`, default 200 per rolling 24 h | `src/lib/slate/shared-limits.ts` |
| Image analysis per account | 30 per day, one image per message, downscaled before sending | `shared-limits.ts`, `images.ts` |
| Output-token budget per reply | 4,096 (create/general), 8,192 (plan); `SLATE_MAX_TOKENS_<TASK>` overrides | `src/lib/slate/tasks.ts` |
| Reply deadlines | 60–90 s, first output 15–30 s | same |
| Failover | At most 1 fallback attempt and 1 same-provider retry. The circuit breaker is shared between instances. Fallback can be turned off (`SLATE_ENABLE_FALLBACK=false`). | `stream.ts`, `breaker.ts` |
| Limits store down | Fails closed (503), so an outage can't multiply quotas by the number of instances | `FailClosedUsageLimiter` |
| Upload size | Images 30 MB, videos 10 GB, 2 MB chunks | `src/lib/upload-limits.ts` |
| Storage per account | `STORAGE_QUOTA_GB`, default 20 (finished + reserved), enforced atomically | `src/lib/storage/uploads.ts` |
| Unfinished uploads per account | `UPLOAD_MAX_CONCURRENT`, default 3 | same |

With these limits, one account can generate at most 200 replies a day, each with at most 4,096–8,192 output tokens, plus input context. Multiply by the provider's current prices to get a worst case per account. This document deliberately quotes no prices.

There are three kinds of cost number. Keep them apart:

| Kind | Source | Use for |
| --- | --- | --- |
| **Measured usage** | `slate.reply` events: `input_tokens`, `output_tokens`, `provider`, `model`; Cloud Storage metrics (bytes stored, bytes sent) | Trends, per-feature volume, anomaly alerts |
| **Estimated charges** | `est_cost_usd` on `slate.reply`: tokens × the price table in `src/lib/slate/providers.ts`. Only the Anthropic default is filled in; OpenAI is `null` until `SLATE_PRICE_OPENAI="in,out"` is set. **Check both against the providers' current pricing pages before relying on them.** | Rough daily estimates in log-based metrics |
| **Actual billed cost** | Cloud Billing reports and budgets (Google Cloud), and the OpenAI and Anthropic billing consoles | The only source of truth. Arrives with a delay of hours. |

There are no per-request billing queries. Nothing in the request path calls a billing API.

Alerts to set up, outside the app:

1. **Cloud Billing budget** on the hosting project, with email alerts at 50%, 90% and 100% of a monthly amount you choose. Actual cost.
2. **Provider spend limits:** a monthly budget or usage limit on the OpenAI project, and a spend limit on the Anthropic workspace, in each provider's console. Use whatever options they currently offer. These are the hard stop if something goes wrong.
3. **Log-based metric** `slate_output_tokens`: sum of `jsonPayload.output_tokens` where `jsonPayload.event="slate.reply"`. Alert when the daily total exceeds about 3× the normal week. Measured usage.
4. **Cloud Storage:** alert on `storage.googleapis.com/storage/total_bytes` for the bucket (growth) and `storage.googleapis.com/network/sent_bytes_count` (egress; video playback is the main driver).
5. **Limit pressure:** a metric on `slate.limit_reached` by `reason`. A rising `daily_quota` count means real users are hitting the ceiling (or one account is abusing it).

## Observability

Events are one JSON line each on stdout (INFO/NOTICE) or stderr (WARNING and above). Cloud Logging reads `severity`, and the fields land in `jsonPayload`. Filter with `jsonPayload.event="…"`.

What never gets logged:

- creator content, prompts or captions;
- emails, or uids (except on the two deletion-ledger events below, which need them to re-apply deletions after a restore);
- API keys or tokens;
- image bytes;
- resumable upload URLs or status tokens.

`src/lib/ops-log.ts` drops keys that look like those, and truncates strings to 200 characters. Errors are logged by code or class name only (`errorKind`), never their message.

| Event | Severity | Fields | Meaning |
| --- | --- | --- | --- |
| `slate.reply` | INFO, or WARNING if not done | status, task, provider, model, attempts, tools, actions, ttft_ms, total_ms, input/output_tokens, est_cost_usd, finish | One per Slate reply |
| `slate.provider_failed` | WARNING | provider, kind, ms, before_output | A provider attempt failed |
| `slate.fallback` | WARNING | reason, provider | The reply came from the fallback provider |
| `slate.breaker_open` / `slate.breaker_closed` | WARNING / NOTICE | provider, why (failures, probe_failed, shared, success) | Circuit-breaker transitions on an instance |
| `slate.limit_reached` | NOTICE | reason (busy, rate, daily_quota, image_quota) | A request was refused by a quota |
| `slate.limits_unavailable` | ERROR | error | The limits store (Postgres) is unreachable; Slate refuses requests. At most once a minute per instance. |
| `slate.reply_not_saved` | ERROR (NOTICE if `BKDEL`) | error | A reply couldn't be stored. `BKDEL` means the account was locked for deletion meanwhile, which is expected. |
| `slate.request_failed` | ERROR | error | Slate failed before streaming |
| `upload.failed` | ERROR | error | A chunk upload failed for a reason other than validation |
| `maintenance.run` | INFO, or ERROR if a part failed | counts per part, failed | Daily maintenance summary, including abandoned uploads and orphaned objects |
| `maintenance.part_failed` | ERROR | part, error | One maintenance part failed |
| `account_deletion.requested` / `.completed` | NOTICE | job, uid, attempts, hours | Out-of-database record of deletions, used to re-apply them after a restore. The uid is the only account identifier logged anywhere; never an email. |
| `account_deletion.step` | INFO | job, step, attempt | Deletion progress (job id only) |
| `account_deletion.retry` | WARNING, ERROR with `needs_attention` | job, step, attempt, error | A step failed and will retry |
| `account_deletion.worker_run` / `.worker_failed` | INFO / ERROR | completed, retrying, ms / error | Worker invocation |
| `account_deletion.revoke_deferred` | NOTICE | job, error | Request-time token revoke failed; the job does it |
| `internal_auth.denied` | WARNING | job, reason | A job endpoint was called with wrong or missing credentials |
| `db.unavailable` | ERROR | route, error | The database didn't answer (auth gate, status page, health) |
| `config.error` / `config.warning` / `config.ok` / `config.refusing_to_start` / `config.check_bypassed` | ERROR / WARNING / INFO / CRITICAL / CRITICAL | detail | Startup configuration check |

Health endpoints:

- **Liveness** (`GET /api/health`) touches nothing else. Use it for the Cloud Run startup and liveness probes.
- **Readiness** (`GET /api/health?ready=1`) checks config and the database, including that `account_deletions` exists. Use it for an uptime check every 5 minutes and after each deploy. It returns 503 with the names of the failed checks only.

### Alerts (suggested thresholds)

Notify a channel someone actually reads (email at minimum).

| Alert | Condition | Why |
| --- | --- | --- |
| Deletion needs attention | Any `account_deletion.retry` with `needs_attention=true` | A deletion has failed 4+ times. The creator is told it's taking longer. |
| Deletion worker not running | Scheduler job `backlot-account-deletions` attempt failures ≥ 3 in 30 min (logs: `resource.type="cloud_scheduler_job"`, severity ≥ ERROR) | Deletions would stall |
| Maintenance failed | `maintenance.run` with severity ERROR, or no `maintenance.run` in 26 h | Retention promises in the privacy policy depend on it |
| Database unavailable | `db.unavailable` or `slate.limits_unavailable` ≥ 5 in 5 min, or the readiness check fails twice | Sign-in, workspace and Slate all fail |
| Primary provider outage | `slate.breaker_open` with provider=openai, ≥ 3 in 10 min | Running on fallback (cost and quality differ) |
| Slate error rate | `slate.reply` with status=error > 10% of replies over 15 min (two log-based metrics) | Users see failures |
| Upload failures | `upload.failed` ≥ 10 in 10 min | Storage permissions or bucket problems |
| Config | Any `config.refusing_to_start` or `config.check_bypassed` | A deploy is blocked, or running unchecked |
| Auth probing | `internal_auth.denied` ≥ 20 in 10 min | Someone is hitting the job endpoints |

### Troubleshooting

- **Revision won't start:** read the `config.error` entries for that revision. They name each missing setting. Fix it and deploy again.
- **`db.unavailable`:**
  - Check the Cloud SQL instance state.
  - Check the `--add-cloudsql-instances` annotation on the service.
  - Check that `SQL_HOST` is `/cloudsql/<connection name>`.
  - Check that the runtime account has `cloudsql.client`.
- **Deletion stuck:** `select id, status, attempts, last_error, steps from account_deletions where status <> 'completed';`. Then match `last_error`:
  - `delete_files:403`: the bucket binding is missing.
  - `delete_sign_in:auth/insufficient-permission`: Firebase Auth admin is missing in the Firebase project.
  - `verify:data remains`: a late write, which retries in a minute.
- **`internal_auth.denied` with `oidc_wrong_identity`:** the Scheduler job's service account doesn't match `*_INVOKER`. With `oidc_invalid`, check that the audience matches `INTERNAL_OIDC_AUDIENCE` exactly.
- **Many `slate.fallback` events:** the OpenAI key, quota or outage. Check `slate.provider_failed` `kind` (`auth` = key, `rate_limit` = quota).

## Backups and recovery

**Nothing here is verified.** Cloud SQL backup settings couldn't be read (see discovery), so don't assume backups are on.

Two separate mechanisms:

- **Cloud SQL backups and point-in-time recovery** cover database rows: workspace, Slate data, deletion records.
- **Cloud Storage soft delete** (7 days, docs/STORAGE.md) covers deleted media objects.

They have separate retention periods and separate restore procedures. Neither replaces the other, and restoring one doesn't restore the other.

Recommended settings (apply with approval):

```sh
gcloud sql instances patch $INSTANCE --project=$PROJECT \
  --backup-start-time=03:00 --retained-backups-count=14 \
  --enable-point-in-time-recovery --retained-transaction-log-days=7
gcloud sql instances describe $INSTANCE --format='yaml(settings.backupConfiguration)'   # verify
```

- **Automated backups:** daily, keeping 14. **Point-in-time recovery:** 7 days of transaction logs.
- **Keep the oldest restorable backup younger than the deletion ledger's retention** (60 days suggested, below) and `ACCOUNT_DELETION_RECORD_DAYS` (30). After a restore, deletions since the backup must be applied again, and their records outside the restored database only last that long.
- **Before every migration:** `gcloud sql backups create --instance=$INSTANCE --description="pre-<migration>"`. Record row counts (DEPLOYMENT.md, "Rollout sequence").
- **Once retention is confirmed,** update the privacy page's "Backups" item with the actual number of days (it gives none today).

**Restore procedure** (into a new instance; never over production):

1. Pick the point:
   - from a backup: `gcloud sql backups list --instance=$INSTANCE`;
   - or a time: `gcloud sql instances clone $INSTANCE backlot-restore-<date> --point-in-time=<UTC RFC 3339>`.
   - For a backup, create the target instance first, then `gcloud sql backups restore $BACKUP_ID --restore-instance=backlot-restore-<date> --backup-instance=$INSTANCE`.
2. Check it: row counts, a few posts, and `select count(*) from account_deletions`.
3. **Re-apply deletions before the restored database takes traffic.** The restored copy can contain accounts deleted (or being deleted) after the backup point, and its own `account_deletions` table is as old as the backup, so it doesn't know about them. Collect evidence from these sources:

   | Source | What it proves | How |
   | --- | --- | --- |
   | **A. Current production database** (if still readable) | A deletion was requested (and maybe completed) | `select user_uid, status, requested_at from account_deletions`. Completed records are kept 30 days. |
   | **B. Deletion ledger** (log events) | A deletion was requested, or completed, by Backlot | `account_deletion.requested` / `.completed` events carry the uid, never an email. Read them from the dedicated ledger bucket (below) or, until it exists, the `_Default` log bucket: `gcloud logging read 'jsonPayload.event=("account_deletion.requested" OR "account_deletion.completed")' --project=$PROJECT --freshness=<backup age + 1d> --format='value(jsonPayload.uid)' \| sort -u`. This is the only source for deletions that were requested but unfinished when the database was lost. |
   | **C. Firebase Authentication** | Only that the sign-in no longer exists | `node scripts/find-deleted-accounts-after-restore.ts` (read-only, against the restored instance). It stops without a list if more than 5% of accounts are missing, which points to a wrong project, tenant or sign-in migration rather than deletions. |

   **Decision rules:**
   - **Re-delete** a uid only when **A or B** confirms Backlot recorded a deletion for it. Then insert an `account_deletions` row in the restored database: `status='pending'`, empty `steps`, and a fresh token hash (operator SQL in docs/ACCOUNT_DELETION.md). That locks the account immediately (sign-in gate and write guard), before any traffic. Once the service points at the restored database, the worker deletes it again; confirm each record reaches `completed`.
   - **Never delete on C alone.** A missing Firebase user is also what a sign-in migration, a Firebase project or tenant mismatch, an identity-provider change, or a user removed in the Firebase console looks like. Disabled Firebase users still exist and are never candidates.
     - Leave C-only accounts untouched; nobody can sign in to them, so leaving them is safe while they're reviewed.
     - Investigate each one: Firebase audit logs, the support inbox for an emailed deletion request, and any migration history.
     - Re-delete only after the product owner confirms the evidence, and record the decision.
   - **A or B, but no rows in the restored copy:** nothing to do. Note it in the incident record.
   - Deleted media isn't affected: objects stay deleted unless they're restored from soft delete.
   - Creators who deleted their account don't get a new status link; the old one stops working. Answer enquiries from the ledger and the new record.

   **Deletion ledger: recommended before launch.** Without it, source B is the `_Default` log bucket: retention set project-wide (30 days by default, changeable by anyone with logging admin), mixed with every other log, and readable by every log viewer. Source A is gone in exactly the incidents that need a restore. A dedicated ledger needs no code change, because the events already exist. It's a log sink to its own bucket with its own retention and access:

   ```sh
   # Apply with approval. Retention: the oldest restorable backup (14 days) plus time to detect and
   # restore; 60 days suggested. That's how long account ids are kept, so the privacy page must say so.
   gcloud logging buckets create backlot-deletion-ledger --location=global --retention-days=60 --project=$PROJECT
   gcloud logging sinks create backlot-deletion-ledger \
     logging.googleapis.com/projects/$PROJECT/locations/global/buckets/backlot-deletion-ledger \
     --log-filter='jsonPayload.event=("account_deletion.requested" OR "account_deletion.completed")' --project=$PROJECT
   # Optionally lock retention so it can't be shortened: gcloud logging buckets update ... --locked
   # Grant read access (roles/logging.viewAccessor on that bucket's _AllLogs view) only to operators.
   ```

   Ledger retention must stay at least as long as the oldest restorable backup plus the restore lead time. If backup retention changes, change the ledger's too.

4. Point the service at the restored instance (`--add-cloudsql-instances`, `SQL_HOST`) as a new revision, check readiness, then keep the old instance until you're satisfied.
5. Media: restore objects from soft delete only for specific incidents (`gcloud storage restore`), never in bulk for deleted accounts.

| Responsibility | Who |
| --- | --- |
| Backup settings and monthly restore test | Operator (project owner) |
| Pre-migration backup | Whoever applies the migration |
| Decide to restore; re-apply deletions afterwards | Operator, following the steps above |
| Media recovery from soft delete | Operator, case by case; never for deleted accounts |
| Telling creators about data loss or a restore | Product owner |

## Remaining blockers

1. **Access:** an account with at least viewer access to the hosting project (and the Firebase project) is needed to finish discovery. Provisioning needs the admin roles listed above.
2. **Hosting project and deploy flow:** confirm which project hosts Cloud Run, and whether AI Studio redeploys preserve env vars, secrets and the service account. If they don't, settings must go through AI Studio, or deploys must move to gcloud.
3. **Runtime identity:** switch to `backlot-run` (and decide on the separate worker service).
4. **Secrets:** create the Secret Manager entries and remove any plain-text keys from the service.
5. **Bucket (L1):** create it, bind it, inventory and copy the existing uploads (after review).
6. **Migrations 1–7** with psql, in name order (DEPLOYMENT.md), after a fresh backup; then deploy, then create both Scheduler jobs.
7. **Backups:** verify or enable them, then put the retention period on the privacy page.
7a. **Deletion ledger:** create the dedicated log bucket and sink ("Restore procedure"), choose its retention, and state it on the privacy page.
8. **Budgets and alerts:** a billing budget, provider spend limits, and the log-based alerts above.
9. **Prices:** check the price table in `providers.ts` against current provider pricing before using `est_cost_usd`.
