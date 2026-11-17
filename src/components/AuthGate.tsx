'use client';

import React from 'react';
import { ArrowRight, Check, Columns3, Copy, Lightbulb, Lock, Sparkles } from 'lucide-react';
import { cx } from './ui';
import { LogoMark } from './site/Logo';
import { SiteFooter, SiteHeader } from './site/SiteChrome';

interface AuthGateProps {
  onGoogleSignIn: () => Promise<void>;
  onPreview: () => void;
  isSigningIn: boolean;
  errorMessage: string | null;
}

const POINTS = [
  { icon: Copy, title: 'One-tap copy', text: 'Captions and hashtags, ready to paste.' },
  { icon: Columns3, title: 'Idea → Posted', text: 'Every post’s stage at a glance.' },
  { icon: Lightbulb, title: 'Ideas inbox', text: 'Links, screenshots and notes for later.' },
  { icon: Sparkles, title: 'Studio AI', text: 'Hooks and captions from your own vault.' },
];

export const AuthGate: React.FC<AuthGateProps> = ({ onGoogleSignIn, onPreview, isSigningIn, errorMessage }) => {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="relative flex-1">

        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          {/* Sign-in card */}
          <div className="mx-auto w-full max-w-md animate-rise">
            <div className="rounded-[28px] border border-zinc-200 bg-white/90 p-7 shadow-[0_30px_80px_-40px_rgba(10,20,60,0.35)] backdrop-blur sm:p-9 dark:border-zinc-800 dark:bg-zinc-900/80">
              <LogoMark className="h-11 w-11" />
              <h1 className="mt-6 text-[34px] font-extrabold leading-[1.02] sm:text-[40px]">
                Welcome to your <span className="text-electric-600 dark:text-electric-400">vault.</span>
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Sign in to keep every video, reel, carousel and caption in one private place.
              </p>

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
                className="mt-8 flex h-13 w-full items-center justify-center gap-3 rounded-2xl bg-zinc-950 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-zinc-950/20 transition-all hover:-translate-y-0.5 hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-100"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                  </svg>
                </span>
                {isSigningIn ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  'Continue with Google'
                )}
              </button>

              <div className="my-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                or
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>

              <button
                type="button"
                onClick={onPreview}
                className="group flex w-full items-center justify-between rounded-2xl border border-zinc-200 px-4 py-3.5 text-left transition-all hover:border-electric-400 hover:bg-electric-50/60 dark:border-zinc-800 dark:hover:border-electric-700 dark:hover:bg-electric-950/30"
              >
                <span>
                  <span className="block text-[15px] font-semibold">Try the demo</span>
                  <span className="block text-[13px] text-zinc-500">No account, sample content included</span>
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cantaloupe-500 text-white transition-transform group-hover:translate-x-0.5">
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>

              <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-zinc-500">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Your vault is private to your Google account.
              </p>
            </div>
          </div>

          {/* Showcase panel */}
          <aside
            aria-label="What you get"
            className="grain relative hidden overflow-hidden rounded-[32px] bg-zinc-950 p-10 text-white lg:block"
          >
            <div aria-hidden="true" className="absolute -right-24 -top-24 h-80 w-80 animate-glow rounded-full bg-electric-600/50 blur-3xl" />
            <div aria-hidden="true" className="absolute -bottom-28 -left-16 h-80 w-80 animate-glow rounded-full bg-cantaloupe-500/30 blur-3xl [animation-delay:-3s]" />

            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cantaloupe-400">Inside the vault</p>
              <h2 className="mt-3 text-4xl font-bold leading-[1.04]">Everything a post needs, in one card.</h2>

              {/* Mock post card */}
              <div className="mt-8 animate-float rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10 backdrop-blur">
                <div className="flex gap-3">
                  <div className="h-24 w-20 shrink-0 rounded-xl bg-gradient-to-br from-electric-400 via-electric-700 to-cantaloupe-500" />
                  <div className="min-w-0 flex-1 py-0.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-cantaloupe-400">
                      Reels <span className="text-zinc-500">· Main Studio</span>
                    </p>
                    <p className="mt-1 font-display text-lg font-bold leading-tight">One-handed gimbal rig</p>
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-electric-500/20 px-2 py-0.5 text-[11px] font-semibold text-electric-300 ring-1 ring-electric-400/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-electric-400" /> Ready
                    </span>
                  </div>
                  <span className="self-start rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-950">Copy</span>
                </div>
              </div>

              <ul className="mt-8 grid grid-cols-2 gap-3">
                {POINTS.map(({ icon: Icon, title, text }, i) => (
                  <li
                    key={title}
                    className="animate-rise rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10"
                    style={{ animationDelay: `${200 + i * 90}ms` }}
                  >
                    <Icon className={cx('h-4 w-4', i % 2 ? 'text-cantaloupe-400' : 'text-electric-400')} aria-hidden="true" />
                    <p className="mt-3 text-sm font-semibold">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-zinc-400">{text}</p>
                  </li>
                ))}
              </ul>

              <p className="mt-8 flex items-center gap-2 text-sm text-zinc-400">
                <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                Installable on iPhone, Android and desktop, and works offline.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
};
