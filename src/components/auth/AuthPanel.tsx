'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  MIN_PASSWORD_LENGTH,
  signInWithGoogle,
  signInWithGoogleIdToken,
  signInWithPassword,
  signUpWithPassword,
} from '@/src/lib/supabase/browser';
import type { GoogleCredential } from '@/src/lib/google-identity';
import type { PlatformKey } from '@/src/lib/content-logic';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { PlatformIcon } from '../PlatformIcon';
import { LogoMark } from '../site/Logo';

export type AuthMode = 'signup' | 'signin';

const COPY: Record<AuthMode, { title: string; body: string; switchPrompt: string; switchAction: string }> = {
  signup: {
    title: 'Create your Backlot account',
    body: 'Keep your content, ideas, and files together in one place.',
    switchPrompt: 'Already have an account?',
    switchAction: 'Sign in',
  },
  signin: {
    title: 'Welcome back',
    body: 'Sign in to pick up where you left off.',
    switchPrompt: 'New to Backlot?',
    switchAction: 'Sign up',
  },
};

const PLATFORMS: Array<{ key: PlatformKey; label: string }> = [
  { key: 'youtube_long', label: 'YouTube' },
  { key: 'instagram_reel', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
];

export function authTitle(mode: AuthMode) {
  return COPY[mode].title;
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;
}

/**
 * Backlot sign-in / sign-up, shared by the landing-page dialog and the full-page fallback (/app
 * when signed out). Two methods: Google (its own button → ID token, or the redirect flow as a
 * fallback; the account is created on first sign-in, so the mode only changes the wording) and
 * email + password (sign-up: signUp, sign-in: signInWithPassword). No magic links, no password
 * reset (owner decision).
 */
export function AuthPanel({
  mode,
  onModeChange,
  next,
  onSignedIn,
  initialError = null,
  titleId,
  titleAs: Title = 'h2',
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  /** Same-site path to land on after sign-in. */
  next: string;
  /**
   * Called after a Google ID-token sign-in completes in place. Omit to navigate to `next`
   * (the /app screen passes a no-op: its auth listener takes over).
   */
  onSignedIn?: () => void;
  /** A message to show first, e.g. from a failed sign-in redirect. */
  initialError?: string | null;
  titleId?: string;
  titleAs?: 'h1' | 'h2';
}) {
  const copy = COPY[mode];
  const [error, setError] = useState<string | null>(initialError);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const busy = googleBusy || submitting;
  const id = titleId ?? 'auth';

  /** Google's own button returned an ID token: exchange it for a Supabase session. */
  const onCredential = async (credential: GoogleCredential) => {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogleIdToken(credential);
      if (onSignedIn) {
        onSignedIn();
        setGoogleBusy(false);
      } else {
        window.location.assign(next); // stays busy until the page changes
      }
    } catch (err) {
      setError(err instanceof Error ? `Google sign-in failed: ${err.message}` : 'Google sign-in failed. Try again.');
      setGoogleBusy(false);
    }
  };

  /** Redirect flow (when Google's button can't load). Navigates away to Google on success. */
  const onRedirect = async () => {
    setError(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in couldn’t start. Try again.');
      setGoogleBusy(false);
    }
  };

  /** Email and password: create the account (sign-up) or sign in. */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFormError(null);
    if (mode === 'signup' && password !== confirm) {
      setFormError('The passwords don’t match.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'signup') await signUpWithPassword(email, password);
      else await signInWithPassword(email, password);
      if (onSignedIn) {
        onSignedIn();
        setSubmitting(false);
      } else {
        window.location.assign(next); // stays busy until the page changes
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setFormError(null);
    setConfirm('');
    onModeChange(mode === 'signup' ? 'signin' : 'signup');
  };

  const field =
    'h-12 w-full min-w-0 rounded-2xl border border-border bg-surface-2 px-4 text-base text-text lg:text-[15px] outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60';
  const label = 'mb-1.5 block text-[13px] font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <div>
      <LogoMark className="h-11 w-11" />
      <div aria-live="polite">
        <Title id={titleId} className="mt-5 text-[28px] font-extrabold leading-[1.08] tracking-tight text-balance sm:text-[34px]">
          {copy.title}
        </Title>
        <p className="mt-2 text-[15px] leading-relaxed text-zinc-600 sm:text-base dark:text-zinc-400">{copy.body}</p>
      </div>

      <ul aria-label="Works with" className="mt-5 flex flex-wrap items-center gap-2">
        {PLATFORMS.map((p) => (
          <li
            key={p.key}
            className="flex h-8 items-center gap-1.5 rounded-full bg-surface-2 pl-1.5 pr-3 text-[12px] font-semibold text-muted"
          >
            <PlatformIcon platform={p.key} size={18} colored />
            {p.label}
          </li>
        ))}
      </ul>

      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      <GoogleSignInButton className="mt-6" busy={googleBusy} onCredential={onCredential}>
        <button
          type="button"
          onClick={onRedirect}
          disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white text-[15px] font-semibold text-zinc-900 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md group-hover:border-zinc-300 group-hover:shadow-md disabled:pointer-events-none disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:border-zinc-600 dark:group-hover:border-zinc-600"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white dark:ring-1 dark:ring-zinc-700">
            <GoogleG />
          </span>
          {googleBusy ? (
            <>
              <Spinner />
              Signing in…
            </>
          ) : (
            'Continue with Google'
          )}
        </button>
      </GoogleSignInButton>

      <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <form onSubmit={submit} noValidate className="space-y-3.5" aria-describedby={formError ? `${id}-form-error` : undefined}>
        <div>
          <label htmlFor={`${id}-email`} className={label}>
            Email
          </label>
          <input
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
            className={field}
          />
        </div>
        <div>
          <label htmlFor={`${id}-password`} className={label}>
            Password
          </label>
          <div className="relative">
            <input
              id={`${id}-password`}
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              aria-describedby={mode === 'signup' ? `${id}-password-hint` : undefined}
              className={`${field} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          {mode === 'signup' ? (
            <p id={`${id}-password-hint`} className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          ) : null}
        </div>
        {mode === 'signup' ? (
          <div>
            <label htmlFor={`${id}-confirm`} className={label}>
              Confirm password
            </label>
            <input
              id={`${id}-confirm`}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              required
              className={field}
            />
          </div>
        ) : null}

        {formError ? (
          <p id={`${id}-form-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !email.trim() || !password || (mode === 'signup' && !confirm)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-electric-600 text-[15px] font-semibold text-white shadow-lg shadow-electric-600/20 transition-colors hover:bg-electric-500 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? <Spinner /> : null}
          {submitting ? (mode === 'signup' ? 'Creating account…' : 'Signing in…') : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {copy.switchPrompt}{' '}
        <button
          type="button"
          onClick={switchMode}
          className="rounded font-semibold text-electric-700 underline-offset-2 hover:underline dark:text-electric-400"
        >
          {copy.switchAction}
        </button>
      </p>

      <p className="mt-4 border-t border-zinc-100 pt-4 text-center text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        By continuing, you agree to Backlot’s{' '}
        <Link href="/terms" className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
