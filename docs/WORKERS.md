# Background jobs

## Account deletion

| How it runs | When | Route | Auth |
| --- | --- | --- | --- |
| Prompt start, right after the request (Next.js `after()`) | ~3 minutes after the request (grace period) | inside `POST /api/account/deletion` | the signed-in creator's request |
| Recovery run (Vercel Cron, `vercel.json` `crons`) | Hourly (`0 * * * *`) | `GET /api/internal/account-deletions` | `Authorization: Bearer $CRON_SECRET` (Vercel sends it) |

Each recovery run also removes completed deletion records after `ACCOUNT_DELETION_RECORD_DAYS` (30) and ledger entries after `LEDGER_RETENTION_DAYS` (90). The prompt start finishes most deletions. It's best effort: if the function is cut short or a step fails, the job stays in `account_deletions` (with a lease and a retry time) and the hourly run resumes it. Nothing depends on a function finishing.

**Setup:** set `CRON_SECRET` (32+ random characters, `openssl rand -base64 48`) in Vercel for Production. The cron is created from `vercel.json` on the next production deploy; check it under Vercel → Settings → Cron Jobs. Crons run only on production deployments.

**Manual run:** `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/internal/account-deletions` returns `{ completed, retrying, recordsPurged, ledgerPurged }`.

## Maintenance (not scheduled)

`POST /api/internal/cleanup` expires stale Slate suggestions, applies retention, cancels abandoned uploads, sweeps orphaned R2 objects and purges old deletion records and ledger entries. It has no schedule. Run it by hand with `Authorization: Bearer $MAINTENANCE_SECRET` (a different secret from `CRON_SECRET`); without that secret the route returns 404. The R2 lifecycle rule (abort incomplete multipart uploads after 7 days) is the backstop for abandoned uploads.

## Safety

- **No double work:** each deletion job is claimed with a 10-minute lease (`FOR UPDATE SKIP LOCKED`), so the prompt start and the recovery run never process the same job at once, and a crashed run's lease expires.
- **Idempotent:** every step resumes where it stopped and is safe to repeat. A job is marked complete only after a final check finds nothing left.
- **Bounded:** the recovery run stops taking jobs after 90 s, inside its 120 s limit. The prompt start runs one job for up to 90 s after the 3-minute grace period, inside its 300 s limit.
- **Retries:** failed steps retry after 1, 5, 15, 30 and 60 minutes, then every 6 hours, indefinitely; the hourly run picks them up when due.
- **Auth:** without `CRON_SECRET` the route returns 404; a wrong or missing bearer gets 401. `CRON_SECRET` doesn't open the maintenance job.

## Monitoring

| Signal | Meaning |
| --- | --- |
| Vercel → Cron Jobs: a failed run | The app refused or failed the call (wrong secret, config error, outage) |
| `account_deletion.worker_failed` (ERROR) | The recovery run crashed |
| `account_deletion.prompt_start_failed` (WARNING) | The prompt start failed; the hourly run will resume the job |
| `account_deletion.retry` with `needs_attention: true` | A deletion has failed 4+ times; look at it |

Vercel keeps runtime logs only for a limited time, so also check `select status, count(*) from account_deletions group by 1` now and then.
