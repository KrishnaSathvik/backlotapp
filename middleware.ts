import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabasePublicConfig } from './src/lib/supabase/config';

/**
 * Keeps the Supabase session fresh. When the access token in the session cookies is expired,
 * getClaims() refreshes it with the refresh token, and the new cookies go both to this request
 * (so the route sees the fresh token) and to the browser (so it keeps it).
 *
 * This is NOT access control: route handlers verify identity themselves (requireUser), and the
 * app screen shows sign-in when there's no session.
 */
export async function middleware(request: NextRequest) {
  const config = supabasePublicConfig();
  // No Supabase session cookie: nothing to refresh (public pages, the demo, the scheduler's calls).
  if (!config || !request.cookies.getAll().some((c) => c.name.startsWith('sb-'))) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Don't put code between client creation and getClaims(): it must run on every matched request.
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the sign-in callback (it sets the session itself).
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)',
  ],
};
