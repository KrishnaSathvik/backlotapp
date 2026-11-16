'use client';

import React from 'react';
import { Lock, Play } from 'lucide-react';

interface AuthGateProps {
  onGoogleSignIn: () => Promise<void>;
  isSigningIn: boolean;
  errorMessage: string | null;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  onGoogleSignIn,
  isSigningIn,
  errorMessage,
}) => {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white dark:bg-white dark:text-zinc-950">
            <Play className="h-4 w-4 fill-blue-600 text-blue-600" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              Content Vault
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Private Creator Content Tracker
            </p>
          </div>
        </div>

        <h2 className="mt-6 text-2xl font-bold tracking-tight text-zinc-950 text-balance dark:text-zinc-50">
          All your videos, reels, carousels, captions, and ideas in one place.
        </h2>

        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
          Organize YouTube Long, Shorts, Reels, and carousels across your channels. Track production from idea to posted, copy captions with one tap, and download files anytime.
        </p>

        {errorMessage ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6">
          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={isSigningIn}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>

        <p className="mt-5 text-xs text-zinc-500 dark:text-zinc-400">
          Private single-account workspace. Sign in with Google to access your channels, posts, files, and saved ideas.
        </p>
      </div>
    </main>
  );
};
