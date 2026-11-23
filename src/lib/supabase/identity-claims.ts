/**
 * Maps verified Supabase access-token claims to Backlot's identity. Pure (no network), so the
 * rules are unit-tested: src/lib/supabase-auth.test.ts.
 */

export interface VerifiedIdentity {
  /** Supabase Auth user id (a UUID), stored in Backlot's text uid columns. */
  uid: string;
  email: string;
  /** When the user last actually signed in (seconds since epoch). Token refreshes don't change it. */
  authTime: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identityFromClaims(claims: unknown): VerifiedIdentity | null {
  if (!claims || typeof claims !== 'object') return null;
  const c = claims as Record<string, unknown>;
  // Only real signed-in users: not the anon/service roles, not anonymous sign-ins.
  if (c.role !== 'authenticated' || c.is_anonymous === true) return null;
  if (typeof c.sub !== 'string' || !UUID.test(c.sub)) return null;
  return {
    uid: c.sub.toLowerCase(),
    email: typeof c.email === 'string' ? c.email : '',
    authTime: lastAuthentication(c.amr),
  };
}

/**
 * `amr` lists how and when this session authenticated ([{ method: 'oauth', timestamp }]); a
 * refresh keeps it. The newest entry is the last real sign-in. Missing or malformed means 0,
 * which the account-deletion route treats as "sign in again".
 */
function lastAuthentication(amr: unknown): number {
  if (!Array.isArray(amr)) return 0;
  let latest = 0;
  for (const entry of amr) {
    const t = (entry as { timestamp?: unknown })?.timestamp;
    if (typeof t === 'number' && Number.isFinite(t) && t > latest) latest = t;
  }
  return latest;
}
