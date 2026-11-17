'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { StatusKey } from '@/src/lib/content-logic';

/* ------------------------------------------------------------------ */
/* Class helpers                                                       */
/* ------------------------------------------------------------------ */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const buttonBase =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

export const buttonStyles = {
  primary: cx(
    buttonBase,
    'bg-electric-600 text-white shadow-sm shadow-electric-600/20 hover:bg-electric-700 dark:bg-electric-500 dark:hover:bg-electric-400 dark:text-white'
  ),
  secondary: cx(
    buttonBase,
    'border border-zinc-200 bg-white text-zinc-800 shadow-xs hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
  ),
  ghost: cx(
    buttonBase,
    'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
  ),
  danger: cx(
    buttonBase,
    'bg-red-600 text-white shadow-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400'
  ),
  dangerGhost: cx(
    buttonBase,
    'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
  ),
};

export const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
  icon: 'h-10 w-10',
  iconSm: 'h-8 w-8',
};

export const inputStyles =
  'w-full rounded-xl border border-zinc-200 bg-white px-3.5 text-sm text-zinc-950 shadow-xs transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-electric-500 focus:outline-none focus:ring-4 focus:ring-electric-500/15 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:hover:border-zinc-700';

export const labelStyles = 'mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300';

export const cardStyles =
  'rounded-2xl border border-zinc-200/80 bg-white shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900/60';

/* ------------------------------------------------------------------ */
/* Stage badge                                                         */
/* ------------------------------------------------------------------ */

export const STAGE_STYLES: Record<StatusKey, { dot: string; pill: string; label: string }> = {
  idea: {
    label: 'Idea',
    dot: 'bg-zinc-400',
    pill: 'bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700',
  },
  scripting: {
    label: 'Scripting',
    dot: 'bg-violet-500',
    pill: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900',
  },
  editing: {
    label: 'Editing',
    dot: 'bg-cantaloupe-500',
    pill: 'bg-cantaloupe-50 text-cantaloupe-800 ring-cantaloupe-200 dark:bg-cantaloupe-950/40 dark:text-cantaloupe-300 dark:ring-cantaloupe-900',
  },
  ready: {
    label: 'Ready',
    dot: 'bg-electric-500',
    pill: 'bg-electric-50 text-electric-700 ring-electric-200 dark:bg-electric-950/50 dark:text-electric-300 dark:ring-electric-900',
  },
  posted: {
    label: 'Posted',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  },
};

export function StagePill({ status, className }: { status: StatusKey; className?: string }) {
  const s = STAGE_STYLES[status] ?? STAGE_STYLES.idea;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        s.pill,
        className
      )}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet: accessible modal (bottom sheet on mobile, dialog on desktop) */
/* ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let openSheets = 0;

export function Sheet({
  onClose,
  label,
  children,
  size = 'lg',
}: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    openSheets += 1;
    document.documentElement.style.overflow = 'hidden';

    const panel = panelRef.current;
    // Focus the panel itself so screen readers announce it without popping a mobile keyboard.
    panel?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (!panel) return;
      // Only the top-most sheet reacts.
      const sheets = document.querySelectorAll('[data-sheet-panel]');
      if (sheets[sheets.length - 1] !== panel) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null
      );
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      openSheets -= 1;
      if (openSheets === 0) document.documentElement.style.overflow = '';
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="animate-fade-in absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px] dark:bg-black/70"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-sheet-panel
        className={cx(
          'animate-sheet-in relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-zinc-200/80 bg-white shadow-2xl outline-none sm:max-h-[90dvh] sm:rounded-3xl dark:border-zinc-800 dark:bg-zinc-950',
          width
        )}
      >
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function SheetCloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(buttonStyles.ghost, sizes.iconSm, 'shrink-0 rounded-full')}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts + confirm dialog                                             */
/* ------------------------------------------------------------------ */

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}
interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: 'danger' | 'default';
}

const FeedbackContext = createContext<{
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
} | null>(null);

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return ctx;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(
    null
  );
  const nextId = useRef(1);
  const titleId = useId();

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3200);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    []
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="animate-toast-in pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-xl shadow-zinc-950/20 ring-1 ring-white/10 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-900/10"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
            ) : t.tone === 'error' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 dark:text-red-600" aria-hidden="true" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-electric-400 dark:text-electric-600" aria-hidden="true" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {pending ? (
        <Sheet onClose={() => settle(false)} label={pending.title} size="sm">
          <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6">
            <div className="flex gap-4">
              {pending.tone === 'danger' ? (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
              ) : null}
              <div>
                <h2 id={titleId} className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                  {pending.title}
                </h2>
                {pending.body ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {pending.body}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => settle(false)} className={cx(buttonStyles.secondary, sizes.md)}>
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => settle(true)}
                className={cx(pending.tone === 'danger' ? buttonStyles.danger : buttonStyles.primary, sizes.md)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </FeedbackContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Clipboard                                                           */
/* ------------------------------------------------------------------ */

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers/contexts without the async clipboard API.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
