'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { cx } from './ui';

interface StatusView {
  state: 'scheduled' | 'in_progress' | 'completed';
  requestedAt: string;
  contentRemoved: boolean;
  filesDeleted: boolean;
  storagePurgeBy: string | null;
  signInRemoved: boolean;
  completedAt: string | null;
  delayed: boolean;
}

/** This device's most recent status token (so reopening the app can find the page again). */
export const DELETION_STATUS_KEY = 'backlot_deletion_status';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The token from the URL fragment, else the one remembered on this device. */
function readToken(): string {
  const fromHash = window.location.hash.replace(/^#/, '');
  if (TOKEN_RE.test(fromHash)) return fromHash;
  try {
    const saved = window.localStorage.getItem(DELETION_STATUS_KEY) ?? '';
    return TOKEN_RE.test(saved) ? saved : '';
  } catch {
    return '';
  }
}

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { dateStyle: 'long' });

function Step({ done, active, title, detail }: { done: boolean; active: boolean; title: string; detail?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      ) : active ? (
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-electric-600 dark:text-electric-400" aria-hidden="true" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-zinc-300 dark:text-zinc-700" aria-hidden="true" />
      )}
      <div>
        <p className={cx('text-[15px] font-semibold', !done && !active && 'text-zinc-500')}>
          {title}
          <span className="sr-only">{done ? ' (done)' : active ? ' (in progress)' : ' (waiting)'}</span>
        </p>
        {detail ? <p className="text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">{detail}</p> : null}
      </div>
    </li>
  );
}

/**
 * Account deletion progress. Polls every 10 s until finished. Needs no sign-in: the key is the
 * status token in the URL fragment (#…), which the browser never sends in the request line.
 */
export function DeletionStatus() {
  // null while server-rendering; '' in the browser when there's no token.
  const token = useSyncExternalStore(subscribeHash, readToken, () => null);
  const [view, setView] = useState<StatusView | null>(null);
  const [fetchError, setError] = useState<string | null>(null);
  const error =
    token === ''
      ? 'This account is being deleted. To see its progress, open the status link you got when you asked for deletion, on the same device.'
      : fetchError;

  useEffect(() => {
    if (!token) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch('/api/account/deletion/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (stop) return;
        if (!res.ok) {
          setError(
            res.status === 404
              ? 'This status link isn’t valid any more. A newer link may have replaced it, or the deletion finished more than 30 days ago.'
              : data.error || 'Progress can’t be checked right now. Your account stays locked, and deletion continues automatically.'
          );
          if (res.status === 404) return;
        } else {
          setError(null);
          setView(data as StatusView);
          if ((data as StatusView).state === 'completed') return;
        }
      } catch {
        if (!stop) setError('Couldn’t reach Backlot. Retrying…');
      }
      if (!stop) timer = setTimeout(load, 10_000);
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [token]);

  const content = !!view?.contentRemoved;
  const files = !!view?.filesDeleted;
  const signIn = !!view?.signInRemoved;
  const complete = view?.state === 'completed';

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{complete ? 'Your account has been deleted' : 'Deleting your account'}</h1>
      <p className="mt-3 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300" aria-live="polite">
        {complete
          ? 'Everything in your Backlot account has been deleted, and the account can’t be used again.'
          : view?.state === 'scheduled'
            ? 'Your account is locked and you’ve been signed out. Deletion starts in a few minutes, once any requests that were already running have finished.'
            : 'Your account is locked and you’ve been signed out. Your data is being deleted now. You can close this page; it continues without you.'}
      </p>

      {error ? (
        <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
      ) : null}

      {view ? (
        <>
          {view.delayed && !complete ? (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
              This is taking longer than usual because a service didn’t respond. Backlot keeps retrying automatically, and it won’t be marked
              complete until everything is gone.
            </p>
          ) : null}
          <ol className="mt-8 space-y-5">
            <Step done active={false} title="Access removed" detail={`Signed out and locked ${fmt(view.requestedAt)}. No new changes can be made.`} />
            <Step
              done={content}
              active={!content && view.state === 'in_progress'}
              title="Workspace and Slate data deleted"
              detail={content ? undefined : 'Channels, posts, ideas, Slate conversations, preferences, search index and suggestions.'}
            />
            <Step
              done={files}
              active={content && !files}
              title="Uploaded files deleted"
              detail={
                files ? (
                  <>
                    {view.storagePurgeBy
                      ? `The storage provider may keep a recovery copy, not accessible from Backlot, until about ${fmtDate(view.storagePurgeBy)}; then it’s permanently erased.`
                      : 'Erased from storage; no recovery copy is kept.'}
                  </>
                ) : (
                  'Covers, videos, slides, screenshots and unfinished uploads.'
                )
              }
            />
            <Step done={signIn} active={files && !signIn} title="Backlot sign-in removed" detail={signIn ? 'Your Google account itself isn’t affected.' : undefined} />
            <Step
              done={complete}
              active={signIn && !complete}
              title="Deletion confirmed"
              detail={complete ? `Checked that nothing remains · ${fmt(view.completedAt!)}` : 'A final check that nothing is left.'}
            />
          </ol>
          {!complete ? <p className="mt-8 text-sm text-zinc-500">Bookmark this page to check on it later. Anyone with the link can see this progress (but nothing else).</p> : null}
        </>
      ) : null}

      <p className="mt-10 text-sm text-zinc-500">
        Questions? See the{' '}
        <a href="/privacy#deletion" className="underline underline-offset-2">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
