'use client';

import React, { useEffect, useRef, useState } from 'react';
import BoringAvatar from 'boring-avatars';
import { Check, Download, LogOut, Settings, ShieldCheck } from 'lucide-react';
import { creatorIdentity } from '@/src/lib/identity';
import { usePWAInstall } from '@/src/hooks/usePWAInstall';
import { ThemeToggle } from './ThemeToggle';
import { buttonStyles, cx, Sheet, SheetCloseButton, sizes } from './ui';

export interface AccountInfo {
  /** Firebase uid; null in the demo. */
  uid: string | null;
  isPreview: boolean;
}

function useIdentity(account: AccountInfo) {
  return creatorIdentity(account.uid ?? 'demo');
}

/** The account's fixed avatar, generated from the uid (style and palette mixed per account). */
export function Avatar({ account, size = 32 }: { account: AccountInfo; size?: number }) {
  const id = useIdentity(account);
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-full ring-2 ring-white dark:ring-zinc-900"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <BoringAvatar name={account.uid ?? 'demo'} variant={id.variant} colors={id.palette} size={size} />
    </span>
  );
}

/** "Install app": adds Backlot to the home screen / dock. Hidden once installed or where unsupported. */
function InstallAppButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [guide, setGuide] = useState(false);
  if (isInstalled || !(isInstallable || isIOS)) return null;
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (isInstallable) {
            await install();
            onDone?.();
          } else setGuide(true);
        }}
        className={className}
      >
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        Install app
      </button>
      {guide ? (
        <Sheet onClose={() => setGuide(false)} label="Install on iPhone or iPad" size="sm">
          <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold">Install on iPhone or iPad</h2>
              <SheetCloseButton onClick={() => setGuide(false)} />
            </div>
            <ol className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
              {['Tap the Share button in Safari’s toolbar.', 'Scroll down and tap “Add to Home Screen”.', 'Open Backlot from your home screen.'].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-electric-50 text-xs font-semibold text-electric-700 dark:bg-electric-950 dark:text-electric-300">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => {
                setGuide(false);
                onDone?.();
              }}
              className={cx(buttonStyles.primary, sizes.md, 'mt-6 w-full')}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Got it
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

/** Sidebar footer: avatar, generated name and a Log out button. Nothing to edit. */
export function SidebarAccount({ account, onSignOut, onOpenSettings }: { account: AccountInfo; onSignOut: () => void; onOpenSettings?: () => void }) {
  const id = useIdentity(account);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <ThemeToggle />
        <InstallAppButton className="ml-auto flex h-9 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-[12.5px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white" />
      </div>
      <div className="flex items-center gap-3 rounded-xl p-2">
        <Avatar account={account} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-zinc-900 dark:text-white">{id.name}</p>
          <button
            type="button"
            onClick={onSignOut}
            className="-ml-1 mt-0.5 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12.5px] font-medium text-zinc-500 transition-colors hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Log out
          </button>
        </div>
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            className="self-center rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <a
            href="/privacy"
            className="self-end rounded-md px-1 py-0.5 text-[11.5px] font-medium text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            Privacy
          </a>
        )}
      </div>
    </div>
  );
}

/** Mobile top bar: the avatar opens a small card with the name and Log out. */
export function AccountMenu({ account, onSignOut, onOpenSettings }: { account: AccountInfo; onSignOut: () => void; onOpenSettings?: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useIdentity(account);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${id.name}`}
        className={cx('rounded-full transition-transform active:scale-95', open && 'ring-4 ring-electric-500/20')}
      >
        <Avatar account={account} size={34} />
      </button>
      {open ? (
        <div
          role="menu"
          className="animate-pop-in absolute right-0 top-12 z-50 w-60 origin-top-right rounded-2xl border border-zinc-200/80 bg-white/95 p-1.5 shadow-2xl shadow-zinc-950/15 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/95 dark:shadow-black/50"
        >
          <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-2">
            <Avatar account={account} size={36} />
            <p className="min-w-0 truncate text-sm font-semibold text-zinc-950 dark:text-white">{id.name}</p>
          </div>
          <div className="px-2.5 pb-2.5">
            <ThemeToggle className="w-fit" />
          </div>
          <div className="mb-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <InstallAppButton
            onDone={() => setOpen(false)}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          />
          {onOpenSettings ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </button>
          ) : null}
          <a
            href="/privacy"
            role="menuitem"
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Privacy
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
