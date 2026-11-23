import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { supabasePublicConfig } from './config.ts';
import { identityFromClaims, type VerifiedIdentity } from './identity-claims.ts';

/**
 * Server-side identity: verifies the Supabase access token (signature, expiry, issuer) with
 * auth.getClaims(). With the project's asymmetric signing keys that's local, against Supabase's
 * cached public keys; with a legacy symmetric key it asks Supabase Auth. The uid is always taken
 * from the verified token, never from anything else the browser sends.
 *
 * The token comes from `Authorization: Bearer` (API calls from the app) or, failing that, the
 * session cookies @supabase/ssr sets (plain <img>/<video> requests to /api/files).
 */

let bearerClient: SupabaseClient | null = null;

function requireConfig() {
  const config = supabasePublicConfig();
  if (!config) throw new Error('Supabase Auth is not configured.');
  return config;
}

function statelessClient(): SupabaseClient {
  if (bearerClient) return bearerClient;
  const { url, publishableKey } = requireConfig();
  bearerClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return bearerClient;
}

function readBearer(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** The verified identity, or null for no/invalid/expired credentials. Throws only on misconfiguration. */
export async function verifyRequestIdentity(request: NextRequest): Promise<VerifiedIdentity | null> {
  const bearer = readBearer(request);
  if (bearer) {
    const client = statelessClient(); // misconfiguration throws here (503), not as "signed out"
    return claimsOrNull(() => client.auth.getClaims(bearer));
  }

  const { url, publishableKey } = requireConfig();
  // Route handlers only read the session here; middleware.ts refreshes and rewrites the cookies.
  const supabase = createServerClient(url, publishableKey, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => undefined },
  });
  return claimsOrNull(() => supabase.auth.getClaims());
}

/**
 * Any verification failure means "not signed in" (fail closed). supabase-js returns an error for
 * most bad tokens but throws a plain Error for undecodable ones, so both end up here.
 */
async function claimsOrNull(
  get: () => Promise<{ data: { claims: unknown } | null; error: unknown }>
): Promise<VerifiedIdentity | null> {
  try {
    const { data, error } = await get();
    return error || !data ? null : identityFromClaims(data.claims);
  } catch {
    return null;
  }
}
