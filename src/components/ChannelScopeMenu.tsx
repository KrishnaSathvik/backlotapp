'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { platformOfChannel, type ChannelItem, type ContentItem } from '@/src/lib/content-logic';
import { PlatformIcon } from './PlatformIcon';
import { cx } from './ui';

/**
 * Slate's channel picker: "Slate · All channels ⌄" opening a small Backlot-styled list.
 * Keyboard: Enter/Space/↓ opens, ↑/↓ move, Enter picks, Escape or a click outside closes.
 */
export function ChannelScopeMenu({
  value,
  onChange,
  channels,
  items,
}: {
  /** "all" or a channel id as a string. */
  value: string;
  onChange: (value: string) => void;
  channels: ChannelItem[];
  items: ContentItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const options = [
    { value: 'all', label: 'All channels', platform: null as ReturnType<typeof platformOfChannel> },
    ...channels.map((c) => ({ value: String(c.id), label: c.name, platform: platformOfChannel(channels, items, c.name) })),
  ];
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    // Focus the selected option when the list opens.
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    requestAnimationFrame(() => optionRefs.current[i]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = optionRefs.current.findIndex((el) => el === document.activeElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Channel Slate should focus on: ${current.label}`}
        className={cx(
          'flex h-10 min-w-0 items-center gap-2 rounded-xl px-2.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/70',
          open && 'bg-zinc-100 dark:bg-zinc-800/70'
        )}
      >
        <span className="text-[17px] font-bold tracking-tight">Slate</span>
        <span className="min-w-0 truncate text-[15px] text-zinc-500 dark:text-zinc-400">{current.label}</span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Channel Slate should focus on"
          onKeyDown={onListKey}
          className="animate-pop-in absolute left-0 top-full z-30 mt-1.5 max-h-80 w-64 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">Focus on</p>
          {options.map((o, i) => {
            const selected = o.value === current.value;
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
                  'flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] font-medium outline-none transition-colors focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800',
                  selected ? 'text-zinc-950 dark:text-white' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {o.value === 'all' ? (
                    <Layers className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  ) : o.platform ? (
                    <PlatformIcon platform={o.platform} size={18} colored />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {selected ? <Check className="h-4 w-4 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
