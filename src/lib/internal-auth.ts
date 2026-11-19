import { timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { opsEvent } from './ops-log.ts';

/**
 * Authentication for the internal job endpoints (Launch L3). Each job has its own credentials, so
 * a leaked credential for one can't trigger the other:
 *
 * | Job          | Route                                | OIDC invoker env          | Bearer secret env (fallback)          |
 * | ------------ | ------------------------------------ | ------------------------- | ------------------------------------- |
 * | `deletions`  | POST /api/internal/account-deletions | DELETION_WORKER_INVOKER   | DELETION_WORKER_SECRET                |
 * | `maintenance`| POST /api/internal/cleanup           | MAINTENANCE_INVOKER       | MAINTENANCE_SECRET (or CLEANUP_SECRET)|
 *
 * Production on Vercel: the bearer secrets below, sent by the Cloudflare Worker scheduler
 * (ops/scheduler, docs/WORKERS.md).
 *
 * Optional (legacy Google Cloud): Cloud Scheduler OIDC. Set INTERNAL_OIDC_AUDIENCE (the service URL the scheduler
 * job targets, e.g. https://backlot-xyz.a.run.app) and the invoker service-account email per
 * job. The token must be Google-signed, for that audience, from exactly that service account,
 * with a verified email. Nothing else to rotate.
 *
 * Bearer secret: `Authorization: Bearer <secret>`, 32+ characters, compared in constant time.
 *
 * A job with neither configured is disabled (404).
 */

export type InternalJob = 'deletions' | 'maintenance';

const CONFIG: Record<InternalJob, { invokerEnv: string; secretEnvs: string[] }> = {
  deletions: { invokerEnv: 'DELETION_WORKER_INVOKER', secretEnvs: ['DELETION_WORKER_SECRET'] },
  maintenance: { invokerEnv: 'MAINTENANCE_INVOKER', secretEnvs: ['MAINTENANCE_SECRET', 'CLEANUP_SECRET'] },
};

type Env = Record<string, string | undefined>;

export function internalAuthConfig(job: InternalJob, env: Env = process.env) {
  const c = CONFIG[job];
  const audience = env.INTERNAL_OIDC_AUDIENCE?.trim() || '';
  const invoker = env[c.invokerEnv]?.trim().toLowerCase() || '';
  const secret = c.secretEnvs.map((k) => env[k] ?? '').find((v) => v.length > 0) ?? '';
  return {
    oidc: audience && invoker ? { audience, invoker } : null,
    secret: secret.length >= 32 ? secret : '',
    /** A secret was set but is too short to be accepted. */
    weakSecret: secret.length > 0 && secret.length < 32,
  };
}

export interface OidcVerifier {
  verify(token: string, audience: string): Promise<{ email?: string; email_verified?: boolean } | null>;
}

let client: OAuth2Client | null = null;
const googleVerifier: OidcVerifier = {
  async verify(token, audience) {
    client ??= new OAuth2Client();
    const ticket = await client.verifyIdToken({ idToken: token, audience });
    return ticket.getPayload() ?? null;
  },
};

const looksLikeJwt = (t: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t);

function secretMatches(given: string, secret: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns an error response, or null when the request is allowed. */
export async function authorizeInternal(
  request: Request,
  job: InternalJob,
  deps: { env?: Env; verifier?: OidcVerifier } = {}
): Promise<Response | null> {
  const cfg = internalAuthConfig(job, deps.env);
  if (!cfg.oidc && !cfg.secret) return Response.json({ error: 'Not found.' }, { status: 404 });
  const unauthorized = (reason: string) => {
    opsEvent('internal_auth.denied', { job, reason }, 'WARNING');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  };

  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!given) return unauthorized('missing');

  if (cfg.oidc && looksLikeJwt(given)) {
    try {
      const payload = await (deps.verifier ?? googleVerifier).verify(given, cfg.oidc.audience);
      if (payload?.email_verified && payload.email?.toLowerCase() === cfg.oidc.invoker) return null;
      return unauthorized('oidc_wrong_identity');
    } catch {
      return unauthorized('oidc_invalid');
    }
  }
  if (cfg.secret && secretMatches(given, cfg.secret)) return null;
  return unauthorized('bad_credentials');
}
