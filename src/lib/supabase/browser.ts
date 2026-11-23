'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabasePublicConfig } from './config.ts';

/**
 * The browser's Supabase Auth client. @supabase/ssr keeps the session in cookies (PKCE flow), so
 * the server sees the same session, and refreshes the access token before it expires.
 * Only `.auth` is used: data goes through Backlot's own API routes.
 */
let client: SupabaseClient | null = null;

/** The signed-in person, from the Supabase session (the server re-verifies every request). */
export interface AuthUser {
  uid: string;
  email: string;
  /** Has a linked Google identity (else email-link only): decides how "sign in again" works. */
  hasGoogle: boolean;
}

/**
 * Marks a "sign in again to delete" round trip (the full-page Google redirect), so the app
 * reopens Delete account on return. Expires after 15 minutes.
 */
const REAUTH_DELETE_KEY = 'cv_reauth_delete';
const REAUTH_TTL_MS = 15 * 60 * 1000;

export function setReauthIntent(uid: string) {
  try {
    window.localStorage.setItem(REAUTH_DELETE_KEY, JSON.stringify({ uid, at: Date.now() }));
  } catch {
    // Storage unavailable: they'll land on the app and can open Delete account again.
  }
}

/** Returns (and clears) the uid that started a re-sign-in, if recent. */
export function takeReauthIntent(): string | null {
  try {
    const raw = window.localStorage.getItem(REAUTH_DELETE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(REAUTH_DELETE_KEY);
    const v = JSON.parse(raw) as { uid?: unknown; at?: unknown };
    return typeof v.uid === 'string' && typeof v.at === 'number' && Date.now() - v.at < REAUTH_TTL_MS ? v.uid : null;
  } catch {
    return null;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Backlot's minimum for new passwords (Supabase's own minimum may be lower; this is checked first). */
export const MIN_PASSWORD_LENGTH = 8;

/** Messages for email/password sign-up and sign-in. They never say whether an account exists. */
function passwordAuthError(error: { status?: number; code?: string; message?: string }, mode: 'signup' | 'signin'): Error {
  const code = error.code ?? '';
  if (error.status === 429 || code.startsWith('over_')) return new Error('Too many attempts. Wait a few minutes, then try again.');
  if (code === 'weak_password') return new Error(error.message?.trim() || 'Choose a stronger password.');
  if (code === 'email_address_invalid' || code === 'validation_failed') return new Error('Enter a valid email address.');
  if (mode === 'signup' && (code === 'user_already_exists' || code === 'email_exists')) {
    return new Error('Couldn’t create an account with that email. If you already have one, sign in instead.');
  }
  if (mode === 'signin' && (code === 'invalid_credentials' || error.status === 400)) return new Error('Email or password is incorrect.');
  return new Error(mode === 'signup' ? 'Couldn’t create your account. Try again.' : 'Couldn’t sign you in. Try again.');
}

function checkEmail(email: string): string {
  const address = email.trim();
  if (!EMAIL.test(address) || address.length > 254) throw new Error('Enter a valid email address.');
  return address;
}

/**
 * Creates an account with email and password. Email confirmation is off in this project (owner
 * decision), so Supabase signs the person in straight away and sends no email.
 */
export async function signUpWithPassword(email: string, password: string): Promise<void> {
  const address = checkEmail(email);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  if (password.length > 72) throw new Error('Use 72 characters or fewer for your password.');
  const { data, error } = await supabaseBrowser().auth.signUp({ email: address, password });
  if (error) throw passwordAuthError(error, 'signup');
  // With confirmation off a session comes back. Without one, the address may already be taken
  // (Supabase hides that) or confirmation was turned back on: same neutral message either way.
  if (!data.session) throw new Error('Couldn’t create an account with that email. If you already have one, sign in instead.');
}

/** Signs in with email and password. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const address = checkEmail(email);
  if (!password) throw new Error('Enter your password.');
  const { error } = await supabaseBrowser().auth.signInWithPassword({ email: address, password });
  if (error) throw passwordAuthError(error, 'signin');
}

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  const config = supabasePublicConfig();
  if (!config) throw new Error('Sign-in is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).');
  client = createBrowserClient(config.url, config.publishableKey);
  return client;
}

/** Where Google sends the browser back to: our callback, then `next` (a same-site path). */
export function oauthRedirectTo(next: string): string {
  const url = new URL('/auth/callback', window.location.origin);
  url.searchParams.set('next', next);
  return url.toString();
}

/** Starts Google sign-in. The page navigates away to Google; it doesn't resolve on success. */
export async function signInWithGoogle(next: string, opts: { selectAccount?: boolean } = {}): Promise<void> {
  const { error } = await supabaseBrowser().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: oauthRedirectTo(next),
      ...(opts.selectAccount ? { queryParams: { prompt: 'select_account' } } : {}),
    },
  });
  if (error) throw error;
}

/**
 * Signs in with a Google ID token from Google's own button (src/lib/google-identity.ts).
 * Supabase verifies the token's signature, audience (an allowed Google client id) and nonce.
 */
export async function signInWithGoogleIdToken(credential: { idToken: string; nonce: string }) {
  const { data, error } = await supabaseBrowser().auth.signInWithIdToken({
    provider: 'google',
    token: credential.idToken,
    nonce: credential.nonce,
  });
  if (error) throw error;
  return data;
}

/** The Google account id (`sub`) linked to the current Supabase user, if any. */
export async function currentGoogleAccountId(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  const google = data.session?.user.identities?.find((i) => i.provider === 'google');
  const sub = google?.identity_data?.sub ?? google?.identity_data?.provider_id ?? google?.id;
  return typeof sub === 'string' ? sub : null;
}
