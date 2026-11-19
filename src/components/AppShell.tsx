'use client';

import Link from 'next/link';
import React from 'react';
import { ArrowLeft, CalendarDays, Hash, LayoutGrid, Lightbulb, LogIn, MessageSquare, Plus } from 'lucide-react';
import type { ThemePreference } from '@/src/lib/content-logic';
import { channelPlatform, type ChannelItem, type ContentItem, type LibraryFilters } from '@/src/lib/content-logic';
import { AccountMenu, SidebarAccount, type AccountInfo } from './AccountMenu';
import { PlatformIcon } from './PlatformIcon';
import { SlateAvatar } from './SlateAvatar';
import { LogoMark, Logo } from './site/Logo';
import { cx, STAGE_STYLES } from './ui';

export type ActiveTab = 'library' | 'ideas' | 'calendar' | 'chat';

export const TABS: Array<{ key: ActiveTab; label: string; short: string; icon: React.ElementType }> = [
  { key: 'library', label: 'Library', short: 'Library', icon: LayoutGrid },
  { key: 'ideas', label: 'Ideas', short: 'Ideas', icon: Lightbulb },
  { key: 'calendar', label: 'Calendar', short: 'Calendar', icon: CalendarDays },
  { key: 'chat', label: 'Slate', short: 'Slate', icon: MessageSquare },
];

interface ShellProps {
  activeTab: ActiveTab;
  onTab: (t: ActiveTab) => void;
  onNewPost: () => void;
  account: AccountInfo;
  theme: ThemePreference;
  onThemeChange: (t: ThemePreference) => void;
  onSignOut: () => void;
  onSignIn?: () => void;
  /** Signed-in only. */
  onOpenSettings?: () => void;
}

/* ------------------------------------------------------------------ */
/* Desktop sidebar                                                     */
/* ------------------------------------------------------------------ */

export function Sidebar({
  counts,
  channels,
  items,
  activeChannel,
  onChannel,
  onAddChannel,
  ...shell
}: ShellProps & {
  counts: Record<ActiveTab, number | null>;
  channels: ChannelItem[];
  items: ContentItem[];
  activeChannel: string;
  onChannel: (name: string) => void;
  onAddChannel: () => void;
}) {
  const { activeTab, onTab, onNewPost, account } = shell;
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-zinc-200/80 bg-zinc-50/80 backdrop-blur-xl lg:flex dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Backlot website" className="rounded-lg">
          <Logo />
        </Link>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNewPost}
          className="group flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-electric-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white"
        >
          <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" aria-hidden="true" />
          New post
        </button>
      </div>

      <nav aria-label="Sections" className="mt-5 space-y-0.5 px-3">
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = activeTab === key && !(key === 'library' && activeChannel !== 'all');
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors',
                on
                  ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:text-white dark:ring-zinc-800'
                  : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900/70 dark:hover:text-white'
              )}
            >
              {on ? <span className="absolute -left-3 top-2 h-5 w-1 rounded-r-full bg-electric-500" aria-hidden="true" /> : null}
              {key === 'chat' ? (
                <SlateAvatar size={18} chip={false} className={on ? '' : 'opacity-70 grayscale'} />
              ) : (
                <Icon className={cx('h-4 w-4', on ? 'text-electric-600 dark:text-electric-400' : 'text-zinc-400')} aria-hidden="true" />
              )}
              {label}
              {count !== null ? (
                <span
                  className={cx(
                    'ml-auto rounded-md px-1.5 text-[11px] font-semibold tabular-nums',
                    on ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300' : 'text-zinc-400'
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-3 no-scrollbar">
          <div className="flex items-center justify-between pb-1.5 pl-2.5 pr-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Your channels</p>
            <button
              type="button"
              onClick={onAddChannel}
              aria-label="Add channel"
              title="Add channel"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          {channels.length === 0 ? (
            <button
              type="button"
              onClick={onAddChannel}
              className="flex h-10 w-full items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-2.5 text-[13px] text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:hover:text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add your first channel
            </button>
          ) : null}
          <div className="space-y-0.5">
            {channels.map((ch) => {
              const on = activeTab === 'library' && activeChannel === ch.name;
              const n = items.filter((i) => i.channelName === ch.name).length;
              const platform = channelPlatform(items, ch.name);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onChannel(on ? 'all' : ch.name)}
                  aria-pressed={on}
                  title={`Open ${ch.name}`}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors',
                    'h-11',
                    on
                      ? 'bg-electric-50 text-electric-700 dark:bg-electric-950/50 dark:text-electric-300'
                      : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-900/70'
                  )}
                >
                  {platform ? (
                    <PlatformIcon platform={platform} size={18} />
                  ) : (
                    <Hash className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[13px]', on && 'font-semibold')}>{ch.name}</span>
                    {ch.handle ? <span className="block truncate text-[11px] text-zinc-400">{ch.handle}</span> : null}
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-400">{n}</span>
                </button>
              );
            })}
          </div>
      </div>

      <div className="space-y-2 p-3">
        {account.isPreview ? (
          <div data-preview-badge className="relative overflow-hidden rounded-2xl border border-cantaloupe-200/80 bg-gradient-to-br from-cantaloupe-50 to-white p-3.5 dark:border-cantaloupe-900/50 dark:from-cantaloupe-950/40 dark:to-zinc-950">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-cantaloupe-700 dark:text-cantaloupe-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cantaloupe-500" aria-hidden="true" />
              Demo workspace
            </p>
            <p className="mt-1 text-[12px] leading-snug text-zinc-600 dark:text-zinc-400">
              Try anything here. Changes reset when you refresh. Sign in to keep your Backlot.
            </p>
            {shell.onSignIn ? (
              <button
                type="button"
                onClick={shell.onSignIn}
                className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-white text-[12.5px] font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50 dark:bg-zinc-900 dark:text-white dark:ring-zinc-800 dark:hover:bg-zinc-800"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                Sign in with Google
              </button>
            ) : null}
          </div>
        ) : null}
        {account.isPreview ? (
          // Demo: no account menu, just a way back to the website.
          <div data-preview-badge>
            <DemoBackLink className="w-full" />
          </div>
        ) : (
          <SidebarAccount account={account} onSignOut={shell.onSignOut} onOpenSettings={shell.onOpenSettings} />
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile / tablet                                                     */
/* ------------------------------------------------------------------ */

/** Leaves the demo and returns to the website. */
function DemoBackLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cx(
        'flex h-9 items-center justify-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 text-[13px] font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:text-white',
        className
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back
    </Link>
  );
}

export function MobileTopBar(shell: ShellProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 lg:hidden dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Backlot website" className="flex items-center gap-2.5 rounded-lg">
          <LogoMark />
          <span className="font-display text-[16px] font-bold tracking-tight">Backlot</span>
        </Link>
        {shell.account.isPreview ? (
          <span data-preview-badge className="rounded-full bg-cantaloupe-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-cantaloupe-700 dark:bg-cantaloupe-950 dark:text-cantaloupe-300">
            Demo
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {shell.account.isPreview ? (
            <span data-preview-badge>
              <DemoBackLink />
            </span>
          ) : (
            <AccountMenu account={shell.account} onSignOut={shell.onSignOut} onOpenSettings={shell.onOpenSettings} />
          )}
        </div>
      </div>
    </header>
  );
}

export function MobileTabBar({ activeTab, onTab, onNewPost }: Pick<ShellProps, 'activeTab' | 'onTab' | 'onNewPost'>) {
  const tab = (t: (typeof TABS)[number]) => {
    const on = activeTab === t.key;
    const Icon = t.icon;
    return (
      <button
        key={t.key}
        type="button"
        onClick={() => onTab(t.key)}
        aria-current={on ? 'page' : undefined}
        className={cx(
          'flex h-full flex-col items-center justify-center gap-1.5 text-[11px] font-semibold leading-none transition-colors',
          on ? 'text-zinc-950 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center" aria-hidden="true">
          {t.key === 'chat' ? (
            <SlateAvatar size={24} chip={false} className={cx('transition-opacity', !on && 'opacity-60 grayscale')} />
          ) : (
            <Icon className={cx('h-[22px] w-[22px]', on && 'text-electric-600 dark:text-electric-400')} />
          )}
        </span>
        {t.short}
      </button>
    );
  };
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-[24px] border border-zinc-200/80 bg-white/85 shadow-[0_12px_40px_-12px_rgba(10,20,60,0.25)] backdrop-blur-xl backdrop-saturate-150 lg:hidden dark:border-zinc-800 dark:bg-zinc-900/85 dark:shadow-black/60"
    >
      <div className="grid h-[64px] grid-cols-5 items-stretch px-1">
        {TABS.slice(0, 2).map(tab)}
        <div className="flex items-center justify-center">
          <button
            type="button"
            data-testid="mobile-add-btn"
            onClick={onNewPost}
            aria-label="New post"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-electric-600 text-white shadow-md shadow-electric-600/30 transition-transform active:scale-90"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {TABS.slice(2).map(tab)}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Library overview stats                                              */
/* ------------------------------------------------------------------ */

type StageFilter = LibraryFilters['status'];

/** Overview cards that double as the stage filter for the library. */
export function StatsStrip({ items, active, onSelect }: { items: ContentItem[]; active: StageFilter; onSelect: (s: StageFilter) => void }) {
  const total = items.length;
  const by = (s: string) => items.filter((i) => i.status === s).length;
  const inProgress = by('scripting') + by('editing');
  const stats: Array<{ key: StageFilter; label: string; value: number; hint: string; dot: string; bar: string; ring: string }> = [
    { key: 'all', label: 'All posts', value: total, hint: 'Every stage', dot: 'bg-zinc-900 dark:bg-white', bar: 'bg-zinc-900 dark:bg-zinc-200', ring: 'ring-zinc-900 dark:ring-white' },
    { key: 'idea', label: 'Planned', value: by('idea'), hint: 'Not started yet', dot: STAGE_STYLES.idea.dot, bar: 'bg-zinc-400 dark:bg-zinc-500', ring: 'ring-zinc-400' },
    { key: 'in_progress', label: 'In progress', value: inProgress, hint: `${by('scripting')} scripting · ${by('editing')} editing`, dot: STAGE_STYLES.editing.dot, bar: 'bg-cantaloupe-500', ring: 'ring-cantaloupe-500' },
    { key: 'ready', label: 'Ready to post', value: by('ready'), hint: 'Waiting to go live', dot: STAGE_STYLES.ready.dot, bar: 'bg-electric-500', ring: 'ring-electric-500' },
    { key: 'posted', label: 'Posted', value: by('posted'), hint: 'Live on your channels', dot: STAGE_STYLES.posted.dot, bar: 'bg-emerald-500', ring: 'ring-emerald-500' },
  ];
  return (
    <div role="radiogroup" aria-label="Filter by stage" className="-mx-4 mb-4 flex snap-x scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:mb-5 md:grid md:grid-cols-5 md:gap-3 md:overflow-visible md:px-0 md:pt-0 [&::-webkit-scrollbar]:hidden">
      {stats.map((s) => {
        const on = active === s.key || (s.key === 'all' && !stats.some((x) => x.key === active));
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(on && s.key !== 'all' ? 'all' : s.key)}
            className={cx(
              'group relative overflow-hidden rounded-2xl border bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 sm:px-4 sm:py-3.5 dark:bg-zinc-900/60',
              'w-[8.75rem] shrink-0 snap-start md:w-auto',
              on && s.key !== 'all' ? cx('border-transparent ring-2', s.ring) : 'border-zinc-200/80 dark:border-zinc-800 dark:hover:border-zinc-700'
            )}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
              <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
              {s.label}
            </p>
            <p className="mb-1.5 mt-1 font-display text-[24px] font-bold leading-none tracking-tight tabular-nums sm:mt-1.5 sm:text-[26px] xl:mb-0">{s.value}</p>
            <p className="mt-1.5 hidden truncate text-[11.5px] text-zinc-400 xl:block">{s.hint}</p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-100 dark:bg-zinc-800">
              <div className={cx('h-full transition-[width] duration-700', s.bar)} style={{ width: total ? `${Math.max(4, (s.value / total) * 100)}%` : '0%' }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
