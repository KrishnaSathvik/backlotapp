'use client';

import Link from 'next/link';
import React from 'react';
import { Hash, LayoutGrid, Lightbulb, LogIn, MessageSquare, Plus } from 'lucide-react';
import type { ThemePreference } from '@/src/lib/content-logic';
import type { ChannelItem, ContentItem, LibraryFilters } from '@/src/lib/content-logic';
import { AccountMenu, type AccountInfo } from './AccountMenu';
import { SlateAvatar } from './SlateAvatar';
import { LogoMark, Logo } from './site/Logo';
import { cx, STAGE_STYLES } from './ui';

export type ActiveTab = 'library' | 'ideas' | 'chat';

export const TABS: Array<{ key: ActiveTab; label: string; short: string; icon: React.ElementType }> = [
  { key: 'library', label: 'Library', short: 'Library', icon: LayoutGrid },
  { key: 'ideas', label: 'Ideas', short: 'Ideas', icon: Lightbulb },
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
  readOnly?: boolean;
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
  ...shell
}: ShellProps & {
  counts: Record<ActiveTab, number | null>;
  channels: ChannelItem[];
  items: ContentItem[];
  activeChannel: string;
  onChannel: (name: string) => void;
}) {
  const { activeTab, onTab, onNewPost, account } = shell;
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-zinc-200/80 bg-zinc-50/80 backdrop-blur-xl lg:flex dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Backlot website" className="rounded-lg">
          <Logo />
        </Link>
      </div>

      {shell.readOnly ? null : (
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
      )}

      <nav aria-label="Sections" className={cx('space-y-0.5 px-3', shell.readOnly ? 'mt-2' : 'mt-5')}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const on = activeTab === key;
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

      {channels.length ? (
        <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-3 no-scrollbar">
          <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Channels</p>
          <div className="space-y-0.5">
            {channels.map((ch) => {
              const on = activeTab === 'library' && activeChannel === ch.name;
              const n = items.filter((i) => i.channelName === ch.name).length;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onChannel(on ? 'all' : ch.name)}
                  aria-pressed={on}
                  className={cx(
                    'flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
                    on
                      ? 'bg-electric-50 font-semibold text-electric-700 dark:bg-electric-950/50 dark:text-electric-300'
                      : 'text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-900/70'
                  )}
                >
                  <Hash className={cx('h-3.5 w-3.5', on ? 'text-electric-500' : 'text-zinc-400')} aria-hidden="true" />
                  <span className="truncate">{ch.name}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-zinc-400">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="space-y-2 p-3">
        {account.isPreview ? (
          <div data-preview-badge className="relative overflow-hidden rounded-2xl border border-cantaloupe-200/80 bg-gradient-to-br from-cantaloupe-50 to-white p-3.5 dark:border-cantaloupe-900/50 dark:from-cantaloupe-950/40 dark:to-zinc-950">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-cantaloupe-700 dark:text-cantaloupe-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cantaloupe-500" aria-hidden="true" />
              Demo workspace
            </p>
            <p className="mt-1 text-[12px] leading-snug text-zinc-600 dark:text-zinc-400">
              You’re exploring sample content. Sign in to build your own backlot.
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
        <AccountMenu
          variant="row"
          account={account}
          theme={shell.theme}
          onThemeChange={shell.onThemeChange}
          onSignOut={shell.onSignOut}
          onSignIn={shell.onSignIn}
        />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile / tablet                                                     */
/* ------------------------------------------------------------------ */

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
        <div className="ml-auto">
          <AccountMenu
            account={shell.account}
            theme={shell.theme}
            onThemeChange={shell.onThemeChange}
            onSignOut={shell.onSignOut}
            onSignIn={shell.onSignIn}
          />
        </div>
      </div>
    </header>
  );
}

export function MobileTabBar({ activeTab, onTab, onNewPost, readOnly }: Pick<ShellProps, 'activeTab' | 'onTab' | 'onNewPost' | 'readOnly'>) {
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
          'relative flex h-full flex-col items-center justify-center gap-0.5 text-[10.5px] font-semibold transition-colors',
          on ? 'text-zinc-950 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'
        )}
      >
        {t.key === 'chat' ? (
          <SlateAvatar size={24} chip={false} className={cx('transition-transform', on ? 'scale-110' : 'opacity-70 grayscale')} />
        ) : (
          <Icon className={cx('h-[21px] w-[21px] transition-transform', on && 'scale-110 text-electric-600 dark:text-electric-400')} aria-hidden="true" />
        )}
        {t.short}
        {on ? <span className="absolute bottom-1 h-1 w-1 rounded-full bg-electric-500" aria-hidden="true" /> : null}
      </button>
    );
  };
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-[24px] border border-zinc-200/80 bg-white/85 shadow-[0_12px_40px_-12px_rgba(10,20,60,0.25)] backdrop-blur-xl backdrop-saturate-150 lg:hidden dark:border-zinc-800 dark:bg-zinc-900/85 dark:shadow-black/60"
    >
      {readOnly ? (
        <div className="grid h-[62px] grid-cols-3 items-center px-2">{TABS.map(tab)}</div>
      ) : (
      <div className="grid h-[62px] grid-cols-4 items-center px-1">
        {TABS.slice(0, 2).map(tab)}
        <div className="flex items-center justify-center">
          <button
            type="button"
            data-testid="mobile-add-btn"
            onClick={onNewPost}
            aria-label="New post"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-electric-600 text-white shadow-lg shadow-electric-600/40 ring-4 ring-white transition-transform active:scale-90 dark:ring-zinc-900"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {TABS.slice(2).map(tab)}
      </div>
      )}
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
    { key: 'all', label: 'All posts', value: total, hint: `${by('idea')} planned`, dot: 'bg-zinc-400', bar: 'bg-zinc-400 dark:bg-zinc-500', ring: 'ring-zinc-900 dark:ring-white' },
    { key: 'in_progress', label: 'In progress', value: inProgress, hint: `${by('scripting')} scripting · ${by('editing')} editing`, dot: STAGE_STYLES.editing.dot, bar: 'bg-cantaloupe-500', ring: 'ring-cantaloupe-500' },
    { key: 'ready', label: 'Ready to post', value: by('ready'), hint: 'Waiting to go live', dot: STAGE_STYLES.ready.dot, bar: 'bg-electric-500', ring: 'ring-electric-500' },
    { key: 'posted', label: 'Posted', value: by('posted'), hint: 'Live on your channels', dot: STAGE_STYLES.posted.dot, bar: 'bg-emerald-500', ring: 'ring-emerald-500' },
  ];
  return (
    <div role="radiogroup" aria-label="Filter by stage" className="mb-6 grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4">
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
              'group relative overflow-hidden rounded-2xl border bg-white p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 sm:p-4 dark:bg-zinc-900/60',
              on && s.key !== 'all' ? cx('border-transparent ring-2', s.ring) : 'border-zinc-200/80 dark:border-zinc-800 dark:hover:border-zinc-700'
            )}
          >
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
              <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} aria-hidden="true" />
              {s.label}
            </p>
            <p className="mt-1 font-display text-[24px] font-bold leading-none tracking-tight tabular-nums sm:mt-1.5 sm:text-[30px]">{s.value}</p>
            <p className="mt-1.5 truncate text-[11.5px] text-zinc-400 sm:mt-2">{s.hint}</p>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-100 dark:bg-zinc-800">
              <div className={cx('h-full transition-[width] duration-700', s.bar)} style={{ width: total ? `${Math.max(4, (s.value / total) * 100)}%` : '0%' }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
