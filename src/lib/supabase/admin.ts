import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabasePublicConfig } from './config.ts';

/**
 * Supabase Auth admin client: server only (account deletion and the restore helper). Uses
 * SUPABASE_SECRET_KEY, which bypasses all access rules, so it's never imported by browser code
 * and only `.auth.admin` is used. Created lazily: routes that don't delete accounts don't need it.
 */
let admin: SupabaseClient | null = null;

export function supabaseAdmin(env: Record<string, string | undefined> = process.env): SupabaseClient {
  if (admin) return admin;
  const config = supabasePublicConfig(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!config?.url || !secret) throw new Error('Supabase Auth admin is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY).');
  admin = createClient(config.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}
