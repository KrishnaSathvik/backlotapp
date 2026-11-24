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
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, MoreHorizontal, X } from 'lucide-react';
import { normalizeStatus, type StatusKey } from '@/src/lib/content-logic';

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
    'bg-accent text-white shadow-sm shadow-accent/20 hover:bg-electric-700 dark:hover:bg-electric-400'
  ),
  secondary: cx(
    buttonBase,
    'border border-border bg-surface text-text shadow-xs hover:border-border-strong hover:bg-surface-2'
  ),
  ghost: cx(
    buttonBase,
    'text-muted hover:bg-surface-2 hover:text-text'
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
  'w-full rounded-xl border border-border bg-surface-2 px-3.5 text-base text-text lg:text-sm shadow-xs transition-colors placeholder:text-faint hover:border-border-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15';

export const labelStyles = 'mb-1.5 block text-xs font-semibold text-muted';

/** Solid card: one step above the page, in both themes. */
export const cardStyles = 'rounded-2xl border border-border bg-surface shadow-xs';

/** Filter chips. Selected is solid text-on-page, inverted. */
export function chipClass(active: boolean) {
  return cx(
    active ? 'bg-text text-bg' : 'bg-surface-2 text-muted hover:text-text'
  );
}

/** Twelve fills four rows of the 3-column desktop grid before the next page. */
export const PAGE_SIZE = 12;

/** Page numbers with gaps when the list is long. */
export function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = [1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount);
  const sorted = [...new Set(wanted)].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (typeof prev === 'number' && n - prev > 1) out.push('gap');
    out.push(n);
  }
  return out;
}

/** Previous, numbered pages, and next. Hidden when everything fits on one page. */
export function Pager({
  page,
  pageCount,
  onPage,
  label,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  label: string;
}) {
  if (pageCount <= 1) return null;
  const item = 'flex h-9 min-w-9 items-center justify-center rounded-full px-2.5 text-[13px] font-semibold tabular-nums';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5 pt-2">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className={cx(buttonStyles.secondary, item, 'gap-1 px-3')}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </button>
      {pageWindow(page, pageCount).map((entry, i) =>
        entry === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-faint" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            onClick={() => onPage(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className={cx(item, chipClass(entry === page))}
          >
            {entry}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className={cx(buttonStyles.secondary, item, 'gap-1 px-3')}
      >
        Next
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Stage badge                                                         */
/* ------------------------------------------------------------------ */

const neutralStage = {
  dot: 'bg-faint',
  pill: 'bg-surface-2 text-muted ring-border',
};

export const STAGE_STYLES: Record<StatusKey, { dot: string; pill: string; label: string }> = {
  idea: { label: 'Planned', ...neutralStage },
  scripting: { label: 'Planned', ...neutralStage },
  editing: { label: 'Planned', ...neutralStage },
  // `ready` is the Made stage. Cantaloupe is reserved for Made and Slate.
  ready: {
    label: 'Made',
    dot: 'bg-cantaloupe-500',
    pill: 'bg-cantaloupe-50 text-cantaloupe-700 ring-cantaloupe-200 dark:bg-cantaloupe-500/15 dark:text-cantaloupe-400 dark:ring-cantaloupe-500/30',
  },
  posted: {
    label: 'Posted',
    dot: 'bg-accent',
    pill: 'bg-[#EAF0FF] text-link ring-[#D6E1FF] dark:bg-accent/18 dark:text-link dark:ring-accent/30',
  },
};

/** Planned / Made / Posted. Lives with the post's details. */
export function StageSwitch({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (stage: 'idea' | 'ready' | 'posted') => void;
  className?: string;
}) {
  const current = normalizeStatus(value);
  return (
    <div role="radiogroup" aria-label="Stage" className={cx('inline-flex rounded-full bg-surface-2 p-0.5', className)}>
      {(['idea', 'ready', 'posted'] as const).map((key) => {
        const on = current === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(key)}
            className={cx('h-8 rounded-full px-3 text-xs font-semibold transition-colors', on ? 'bg-text text-bg' : 'text-muted hover:text-text')}
          >
            {STAGE_STYLES[key].label}
          </button>
        );
      })}
    </div>
  );
}

export function StagePill({ status, className }: { status: StatusKey | string; className?: string }) {
  const s = STAGE_STYLES[normalizeStatus(status)] ?? STAGE_STYLES.idea;
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

/**
 * Modal layer behaviour shared by sheets and the navigation drawer: locks page scroll, moves
 * focus into the panel, traps Tab inside it, closes on Escape (top-most layer only) and puts
 * focus back where it was when the layer closes.
 */
export function useModalLayer(panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
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
      // Only the top-most layer reacts.
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
  }, [panelRef]);

  return onCloseRef;
}

export function Sheet({
  onClose,
  label,
  children,
  size = 'lg',
  fullscreenOnMobile = false,
  floatOnMobile = false,
}: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Phones: fill the screen (header and footer stay put, the body scrolls) instead of a bottom sheet. */
  fullscreenOnMobile?: boolean;
  /** Phones: a centered card with space around it, instead of a full screen or a bottom sheet. */
  floatOnMobile?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useModalLayer(panelRef, onClose);

  const width = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' }[size];

  return (
    // Below lg the layer tracks the visual viewport, so it stays above the on-screen keyboard.
    <div
      className={cx(
        'fixed inset-0 z-50 flex justify-center max-lg:bottom-auto max-lg:top-[var(--vv-top,0px)] max-lg:h-[var(--vv-height,100dvh)]',
        floatOnMobile ? 'items-center p-4 sm:p-6' : 'items-end sm:items-center sm:p-6'
      )}
    >
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
          'animate-sheet-in relative flex w-full flex-col overflow-hidden overscroll-contain border border-border bg-surface shadow-2xl outline-none',
          floatOnMobile
            ? 'max-h-full rounded-3xl'
            : 'max-h-[94%] rounded-t-3xl sm:max-h-[90%] sm:rounded-3xl',
          fullscreenOnMobile &&
            !floatOnMobile &&
            'max-sm:h-full max-sm:max-h-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[env(safe-area-inset-top)]',
          width
        )}
      >
        {fullscreenOnMobile || floatOnMobile ? null : (
          <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
            <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
        )}
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
        className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="animate-toast-in pointer-events-auto flex w-fit max-w-full items-center sm:max-w-md gap-2.5 rounded-2xl bg-text px-4 py-3 text-sm font-medium text-bg shadow-xl ring-1 ring-border"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
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

/* ------------------------------------------------------------------ */
/* ActionMenu: a small "more actions" (⋯) menu                         */
/* ------------------------------------------------------------------ */

export interface ActionMenuItem {
  label: string;
  icon: React.ElementType;
  onSelect: () => void;
  tone?: 'danger';
}

export function ActionMenu({ items, label = 'More actions', className }: { items: ActionMenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so Escape closes the menu before it reaches an open sheet.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={cx(buttonStyles.ghost, 'h-9 w-9 rounded-full p-0')}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div
          role="menu"
          className="animate-pop-in absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-border bg-surface p-1 shadow-xl"
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect, tone }, i) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              autoFocus={i === 0}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onSelect();
              }}
              className={cx(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[13px] font-medium transition-colors',
                tone === 'danger'
                  ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                  : 'text-text hover:bg-surface-2'
              )}
            >
              <Icon className={cx('h-4 w-4', tone === 'danger' ? '' : 'text-zinc-400')} aria-hidden="true" />
              {itemLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
