'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { platformOfChannel, type ChannelItem, type ContentItem } from '@/src/lib/content-logic';
import { PlatformIcon } from './PlatformIcon';
import { cx } from './ui';

/**
 * "Also post to" on a channel's post. The list matches the app's other dropdowns.
 * Choosing a channel is handled by the parent, which creates a post that reuses the files.
 */
export function PostToChannelMenu({
  channels,
  posts,
  allChannels,
  busy = false,
  onPick,
}: {
  channels: ChannelItem[];
  posts: ContentItem[];
  allChannels: ChannelItem[];
  busy?: boolean;
  onPick: (channel: ChannelItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.max(r.width, 220);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    if (below >= 160 || below >= above) setPos({ left, width, top: r.bottom + 6, maxHeight: Math.min(288, below) });
    else setPos({ left, width, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(288, above) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!listRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    requestAnimationFrame(() => optionRefs.current[0]?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (channels.length === 0) return null;

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = optionRefs.current.findIndex((el) => el === document.activeElement);
    const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + channels.length) % channels.length;
    optionRefs.current[next]?.focus();
  };

  return (
    <div className="relative z-10 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Also post to"
        className={cx(
          'flex h-8 items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 text-left text-xs font-semibold text-zinc-900 shadow-xs transition-colors hover:border-zinc-300 focus:border-electric-500 focus:outline-none focus:ring-4 focus:ring-electric-500/15 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700',
          open && 'border-electric-500 ring-4 ring-electric-500/15'
        )}
      >
        <span className="truncate">Also post to</span>
        <ChevronDown className={cx('h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={listRef}
              role="listbox"
              aria-label="Also post to"
              onKeyDown={onListKey}
              style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
              className="animate-pop-in z-[70] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            >
              {channels.map((channel, i) => {
                const platform = platformOfChannel(channel, posts, allChannels) ?? channel.platform ?? 'other';
                return (
                  <button
                    key={channel.id}
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    role="option"
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      onPick(channel);
                    }}
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13.5px] text-zinc-700 outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800"
                  >
                    <PlatformIcon platform={platform} size={16} colored />
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
