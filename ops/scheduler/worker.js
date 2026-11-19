/**
 * Backlot job scheduler: a Cloudflare Worker with Cron Triggers (docs/WORKERS.md).
 *
 * Vercel Hobby cron jobs run at most once a day, and every Vercel cron job shares one
 * CRON_SECRET. Backlot needs the account-deletion worker every 5 minutes and the maintenance job
 * daily, each with its OWN credential. This Worker calls both endpoints with POST and a
 * separate bearer secret per job. It holds no data and touches nothing else.
 *
 * Secrets (wrangler secret put …): DELETION_WORKER_SECRET, MAINTENANCE_SECRET — the same
 * values as the Vercel env vars of the same names (32+ random characters each, different).
 * Var: BACKLOT_ORIGIN, e.g. "https://backlot.example" (production origin only).
 *
 * Overlapping or repeated calls are safe: deletion jobs are leased (SKIP LOCKED) and every
 * maintenance step is idempotent. A failed call is simply retried at the next tick; failures
 * are logged here (Workers Logs) and by the app (`account_deletion.worker_failed`).
 */

const JOBS = {
  '*/5 * * * *': { path: '/api/internal/account-deletions', secret: 'DELETION_WORKER_SECRET', timeoutMs: 130_000 },
  '17 4 * * *': { path: '/api/internal/cleanup', secret: 'MAINTENANCE_SECRET', timeoutMs: 190_000 },
};

async function run(job, env) {
  const origin = String(env.BACKLOT_ORIGIN || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(origin)) throw new Error('BACKLOT_ORIGIN must be an https:// origin');
  const token = env[job.secret];
  if (!token || token.length < 32) throw new Error(`${job.secret} is not set`);
  const res = await fetch(origin + job.path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'backlot-scheduler',
      // Staging only: Vercel Deployment Protection blocks unauthenticated requests to Preview
      // deployments; "Protection Bypass for Automation" issues this secret. Unset in production.
      ...(env.VERCEL_PROTECTION_BYPASS ? { 'x-vercel-protection-bypass': env.VERCEL_PROTECTION_BYPASS } : {}),
    },
    // A little longer than the route's maxDuration (vercel.json: 120 s / 180 s).
    signal: AbortSignal.timeout(job.timeoutMs),
  });
  const text = await res.text();
  // Counts only: the endpoints never return content.
  console.log(JSON.stringify({ job: job.path, status: res.status, body: text.slice(0, 300) }));
  if (!res.ok) throw new Error(`${job.path} answered ${res.status}`);
}

const scheduler = {
  async scheduled(event, env, ctx) {
    const job = JOBS[event.cron];
    if (!job) {
      console.log(JSON.stringify({ unknown_cron: event.cron }));
      return;
    }
    ctx.waitUntil(run(job, env));
  },
  // No public HTTP surface.
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};

export default scheduler;
