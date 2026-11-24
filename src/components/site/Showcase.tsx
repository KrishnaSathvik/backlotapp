'use client';

import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, FileText, LayoutGrid, Lightbulb, MessageSquare } from 'lucide-react';
import { cx } from '../ui';

export type ScreenName = 'library' | 'ideas' | 'calendar' | 'chat' | 'detail';

const SIZE = {
  desktop: { w: 2880, h: 1800 },
  tablet: { w: 2000, h: 1600 },
  mobile: { w: 780, h: 1328 },
} as const;

/**
 * A real app screenshot (captured from the app with sample data), swapped for
 * the dark-mode capture when the page is in dark mode.
 */
export function Shot({
  name,
  kind,
  alt,
  priority = false,
  sizes,
  className,
}: {
  name: ScreenName;
  kind: 'desktop' | 'tablet' | 'mobile';
  alt: string;
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const { w, h } = SIZE[kind];
  return (
    <>
      <Image
        src={`/screens/${kind}-${name}-light.jpg?v=10`}
        alt={alt}
        width={w}
        height={h}
        sizes={sizes}
        priority={priority}
        className={cx('block h-auto w-full dark:hidden', className)}
      />
      <Image
        src={`/screens/${kind}-${name}-dark.jpg?v=10`}
        alt={alt}
        width={w}
        height={h}
        sizes={sizes}
        priority={priority}
        className={cx('hidden h-auto w-full dark:block', className)}
      />
    </>
  );
}

export function BrowserFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_40px_100px_-30px_rgba(10,20,60,0.35)] sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8)]',
        className
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-3 py-2 sm:px-4 sm:py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="h-2 w-2 rounded-full bg-[#ff5f57] sm:h-2.5 sm:w-2.5" />
        <span className="h-2 w-2 rounded-full bg-[#febc2e] sm:h-2.5 sm:w-2.5" />
        <span className="h-2 w-2 rounded-full bg-[#28c840] sm:h-2.5 sm:w-2.5" />
        <span className="mx-auto hidden rounded-md bg-white px-3 py-0.5 font-mono text-[10.5px] text-zinc-400 ring-1 ring-zinc-200 sm:block dark:bg-zinc-950 dark:ring-zinc-800">
          getbacklot.app
        </span>
        <span className="hidden w-12 sm:block" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'rounded-[2.4rem] bg-zinc-950 p-[7px] shadow-[0_30px_80px_-20px_rgba(10,20,60,0.55)] ring-1 ring-zinc-800 dark:ring-zinc-700',
        className
      )}
    >
      <div className="relative overflow-hidden rounded-[2rem] bg-white dark:bg-zinc-950">
        {/* status bar */}
        <div className="relative flex h-7 items-center justify-between px-6 text-[10px] font-semibold text-zinc-900 dark:text-white" aria-hidden="true">
          <span>9:41</span>
          <span className="absolute left-1/2 top-1.5 h-[18px] w-[30%] -translate-x-1/2 rounded-full bg-zinc-950" />
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-px">
              {[3, 5, 7, 9].map((h) => (
                <span key={h} className="w-[3px] rounded-sm bg-current" style={{ height: h }} />
              ))}
            </span>
            <span className="ml-1 h-[9px] w-[18px] rounded-[3px] border border-current p-px">
              <span className="block h-full w-3/4 rounded-[1px] bg-current" />
            </span>
          </span>
        </div>
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

const TABS: Array<{ key: ScreenName; label: string; icon: React.ElementType; alt: string }> = [
  { key: 'library', label: 'Library', icon: LayoutGrid, alt: 'Backlot library with post cards, stages and filters' },
  { key: 'ideas', label: 'Ideas', icon: Lightbulb, alt: 'Ideas inbox with saved links and screenshots' },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, alt: 'Calendar of planned and posted content by day' },
  { key: 'chat', label: 'Slate', icon: MessageSquare, alt: 'Slate, the AI partner, writing hooks for a post' },
  { key: 'detail', label: 'Details', icon: FileText, alt: 'Post details with cover, files and one-tap copy' },
];

const INTERVAL = 5500;

/** Hero product shot: real screens in a browser frame (a phone frame on phones), rotating through the app's sections. */
export function HeroShowcase() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // Once someone picks a screen, stop rotating (WCAG 2.2.2: moving content can be stopped).
  const [chosen, setChosen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Phones clip the last chip. True while Details is still off to the right.
  const [more, setMore] = useState(true);

  useEffect(() => {
    if (paused || chosen) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setTimeout(() => setActive((a) => (a + 1) % TABS.length), INTERVAL);
    return () => window.clearTimeout(id);
  }, [active, paused, chosen]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 12);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>(`[data-screen="${TABS[active].key}"]`);
    if (!scroller || !tab) return;
    const left = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  return (
    <div
      className="relative mx-auto w-full max-w-6xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {/* Tabs. On a phone the row scrolls; the hint is the only sign that Details is past the edge. */}
      <div className="mx-auto mb-6 w-full sm:w-fit">
        <div className="relative">
          <div
            ref={scrollerRef}
            role="tablist"
            aria-label="Product screens"
            className="flex w-full gap-1 overflow-x-auto rounded-full border border-zinc-200 bg-white/80 p-1 backdrop-blur no-scrollbar sm:w-fit dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            {TABS.map((t, i) => {
              const on = i === active;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  data-screen={t.key}
                  aria-selected={on}
                  onClick={() => {
                    setActive(i);
                    setChosen(true);
                  }}
                  className={cx(
                    'relative flex h-9 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors',
                    on ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.label}
                  {on && !paused && !chosen ? (
                    <span
                      key={`p-${active}`}
                      aria-hidden="true"
                      className="absolute inset-x-3 bottom-1 h-0.5 origin-left rounded-full bg-cantaloupe-400"
                      style={{ animation: `progress ${INTERVAL}ms linear both` }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          {more ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-full bg-gradient-to-l from-white via-white/90 to-transparent dark:from-zinc-900 dark:via-zinc-900/90 sm:hidden"
            />
          ) : null}
        </div>
        <p className={cx('mt-2 flex items-center justify-center gap-0.5 text-[12px] font-medium text-zinc-400 sm:hidden', !more && 'invisible')}>
          Swipe to see Details
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </p>
      </div>

      <div className="relative mx-auto max-w-5xl">
        {/* glow */}
        <div
          aria-hidden="true"
          className="absolute -inset-x-6 -bottom-10 top-10 -z-10 animate-glow rounded-[48px] bg-[radial-gradient(55%_60%_at_25%_40%,color-mix(in_oklab,var(--color-electric-500)_30%,transparent),transparent_70%),radial-gradient(45%_55%_at_85%_70%,color-mix(in_oklab,var(--color-cantaloupe-400)_28%,transparent),transparent_70%)] blur-2xl"
        />

        {/* Tablet: the icon rail, with the profile at the bottom. */}
        <BrowserFrame className="hidden sm:block lg:hidden">
          {TABS.map((t, i) => (
            <div
              key={t.key}
              className={cx(
                'transition-opacity duration-700',
                i === 0 ? 'relative' : 'absolute inset-0',
                i === active ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden={i !== active}
            >
              <Shot name={t.key} kind="tablet" alt={t.alt} priority={i === 0} sizes="92vw" />
            </div>
          ))}
        </BrowserFrame>

        {/* Desktop: the full sidebar, with the profile at the bottom. */}
        <BrowserFrame className="hidden lg:block">
          {TABS.map((t, i) => (
            <div
              key={t.key}
              className={cx(
                'transition-opacity duration-700',
                i === 0 ? 'relative' : 'absolute inset-0',
                i === active ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden={i !== active}
            >
              <Shot name={t.key} kind="desktop" alt={t.alt} priority={i === 0} sizes="(min-width: 1280px) 1080px, 92vw" />
            </div>
          ))}
        </BrowserFrame>

        {/* Phones only: the desktop screenshot would be too small to read */}
        <PhoneFrame className="relative mx-auto w-[68%] max-w-[300px] sm:hidden">
          {TABS.map((t, i) => (
            <div
              key={t.key}
              className={cx(
                'transition-opacity duration-700',
                i === 0 ? 'relative' : 'absolute inset-0',
                i === active ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden={i !== active}
            >
              <Shot name={t.key} kind="mobile" alt={t.alt} priority={i === 0} sizes="300px" />
            </div>
          ))}
        </PhoneFrame>
      </div>
    </div>
  );
}
