'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Download, Globe, LogIn, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '@/src/lib/content-logic';
import { usePWAInstall } from '@/src/hooks/usePWAInstall';
import { buttonStyles, cx, Sheet, SheetCloseButton, sizes } from './ui';

const THEMES: Array<{ key: ThemePreference; label: string; icon: React.ElementType }> = [
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
  { key: 'system', label: 'Auto', icon: Monitor },
];

export interface AccountInfo {
  email: string | null;
  name: string | null;
  photoUrl: string | null;
  isPreview: boolean;
}

export function Avatar({ account, size = 32 }: { account: AccountInfo; size?: number }) {
  const label = account.isPreview ? 'D' : (account.name || account.email || '?').trim().charAt(0).toUpperCase();
  if (account.photoUrl && !account.isPreview) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Google profile photo, tiny and already sized.
      <img
        src={account.photoUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover ring-2 ring-white dark:ring-zinc-900"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white ring-2 ring-white dark:ring-zinc-900',
        account.isPreview ? 'bg-gradient-to-br from-cantaloupe-400 to-cantaloupe-600' : 'bg-gradient-to-br from-electric-400 to-electric-700'
      )}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

/** Light / Dark / Auto segmented control. */
export function ThemeSegment({ theme, onChange, className }: { theme: ThemePreference; onChange: (t: ThemePreference) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Theme" className={cx('grid grid-cols-3 gap-0.5 rounded-xl bg-zinc-100 p-0.5 dark:bg-zinc-800/70', className)}>
      {THEMES.map(({ key, label, icon: Icon }) => {
        const on = theme === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(key)}
            className={cx(
              'flex h-8 items-center justify-center gap-1.5 rounded-[10px] text-xs font-semibold transition-all',
              on ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-white' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Account popover. `variant="row"` renders a full-width trigger for the sidebar
 * (opens upward); `variant="avatar"` renders a round avatar for the mobile top bar.
 */
export function AccountMenu({
  account,
  theme,
  onThemeChange,
  onSignOut,
  onSignIn,
  variant = 'avatar',
}: {
  account: AccountInfo;
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  onSignOut: () => void;
  onSignIn?: () => void;
  variant?: 'avatar' | 'row';
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

  const title = account.isPreview ? 'Demo workspace' : account.name || 'Your workspace';
  const subtitle = account.isPreview ? 'Sample content · read-only' : account.email || 'Google account';

  const item =
    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800';

  return (
    <div ref={rootRef} className={cx('relative', variant === 'row' && 'w-full')}>
      {variant === 'row' ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cx(
            'flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/70',
            open && 'bg-zinc-100 dark:bg-zinc-800/70'
          )}
        >
          <Avatar account={account} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-zinc-900 dark:text-white">{title}</span>
            <span className="block truncate text-[11.5px] text-zinc-500">{subtitle}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Account and settings"
          className={cx('rounded-full transition-transform active:scale-95', open && 'ring-4 ring-electric-500/20')}
        >
          <Avatar account={account} size={34} />
        </button>
      )}

      {open ? (
        <div
          role="menu"
          className={cx(
            'animate-pop-in absolute z-50 w-[272px] rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-2xl shadow-zinc-950/15 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95 dark:shadow-black/50',
            variant === 'row' ? 'bottom-full left-0 mb-2 origin-bottom-left' : 'right-0 top-12 origin-top-right'
          )}
        >
          <div className="flex items-center gap-3 px-2.5 pb-3 pt-2.5">
            <Avatar account={account} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950 dark:text-white">{title}</p>
              <p className="truncate text-xs text-zinc-500">{subtitle}</p>
            </div>
          </div>

          {account.isPreview && onSignIn ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignIn();
              }}
              className="mx-1 mb-2 flex w-[calc(100%-0.5rem)] items-center justify-center gap-2 rounded-xl bg-electric-600 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-electric-500"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to start your backlot
            </button>
          ) : null}

          <div className="px-1 pb-1.5">
            <p className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold text-zinc-400">Theme</p>
            <ThemeSegment theme={theme} onChange={onThemeChange} />
          </div>

          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

          {canInstall ? (
            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setOpen(false);
                if (isInstallable) await install();
                else setShowIOSGuide(true);
              }}
              className={item}
            >
              <Download className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              Install app
            </button>
          ) : null}
          <Link href="/" role="menuitem" className={item}>
            <Globe className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Backlot website
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={cx(item, 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40')}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {account.isPreview ? 'Exit demo' : 'Sign out'}
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
                'Open Backlot from your home screen.',
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-electric-50 text-xs font-semibold text-electric-700 dark:bg-electric-950 dark:text-electric-300">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => setShowIOSGuide(false)} className={cx(buttonStyles.primary, sizes.md, 'mt-6 w-full')}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Got it
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
