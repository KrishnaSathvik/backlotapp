'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from './ui';

export interface MenuOption {
  value: string;
  label: string;
}

/**
 * A Backlot-styled dropdown (replaces native <select> where it looks out of place). The list is
 * portalled to <body> with fixed positioning, so it isn't clipped by scrolling dialogs; it opens
 * downward, or upward when there's no room. Keyboard: ↓/Enter/Space opens, ↑/↓ move, Enter
 * picks, Escape or a click outside closes. Closes on any outside scroll or resize.
 */
export function MenuSelect({
  id,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  ariaLabel,
  disabled = false,
  className,
  sizeClass = 'h-10',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: MenuOption[];
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Height class of the trigger (default h-10). */
  sizeClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.find((o) => o.value === value) ?? null;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.max(r.width, 200);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    if (below >= 220 || below >= above) setPos({ left, width, top: r.bottom + 6, maxHeight: Math.min(288, below) });
    else setPos({ left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(288, above) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // don't also close the dialog
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    requestAnimationFrame(() => optionRefs.current[i]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = optionRefs.current.findIndex((el) => el === document.activeElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${current?.label ?? placeholder}` : undefined}
        className={cx(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 text-left text-sm shadow-xs transition-colors hover:border-zinc-300 focus:border-electric-500 focus:outline-none focus:ring-4 focus:ring-electric-500/15 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700',
          sizeClass,
          open && 'border-electric-500 ring-4 ring-electric-500/15',
          className
        )}
      >
        <span className={cx('min-w-0 truncate', current ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-400')}>{current?.label ?? placeholder}</span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={listRef}
              role="listbox"
              aria-label={ariaLabel}
              onKeyDown={onListKey}
              style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
              className="animate-pop-in z-[70] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            >
              {options.map((o, i) => {
                const selected = o.value === value;
                return (
                  <button
                    key={o.value}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => pick(o.value)}
                    className={cx(
                      'flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13.5px] outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800',
                      selected ? 'font-semibold text-zinc-950 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {selected ? <Check className="h-4 w-4 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
