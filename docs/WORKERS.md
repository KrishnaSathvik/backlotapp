# Scheduled jobs

**Not deployed.** Account deletion is **not operational** until the scheduler below is running. Until then, a deletion request locks the account immediately but its data is never removed.

## The two jobs

| Job | Schedule | Call | Credential |
| --- | --- | --- | --- |
| Account deletions | Every 5 minutes | `POST /api/internal/account-deletions` | `Authorization: Bearer $DELETION_WORKER_SECRET` |
| Maintenance (expired Slate proposals, retention, abandoned uploads, orphan sweep, deletion records, ledger purge) | Daily (04:17 UTC) | `POST /api/internal/cleanup` | `Authorization: Bearer $MAINTENANCE_SECRET` |

Each secret is 32+ random characters (`openssl rand -base64 48`), and the two must differ. The config check refuses to start production otherwise. A job with no credential is disabled (404). Set the same values in Vercel env vars and in the scheduler.

Cloud Scheduler OIDC (`INTERNAL_OIDC_AUDIENCE` and the invoker env vars) is still supported, but it's optional and not used in this setup.

## Why not Vercel Cron

- **Hobby:** cron jobs run at most once a day (verify), so the 5-minute deletion job can't run there.
- **Every plan:** all cron jobs share a single `CRON_SECRET`, and Vercel calls them with GET. Backlot's jobs are POST-only and have separate credentials, so a leaked credential for one can't trigger the other. Using Vercel Cron (even on Pro) would need code changes and would weaken that separation.

## Chosen scheduler: Cloudflare Worker (ops/scheduler)

`ops/scheduler/worker.js` and `wrangler.toml` define a Worker with Cron Triggers (`*/5 * * * *` and `17 4 * * *`). It POSTs to the right endpoint with that job's secret and logs the status code and counts. It has no public URL (`workers_dev = false`) and holds no data. Cron Triggers are available on Workers Free (verify current limits).

Deploy (after approval):

```sh
cd ops/scheduler
# set BACKLOT_ORIGIN in wrangler.toml to the production https origin
npx wrangler login
npx wrangler secret put DELETION_WORKER_SECRET
npx wrangler secret put MAINTENANCE_SECRET
npx wrangler deploy
```

Check: in the Worker's logs, the next 5-minute tick shows `status: 200`. In the app logs, `account_deletion.worker_run` appears when there was work, and `internal_auth.denied` doesn't appear.

To pause a job (for example maintenance during a restore), remove its cron from `wrangler.toml` and run `npx wrangler deploy`, or disable the trigger in the dashboard.

### Alternatives

| Option | Notes |
| --- | --- |
| cron-job.org (or a similar HTTPS cron) | Can POST with a custom header every 5 minutes. A third party then holds both secrets. |
| GitHub Actions `schedule` | Not reliable at 5 minutes: runs are often delayed or skipped. Acceptable for the daily job only. |
| Vercel Pro cron | Not suitable without code changes (shared secret, GET). See above. |

## Safety

- **No double work:** each deletion job is claimed with a lease (`FOR UPDATE SKIP LOCKED`), so overlapping calls never run the same job, and a crashed worker's lease expires.
- **Idempotent:** every deletion step is idempotent and resumes where it stopped, and every maintenance part is safe to repeat.
- **Within the limit:** the deletion worker stops taking new jobs after 90 s, inside the route's `maxDuration` of 120 s; maintenance has 180 s for bounded batches. Both are below the 300 s Hobby maximum with Fluid compute (verify in the Vercel dashboard), and a deletion run always ends before the next 5-minute tick. If a run is cut off mid-job, the job's 10-minute lease expires and the next run resumes it. The scheduler waits 130 s and 190 s respectively for the response.
- **Nothing after the response:** all work finishes before the HTTP response. No background promise is relied on after a function returns.
- **Failure:** a failed call is simply retried at the next tick. Deletion jobs retry with backoff indefinitely; they never give up silently.

## Monitoring

| Signal | Meaning |
| --- | --- |
| Worker logs: non-200 status | The app refused or failed the call (wrong secret, config error, outage) |
| `account_deletion.worker_failed` (ERROR) | The deletion worker crashed |
| `account_deletion.retry` with `needs_attention: true` | A deletion has failed 4+ times; look at it |
| `maintenance.run` with `failed` set | A maintenance part failed |
| `storage.orphan_sweep_refused` (CRITICAL) | The sweep saw a suspicious orphan pattern (wrong or restored database) and deleted nothing |
| `storage.app_usage_high` / `storage.app_ceiling_reached` | Approaching or at the app-wide storage ceiling |

Vercel Hobby keeps runtime logs only briefly (verify the current retention), so app events can't drive alerts on their own. Options: a log drain (paid plans), or rely on the Worker's logs, Cloudflare's notifications for Worker errors, and a weekly look at `select status, count(*) from account_deletions group by 1`.
