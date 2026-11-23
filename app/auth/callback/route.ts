import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { supabasePublicConfig } from '@/src/lib/supabase/config.ts';
import { safeNextPath } from '@/src/lib/supabase/redirect.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';

/**
 * Sign-in, last step (PKCE), for the Google redirect fallback.
 * Google → Supabase Auth → here with `?code=…`. The code is
 * exchanged for a session using the verifier @supabase/ssr stored in a cookie when sign-in
 * started, so a code alone (stolen or replayed) is useless. The session is written as cookies
 * on the redirect, then the browser goes to `next` (a path on this site only).
 *
 * Must be in Supabase → Authentication → URL Configuration → Redirect URLs.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get('next'));
  const fail = (reason: string) => {
    const url = new URL('/app', origin);
    url.searchParams.set('auth_error', reason);
    return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
  };

  // The person cancelled at Google, or Supabase refused the request.
  if (searchParams.get('error')) {
    opsEvent('auth.callback_error', { reason: (searchParams.get('error_code') || searchParams.get('error') || '').slice(0, 64) }, 'NOTICE');
    return fail(searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed');
  }
  const code = searchParams.get('code');
  const config = supabasePublicConfig();
  if (!code || !config) return fail('failed');

  const response = NextResponse.redirect(new URL(next, origin), { headers: { 'Cache-Control': 'no-store' } });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    opsEvent('auth.callback_error', { reason: errorKind(error) }, 'NOTICE');
    return fail('failed');
  }
  return response;
}
