'use client';

import React from 'react';
import { Columns3, Copy, Lightbulb, Sparkles } from 'lucide-react';
import { buttonStyles, cx, sizes } from './ui';

interface AuthGateProps {
  onGoogleSignIn: () => Promise<void>;
  onPreview: () => void;
  isSigningIn: boolean;
  errorMessage: string | null;
}

const FEATURES = [
  { icon: Copy, text: 'Captions and tags, copied in one tap' },
  { icon: Columns3, text: 'Track every post from idea to posted' },
  { icon: Lightbulb, text: 'Save links and screenshots for later' },
];

export const AuthGate: React.FC<AuthGateProps> = ({ onGoogleSignIn, onPreview, isSigningIn, errorMessage }) => {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-400/25 via-violet-400/15 to-transparent blur-3xl dark:from-blue-600/20 dark:via-violet-600/10"
      />

      <div className="relative w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-bold tracking-tight">Content Vault</span>
        </div>

        <h1 className="mt-8 text-3xl font-bold leading-tight tracking-tight text-balance">
          Every video, reel and caption — in one place.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          A private home for your YouTube and Instagram content.
        </p>

        <ul className="mt-6 space-y-3">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {errorMessage}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onGoogleSignIn}
          disabled={isSigningIn}
          className={cx(
            buttonStyles.secondary,
            sizes.lg,
            'mt-8 h-12 w-full text-[15px] shadow-sm'
          )}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
          </svg>
          {isSigningIn ? 'Signing in…' : 'Continue with Google'}
        </button>

        <button
          type="button"
          onClick={onPreview}
          className="mt-3 w-full py-2 text-center text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Try it without an account →
        </button>

        <p className="mt-6 text-center text-xs text-zinc-400">
          Private, single-account workspace. Preview data stays in this browser.
        </p>
      </div>
    </main>
  );
};
