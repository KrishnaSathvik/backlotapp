'use client';

import React, { useState } from 'react';
import {
  currentGoogleAccountId,
  setReauthIntent,
  signInWithGoogle,
  signInWithGoogleIdToken,
  signInWithPassword,
  supabaseBrowser,
  type AuthUser,
} from '@/src/lib/supabase/browser';
import { peekGoogleIdToken, type GoogleCredential } from '@/src/lib/google-identity';
import { GoogleSignInButton } from './GoogleSignInButton';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes } from './ui';

const CONFIRM = 'DELETE';

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
 * Settings: one dialog, "Delete my account". Deleting needs a fresh sign-in (the server refuses a
 * sign-in older than 10 minutes, read from the verified token).
 *
 * - Email/password accounts: the creator enters their password. Supabase verifies it and issues a
 *   fresh session for the same account; only then is deletion requested. A wrong password never
 *   reaches the deletion API.
 * - Google accounts: the creator types DELETE. If the sign-in is older than 10 minutes, Google's
 *   own button confirms it's them; the chosen Google account must be the one linked to this
 *   Backlot account (checked before anything happens); then deletion continues.
 */
export function AccountSettingsSheet({
  user,
  getToken,
  intent,
  onClose,
  onDeletionStarted,
}: {
  user: AuthUser;
  getToken: () => Promise<string | null>;
  intent: 'reauthed' | 'reauth_mismatch' | null;
  onClose: () => void;
  onDeletionStarted: (statusToken: string) => void;
}) {
  const usesPassword = !user.hasGoogle;
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleStep, setGoogleStep] = useState(false);
  const [error, setError] = useState<string | null>(
    intent === 'reauth_mismatch' ? 'You came back signed in with a different Google account, so nothing was deleted.' : null
  );

  /** Posts the deletion. Returns false when the server wants a fresh sign-in first. */
  const startDeletion = async (): Promise<boolean> => {
    const token = await getToken();
    if (!token) throw new Error('Your session ended. Sign in again. Your account was not deleted.');
    const { res, data } = await postDeletion(token);
    if (res.status === 401 && data.code === 'reauth_required') return false;
    if (!res.ok || !data.deletion?.statusToken) throw new Error(data.error || 'Couldn’t delete your account. Nothing was deleted. Try again.');
    onDeletionStarted(data.deletion.statusToken);
    return true;
  };

  const fail = (err: unknown) => {
    setError(err instanceof Error ? err.message : 'Something went wrong. Your account was not deleted.');
    setBusy(false);
  };

  /** "Yes, delete". */
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (usesPassword) {
        try {
          await signInWithPassword(user.email, password);
        } catch {
          throw new Error('That password isn’t correct. Nothing was deleted.');
        }
        setPassword('');
        // Same account? (The email is unique, but never delete on an assumption.)
        const { data } = await supabaseBrowser().auth.getSession();
        if (data.session?.user.id !== user.uid) throw new Error('Couldn’t confirm it’s you. Nothing was deleted.');
        if (!(await startDeletion())) throw new Error('Couldn’t confirm your sign-in. Nothing was deleted. Try again.');
        return;
      }
      if (await startDeletion()) return;
      setGoogleStep(true); // sign-in older than 10 minutes: confirm with Google
      setBusy(false);
    } catch (err) {
      fail(err);
    }
  };

  /** Google's button returned a credential: same Google account? Then refresh the sign-in and continue. */
  const confirmWithGoogle = async (credential: GoogleCredential) => {
    setBusy(true);
    setError(null);
    try {
      const chosen = peekGoogleIdToken(credential.idToken)?.sub;
      const linked = await currentGoogleAccountId();
      if (!chosen || !linked || chosen !== linked) {
        throw new Error('That was a different Google account, so nothing was deleted. Choose the one you use for Backlot.');
      }
      await signInWithGoogleIdToken(credential);
      if (!(await startDeletion())) throw new Error('Couldn’t confirm your sign-in. Nothing was deleted. Try again.');
    } catch (err) {
      fail(err);
    }
  };

  /** Fallback when Google's button can't load: full-page Google sign-in, then confirm again. */
  const confirmWithGoogleRedirect = async () => {
    setBusy(true);
    setReauthIntent(user.uid);
    try {
      await signInWithGoogle('/app', { selectAccount: true });
    } catch (err) {
      fail(err);
    }
  };

  const spinner = <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;
  const ready = usesPassword ? password.length > 0 : typed.trim() === CONFIRM;

  return (
    <Sheet onClose={busy ? () => undefined : onClose} label="Delete my account" size="md">
      <form onSubmit={submit} className="overflow-y-auto p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-9">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight sm:text-[28px]">Delete my account</h2>
          <SheetCloseButton onClick={busy ? () => undefined : onClose} />
        </div>

        <p className="mt-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          This permanently deletes your account and everything in it: posts, ideas, files and Slate conversations. It can’t be undone.
        </p>

        <div className="mt-6">
          {usesPassword ? (
            <>
              <label htmlFor="confirm-password" className={labelStyles}>
                Enter your password to confirm
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                autoFocus
                className={cx(inputStyles, 'h-11')}
              />
            </>
          ) : (
            <>
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
                disabled={busy || googleStep}
                autoFocus
                className={cx(inputStyles, 'h-11 font-mono')}
              />
            </>
          )}
        </div>

        {googleStep && !error ? (
          <p role="status" className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            For your security, confirm it’s you with Google.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
          {googleStep ? (
            <GoogleSignInButton busy={busy} onCredential={confirmWithGoogle}>
              <button
                type="button"
                onClick={confirmWithGoogleRedirect}
                disabled={busy}
                className={cx(buttonStyles.danger, sizes.md, 'w-full sm:min-w-44')}
              >
                {busy ? spinner : null}
                {busy ? 'Confirming…' : 'Confirm with Google'}
              </button>
            </GoogleSignInButton>
          ) : (
            <button type="submit" disabled={busy || !ready} className={cx(buttonStyles.danger, sizes.md, 'sm:min-w-32')}>
              {busy ? spinner : null}
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className={cx(buttonStyles.secondary, sizes.md, 'sm:min-w-28')}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
