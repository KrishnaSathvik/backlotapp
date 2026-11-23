'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, signInWithPassword, signUpWithPassword } from '@/src/lib/supabase/browser';
import type { PlatformKey } from '@/src/lib/content-logic';
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

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;
}

/**
 * Backlot sign-in / sign-up, shared by the landing-page dialog and the full-page fallback (/app
 * when signed out). Email and password only (sign-up: signUp, sign-in: signInWithPassword).
 * Google sign-in is hidden for now. No magic links, no password reset (owner decision).
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
   * Called after email sign-in completes in place. Omit to navigate to `next`
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const id = titleId ?? 'auth';

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

      <form onSubmit={submit} noValidate className="mt-6 space-y-3.5" aria-describedby={formError ? `${id}-form-error` : undefined}>
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
            disabled={submitting}
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
              disabled={submitting}
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
              disabled={submitting}
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
          disabled={submitting || !email.trim() || !password || (mode === 'signup' && !confirm)}
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
