'use client';

import Link from 'next/link';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Hash, LayoutGrid, Lightbulb, LogIn, MessageSquare, PanelLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ThemePreference } from '@/src/lib/content-logic';
import { platformOfChannel, postInChannel, type ChannelItem, type ContentItem } from '@/src/lib/content-logic';
import { AccountMenu, SidebarAccount, type AccountInfo } from './AccountMenu';
import { PlatformIcon } from './PlatformIcon';
import { SlateAvatar } from './SlateAvatar';
import { LogoMark, Logo } from './site/Logo';
import { ActionMenu, cx, useModalLayer } from './ui';

export type ActiveTab = 'library' | 'ideas' | 'calendar' | 'chat';

export type AppBreakpoint = 'phone' | 'tablet' | 'desktop';

/** Which shell is on screen. Null until the browser width is known. */
export function useAppBreakpoint(): AppBreakpoint | null {
  const [bp, setBp] = useState<AppBreakpoint | null>(null);
  useLayoutEffect(() => {
    const md = window.matchMedia('(min-width: 768px)');
    const lg = window.matchMedia('(min-width: 1024px)');
    const apply = () => setBp(lg.matches ? 'desktop' : md.matches ? 'tablet' : 'phone');
    apply();
    md.addEventListener('change', apply);
    lg.addEventListener('change', apply);
    return () => {
      md.removeEventListener('change', apply);
      lg.removeEventListener('change', apply);
    };
  }, []);
  return bp;
}

export const TABS: Array<{ key: ActiveTab; label: string; short: string; icon: React.ElementType; iconClass: string }> = [
  { key: 'library', label: 'Library', short: 'Library', icon: LayoutGrid, iconClass: 'text-electric-500' },
  { key: 'ideas', label: 'Ideas', short: 'Ideas', icon: Lightbulb, iconClass: 'text-cantaloupe-500' },
  { key: 'calendar', label: 'Calendar', short: 'Calendar', icon: CalendarDays, iconClass: 'text-emerald-500' },
  { key: 'chat', label: 'Slate', short: 'Slate', icon: MessageSquare, iconClass: '' },
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

export type SidebarProps = ShellProps & {
  counts: Record<ActiveTab, number | null>;
  channels: ChannelItem[];
  items: ContentItem[];
  activeChannel: string;
  onChannel: (name: string) => void;
  onAddChannel: () => void;
  onEditChannel: (channel: ChannelItem) => void;
  onDeleteChannel: (channel: ChannelItem) => void;
};

/** Desktop (1024px+): the permanent sidebar. */
export function Sidebar(props: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[256px] flex-col border-r border-border bg-bg lg:flex">
      <div className="px-5 pt-5">
        <Logo />
        {props.account.isPreview ? <DemoBackLink className="mt-3 w-full" /> : null}
      </div>
      <SidebarBody {...props} />
    </aside>
  );
}

/** Sections, channels and account controls: shared by the desktop sidebar and the drawer. */
function SidebarBody({
  counts,
  channels,
  items,
  activeChannel,
  onChannel,
  onAddChannel,
  onEditChannel,
  onDeleteChannel,
  ...shell
}: SidebarProps) {
  const { activeTab, onTab, account } = shell;
  return (
    <>
      <nav aria-label="Sections" className="mt-2 space-y-0.5 px-3">
        {TABS.map(({ key, label, icon: Icon, iconClass }) => {
          const on = activeTab === key && !(key === 'library' && activeChannel !== 'all');
          const count = counts[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors pointer-coarse:h-11 pointer-coarse:text-[15px]',
                on
                  ? 'bg-surface text-text shadow-sm ring-1 ring-border'
                  : 'text-muted hover:bg-surface-2 hover:text-text'
              )}
            >
              {on ? <span className="absolute -left-3 top-2 h-5 w-1 rounded-r-full bg-accent" aria-hidden="true" /> : null}
              {key === 'chat' ? (
                <SlateAvatar size={18} chip={false} />
              ) : (
                <Icon className={cx('h-4 w-4', iconClass)} aria-hidden="true" />
              )}
              {label}
              {count !== null ? (
                <span
                  className={cx(
                    'ml-auto rounded-md px-1.5 text-[11px] font-semibold tabular-nums',
                    on ? 'bg-surface-2 text-muted' : 'text-faint'
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
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          {channels.length === 0 ? (
            <div className="px-2.5 py-1.5">
              <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">No channels yet</p>
              <p className="mt-0.5 text-[12px] leading-snug text-zinc-400 dark:text-zinc-500">Your channels will appear here when you add them.</p>
            </div>
          ) : null}
          <div className="space-y-0.5">
            {channels.map((ch) => {
              const on = activeTab === 'library' && activeChannel === String(ch.id);
              const n = items.filter((i) => postInChannel(i, ch, channels)).length;
              const platform = platformOfChannel(ch, items, channels);
              return (
                <div key={ch.id} className="group/ch relative">
                <button
                  type="button"
                  onClick={() => onChannel(on ? 'all' : String(ch.id))}
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
                    <PlatformIcon platform={platform} size={18} colored />
                  ) : (
                    <Hash className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-[13px]', on && 'font-semibold')}>{ch.name}</span>
                    {ch.handle ? <span className="block truncate text-[11px] text-zinc-400">{ch.handle}</span> : null}
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-400 transition-opacity group-hover/ch:opacity-0 group-focus-within/ch:opacity-0 pointer-coarse:hidden">{n}</span>
                </button>
                <div className="absolute right-1 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover/ch:opacity-100 group-focus-within/ch:opacity-100 has-[[aria-expanded=true]]:opacity-100 pointer-coarse:opacity-100">
                  <ActionMenu
                    label={`More for ${ch.name}`}
                    items={[
                      { label: 'Edit channel', icon: Pencil, onSelect: () => onEditChannel(ch) },
                      { label: 'Delete channel', icon: Trash2, onSelect: () => onDeleteChannel(ch), tone: 'danger' },
                    ]}
                  />
                </div>
                </div>
              );
            })}
          </div>
      </div>

      <div className="space-y-2 p-3">
        {account.isPreview ? (
          <div data-preview-badge className="relative overflow-hidden rounded-2xl border border-border bg-surface-2 p-3.5">
            <p className="flex items-center gap-1.5 text-[12px] font-bold text-text">
              <span className="h-1.5 w-1.5 rounded-full bg-faint" aria-hidden="true" />
              Demo workspace
            </p>
            <p className="mt-1 text-[12px] leading-snug text-zinc-600 dark:text-zinc-400">
              Try anything here. Changes reset when you refresh. Sign in to keep your Backlot.
            </p>
            {shell.onSignIn ? (
              <button
                type="button"
                onClick={shell.onSignIn}
                className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-surface text-[12.5px] font-semibold text-text shadow-sm ring-1 ring-border transition-colors hover:bg-bg"
              >
                <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
                Sign in
              </button>
            ) : null}
          </div>
        ) : null}
        <SidebarAccount account={account} onSignOut={shell.onSignOut} onOpenSettings={shell.onOpenSettings} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Phones and tablets: slide-out drawer                                */
/* ------------------------------------------------------------------ */

/** The full sidebar as a drawer (below 1024px). Picking a destination closes it. */
export function NavDrawer({ open, onClose, ...props }: SidebarProps & { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <NavDrawerPanel {...props} onClose={onClose} />;
}

function NavDrawerPanel({ onClose, ...props }: SidebarProps & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useModalLayer(panelRef, onClose);

  // The permanent sidebar takes over at desktop widths (e.g. rotating a tablet).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => mq.matches && onCloseRef.current();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [onCloseRef]);

  const thenClose =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      onClose();
      fn(...args);
    };

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="animate-fade-in absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px] dark:bg-black/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        id="app-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        data-sheet-panel
        className="animate-drawer-in absolute inset-y-0 left-0 flex w-[min(18rem,86vw)] flex-col border-r border-border bg-bg pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-2xl outline-none"
      >
        <div className="flex h-14 shrink-0 items-center justify-between pl-5 pr-2">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse sidebar"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <PanelLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <SidebarBody
          {...props}
          onTab={thenClose(props.onTab)}
          onChannel={thenClose(props.onChannel)}
          onAddChannel={thenClose(props.onAddChannel)}
          onEditChannel={thenClose(props.onEditChannel)}
          onDeleteChannel={thenClose(props.onDeleteChannel)}
          onOpenSettings={props.onOpenSettings ? thenClose(props.onOpenSettings) : undefined}
          onSignIn={props.onSignIn ? thenClose(props.onSignIn) : undefined}
        />
      </div>
    </div>
  );
}

/** Tablets (768–1023px): a collapsed icon rail. Icons switch pages. The profile icon opens account actions. */
export function TabletRail({
  activeTab,
  onTab,
  activeChannel,
  channels,
  items,
  onChannel,
  onAddChannel,
  account,
  onSignOut,
  onOpenSettings,
}: Pick<
  SidebarProps,
  | 'activeTab'
  | 'onTab'
  | 'activeChannel'
  | 'channels'
  | 'items'
  | 'onChannel'
  | 'onAddChannel'
  | 'account'
  | 'onSignOut'
  | 'onOpenSettings'
>) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-16 flex-col items-center border-r border-border bg-bg pb-[env(safe-area-inset-bottom)] pt-[calc(0.5rem+env(safe-area-inset-top))] md:flex lg:hidden">
      <div className="mb-3 mt-1 flex flex-col items-center gap-2">
        <LogoMark />
      </div>
      <nav aria-label="Sections" className="flex flex-col items-center gap-1">
        {TABS.map(({ key, label, icon: Icon, iconClass }) => {
          const on = activeTab === key && !(key === 'library' && activeChannel !== 'all');
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTab(key)}
              aria-label={label}
              title={label}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors',
                on
                  ? 'bg-surface text-text shadow-sm ring-1 ring-border'
                  : 'text-muted hover:bg-surface-2 hover:text-text'
              )}
            >
              {on ? <span className="absolute -left-2.5 top-3 h-5 w-1 rounded-r-full bg-accent" aria-hidden="true" /> : null}
              {key === 'chat' ? (
                <SlateAvatar size={20} chip={false} />
              ) : (
                <Icon className={cx('h-5 w-5', iconClass)} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-3 w-8 border-t border-border" aria-hidden="true" />
      <div className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto no-scrollbar">
        <p className="sr-only">Your channels</p>
        {channels.map((ch) => {
          const on = activeTab === 'library' && activeChannel === String(ch.id);
          const platform = platformOfChannel(ch, items, channels);
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => onChannel(on ? 'all' : String(ch.id))}
              aria-pressed={on}
              aria-label={ch.name}
              title={ch.name}
              className={cx(
                'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors',
                on
                  ? 'bg-surface text-link shadow-sm ring-1 ring-border'
                  : 'text-muted hover:bg-surface-2 hover:text-text'
              )}
            >
              {on ? <span className="absolute -left-2.5 top-3 h-5 w-1 rounded-r-full bg-accent" aria-hidden="true" /> : null}
              {platform ? (
                <PlatformIcon platform={platform} size={20} colored />
              ) : (
                <Hash className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddChannel}
          aria-label="Add channel"
          title="Add channel"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-auto flex w-full shrink-0 justify-center border-t border-border px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <AccountMenu
          account={account}
          onSignOut={onSignOut}
          onOpenSettings={onOpenSettings}
          avatarSize={32}
          buttonClassName="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface ring-1 ring-border"
          menuClassName="bottom-0 left-full ml-3 origin-bottom-left"
        />
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
        'flex h-9 items-center justify-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-text transition-colors hover:border-border-strong',
        className
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to home
    </Link>
  );
}

/** Phones (below 768px): logo and account. Sections live in the bottom tab bar. */
export function MobileTopBar(shell: ShellProps) {
  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-bg pt-[env(safe-area-inset-top)] md:hidden">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 pl-4 pr-4 sm:pr-6">
        <div className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[16px] font-bold tracking-tight">Backlot</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AccountMenu
            account={shell.account}
            onSignOut={shell.onSignOut}
            onOpenSettings={shell.onOpenSettings}
            avatarSize={32}
            buttonClassName="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface ring-1 ring-border"
          />
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Phone tab bar                                                       */
/* ------------------------------------------------------------------ */

/** Phones: Library, Ideas, create, Calendar, Slate. Account stays in the header. */
export function PhoneTabBar({ activeTab, onTab, onNew }: { activeTab: ActiveTab; onTab: (t: ActiveTab) => void; onNew: () => void }) {
  const left = TABS.filter((t) => t.key === 'library' || t.key === 'ideas');
  const right = TABS.filter((t) => t.key === 'calendar' || t.key === 'chat');
  const tab = (key: ActiveTab, label: string, Icon: React.ElementType, iconClass: string) => {
    const on = activeTab === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onTab(key)}
        aria-current={on ? 'page' : undefined}
        className={cx('flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold', on ? 'text-text' : 'text-muted')}
      >
        {key === 'chat' ? <SlateAvatar size={20} chip={false} /> : <Icon className={cx('h-5 w-5', iconClass)} aria-hidden="true" />}
        {label}
      </button>
    );
  };
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid grid-cols-5 items-center px-1">
        {left.map(({ key, label, icon, iconClass }) => tab(key, label, icon, iconClass))}
        <div className="flex items-center justify-center">
          <button type="button" onClick={onNew} aria-label="Create" className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-white shadow-sm">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {right.map(({ key, short, icon, iconClass }) => tab(key, short, icon, iconClass))}
      </div>
    </nav>
  );
}
