'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, LogOut, Monitor, Moon, MoreHorizontal, Sun, UserRound } from 'lucide-react';
import type { ThemePreference } from '@/src/lib/content-logic';
import { usePWAInstall } from '@/src/hooks/usePWAInstall';
import { buttonStyles, cx, Sheet, SheetCloseButton, sizes } from './ui';

const THEMES: Array<{ key: ThemePreference; label: string; icon: React.ElementType }> = [
  { key: 'system', label: 'System', icon: Monitor },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

export function AccountMenu({
  email,
  isPreview,
  theme,
  onThemeChange,
  onSignOut,
}: {
  email: string | null;
  isPreview: boolean;
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const canInstall = !isInstalled && (isInstallable || isIOS);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (email ?? '').trim().charAt(0).toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account and settings"
        className={cx(
          'flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 shadow-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800',
          open && 'ring-4 ring-blue-500/15'
        )}
      >
        {initial ? initial : isPreview ? <MoreHorizontal className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-pop-in absolute right-0 top-11 z-40 w-64 origin-top-right rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-950/10 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="px-3 pb-2 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {isPreview ? 'Preview mode' : 'Signed in'}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {isPreview ? 'Saved in this browser only' : email || 'Google account'}
            </p>
          </div>

          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

          <p className="px-3 pb-1.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            Appearance
          </p>
          <div className="mx-1.5 mb-1.5 grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-950">
            {THEMES.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="menuitemradio"
                aria-checked={theme === key}
                onClick={() => onThemeChange(key)}
                className={cx(
                  'flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-semibold transition-colors',
                  theme === key
                    ? 'bg-white text-zinc-950 shadow-xs dark:bg-zinc-800 dark:text-white'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          {canInstall ? (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                if (isInstallable) await install();
                else setShowIOSGuide(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Download className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              Install app
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {isPreview ? 'Exit preview' : 'Sign out'}
          </button>
        </div>
      ) : null}

      {showIOSGuide ? (
        <Sheet onClose={() => setShowIOSGuide(false)} label="Install on iPhone or iPad" size="sm">
          <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold">Install on iPhone or iPad</h2>
              <SheetCloseButton onClick={() => setShowIOSGuide(false)} />
            </div>
            <ol className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              {[
                'Tap the Share button in Safari’s toolbar.',
                'Scroll down and tap “Add to Home Screen”.',
                'Open Content Vault from your home screen.',
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className={cx(buttonStyles.primary, sizes.md, 'mt-6 w-full')}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Got it
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
