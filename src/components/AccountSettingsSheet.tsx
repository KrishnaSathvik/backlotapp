'use client';

import React, { useState } from 'react';
import { reauthenticateWithPopup, type User } from 'firebase/auth';
import { AlertTriangle, ChevronLeft, ShieldCheck, Trash2 } from 'lucide-react';
import { googleAuthProvider } from '@/src/lib/firebase';
import { creatorIdentity } from '@/src/lib/identity';
import { Avatar } from './AccountMenu';
import { ThemeToggle } from './ThemeToggle';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes } from './ui';

const CONFIRM = 'DELETE';

const REMOVED = [
  'Your Backlot account and sign-in',
  'Channels, posts, captions, hashtags, notes and dates',
  'Saved ideas and their links and screenshots',
  'Every file you uploaded (covers, videos, slides, screenshots), including unfinished uploads',
  'Slate conversations, messages and Slate’s notes on them',
  'Saved creative preferences, search index entries, suggested changes and their history',
];

async function postDeletion(token: string) {
  const res = await fetch('/api/account/deletion', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: CONFIRM }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data: data as { error?: string; code?: string; deletion?: { statusToken: string } } };
}

/**
 * Settings: appearance, privacy, and Delete account. Deleting needs a typed confirmation and a
 * fresh Google sign-in (the server refuses a sign-in older than 10 minutes).
 */
export function AccountSettingsSheet({
  user,
  onClose,
  onDeletionStarted,
}: {
  user: User;
  onClose: () => void;
  onDeletionStarted: (statusToken: string) => void;
}) {
  const [step, setStep] = useState<'settings' | 'delete'>('settings');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = creatorIdentity(user.uid).name;

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      let { res, data } = await postDeletion(await user.getIdToken());
      if (res.status === 401 && data.code === 'reauth_required') {
        // Confirm it's really them: Google sign-in again, then retry with the new token.
        await reauthenticateWithPopup(user, googleAuthProvider);
        ({ res, data } = await postDeletion(await user.getIdToken(true)));
      }
      if (!res.ok || !data.deletion?.statusToken) throw new Error(data.error || 'Couldn’t start deleting your account. Nothing was deleted. Try again.');
      onDeletionStarted(data.deletion.statusToken);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      setError(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? 'Sign-in was cancelled. Your account was not deleted.'
          : code === 'auth/user-mismatch'
            ? 'That was a different Google account. Sign in with the account you want to delete.'
            : err instanceof Error
              ? err.message
              : 'Something went wrong. Your account was not deleted.'
      );
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={busy ? () => undefined : onClose} label={step === 'settings' ? 'Settings' : 'Delete account'} size="sm">
      <div className="overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6">
        <div className="flex items-start justify-between gap-4">
          {step === 'delete' ? (
            <button
              type="button"
              onClick={() => {
                setStep('settings');
                setError(null);
              }}
              disabled={busy}
              className="-ml-2 flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Settings
            </button>
          ) : (
            <h2 className="text-base font-semibold">Settings</h2>
          )}
          <SheetCloseButton onClick={busy ? () => undefined : onClose} />
        </div>

        {step === 'settings' ? (
          <div className="mt-5 space-y-6">
            <div className="flex items-center gap-3">
              <Avatar account={{ uid: user.uid, isPreview: false }} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950 dark:text-white">{name}</p>
                <p className="truncate text-[13px] text-zinc-500">Signed in with Google{user.email ? ` · ${user.email}` : ''}</p>
              </div>
            </div>

            <section>
              <h3 className={labelStyles}>Appearance</h3>
              <ThemeToggle className="w-fit" />
            </section>

            <section>
              <h3 className={labelStyles}>Privacy</h3>
              <a
                href="/privacy"
                className="flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-electric-700 dark:text-zinc-300 dark:hover:text-electric-400"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Privacy Policy
              </a>
            </section>

            <section className="rounded-2xl border border-red-200 p-4 dark:border-red-900/60">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Delete account</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Permanently delete your Backlot account and everything in it. This can’t be undone.
              </p>
              <button type="button" onClick={() => setStep('delete')} className={cx(buttonStyles.secondary, sizes.sm, 'mt-3 text-red-700 dark:text-red-400')}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete account…
              </button>
            </section>
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-[13.5px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            <div className="flex gap-3 rounded-2xl bg-red-50 p-3.5 text-red-800 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                <strong>This permanently deletes your account.</strong> It can’t be undone, and Backlot can’t restore anything afterwards.
                Download any files you want to keep first.
              </p>
            </div>

            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">What gets deleted</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {REMOVED.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100">What happens next</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                <li>You’re signed out right away, and your account can’t be used again.</li>
                <li>Your data is deleted in the background, usually within 15 minutes (longer if a service is down; it resumes on its own). You’ll get a page that shows the progress.</li>
                <li>Your uploaded files are erased from storage, with no recovery copy.</li>
                <li>Your Google account itself isn’t affected.</li>
              </ul>
            </div>

            <div>
              <label htmlFor="confirm-delete" className={labelStyles}>
                Type <span className="font-mono">{CONFIRM}</span> to confirm
              </label>
              <input
                id="confirm-delete"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={busy}
                className={cx(inputStyles, 'h-10 font-mono')}
              />
              <p className="mt-1.5 text-xs text-zinc-500">You’ll be asked to sign in with Google again to confirm it’s you.</p>
            </div>

            {error ? (
              <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={confirmDelete}
              disabled={busy || typed.trim() !== CONFIRM}
              className={cx(buttonStyles.danger, sizes.md, 'w-full')}
            >
              {busy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
              ) : (
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              )}
              {busy ? 'Deleting…' : 'Delete my account'}
            </button>
            <p className="text-xs text-zinc-500">
              Can’t sign in, or prefer to ask? You can still request deletion by email; see{' '}
              <a href="/privacy#deletion" className="underline underline-offset-2">
                the Privacy Policy
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
