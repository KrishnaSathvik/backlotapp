/**
 * Supabase Auth settings (identity only: Backlot's data goes through Drizzle and the
 * `backlot_app` role, never the Supabase Data API, which stays disabled).
 *
 * - NEXT_PUBLIC_SUPABASE_URL: https://<project-ref>.supabase.co
 * - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sb_publishable_… (public by design; the legacy anon JWT
 *   also works). Inlined into the browser bundle at build time.
 * - SUPABASE_SECRET_KEY: sb_secret_… (or the legacy service_role JWT). Server only: account
 *   deletion uses it to revoke sign-ins and delete the Auth user. Never prefix it NEXT_PUBLIC_.
 */

type Env = Record<string, string | undefined>;

export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

// The literal process.env.NEXT_PUBLIC_… references are what Next.js inlines into the browser.
export function supabasePublicConfig(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
): SupabasePublicConfig | null {
  const u = url?.trim();
  const k = key?.trim();
  return u && k ? { url: u.replace(/\/+$/, ''), publishableKey: k } : null;
}

/** Problems with the Supabase Auth settings, by name (never a value). */
export function checkSupabaseAuthConfig(env: Env): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();

  if (!url) errors.push('NEXT_PUBLIC_SUPABASE_URL is not set: nobody can sign in.');
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL must be the project URL, https://<project-ref>.supabase.co.');
  }
  if (!key) errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set: nobody can sign in.');
  else if (key.startsWith('sb_secret_') || isServiceRoleJwt(key)) {
    errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key, which would be sent to every browser. Use the publishable key.');
  }

  if (!secret) errors.push('SUPABASE_SECRET_KEY is not set: account deletion cannot remove sign-ins.');
  else if (secret.startsWith('sb_publishable_') || (secret.split('.').length === 3 && !isServiceRoleJwt(secret))) {
    errors.push('SUPABASE_SECRET_KEY is a publishable key; account deletion needs the secret key.');
  }

  const google = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!google) warnings.push('NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set: Google sign-in uses the redirect flow (Google names the Supabase domain).');
  else if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(google)) errors.push('NEXT_PUBLIC_GOOGLE_CLIENT_ID must be a Google OAuth client id (<id>.apps.googleusercontent.com).');

  for (const name of Object.keys(env)) {
    if (name.startsWith('NEXT_PUBLIC_') && /SECRET|SERVICE_ROLE/i.test(name)) {
      errors.push(`${name}: a secret must never use the NEXT_PUBLIC_ prefix (it would be sent to every browser).`);
    }
  }
  return { errors, warnings };
}

function isServiceRoleJwt(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}
