'use client';

import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { getPlatformShortLabel, type ChannelItem, type ContentItem } from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { MediaImage } from './MediaImage';
import { PlatformIcon } from './PlatformIcon';
import { cx, StagePill, STAGE_STYLES } from './ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** The day a post belongs on: when it went live, otherwise when it's planned for. */
const dayOf = (item: ContentItem) => item.postDate || item.targetDate || '';

function todayKey() {
  const t = new Date();
  return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
}

function prettyDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

interface CalendarViewProps {
  items: ContentItem[];
  channels: ChannelItem[];
  onSelectItem: (item: ContentItem) => void;
}

/** Month view of posts by target or posted date. Read-only: opening a post edits it as usual. */
export function CalendarView({ items, channels, onSelectItem }: CalendarViewProps) {
  const today = todayKey();
  const [cursor, setCursor] = useState(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [channel, setChannel] = useState('all');

  const scoped = channel === 'all' ? items : items.filter((i) => i.channelName === channel);

  const byDay = useMemo(() => {
    const map = new Map<string, ContentItem[]>();
    for (const item of scoped) {
      const day = dayOf(item);
      if (!day) continue;
      const list = map.get(day) ?? [];
      list.push(item);
      map.set(day, list);
    }
    return map;
  }, [scoped]);

  const { y, m } = cursor;
  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const monthPrefix = `${y}-${pad(m + 1)}-`;
  const inMonth = scoped.filter((i) => dayOf(i).startsWith(monthPrefix)).length;
  const undated = scoped.filter((i) => !dayOf(i)).length;
  const selectedItems = byDay.get(selected) ?? [];
  const monthLabel = new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const shift = (delta: number) => {
    setCursor(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  const goToday = () => {
    const t = new Date();
    setCursor({ y: t.getFullYear(), m: t.getMonth() });
    setSelected(today);
  };

  const navBtn =
    'flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white';

  return (
    <section aria-label="Calendar" className="space-y-4">
      {/* Toolbar: month on the left; navigation and channel on the right */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <div className="mr-auto min-w-0">
          <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl" aria-live="polite">
            {monthLabel}
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-500 tabular-nums dark:text-zinc-400">
            {inMonth} {inMonth === 1 ? 'post' : 'posts'} this month
            {undated ? ` · ${undated} without a date` : ''}
          </p>
        </div>
        <div className="flex items-center rounded-full border border-zinc-200 bg-white p-0.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className={navBtn}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="h-9 rounded-full px-3 text-[13px] font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Today
          </button>
          <button type="button" onClick={() => shift(1)} aria-label="Next month" className={navBtn}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="w-full sm:w-48">
          <FormSelect value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
            <option value="all">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </FormSelect>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Month grid */}
        <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
          <div className="grid grid-cols-7 border-b border-zinc-100 dark:border-zinc-800">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <span className="sm:hidden">{d[0]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (!day)
                return <div key={`e${idx}`} className="min-h-14 border-b border-r border-zinc-100 bg-zinc-50/50 md:min-h-28 dark:border-zinc-800/70 dark:bg-zinc-950/20 [&:nth-child(7n)]:border-r-0" />;
              const key = keyOf(y, m, day);
              const list = byDay.get(key) ?? [];
              const isToday = key === today;
              const isSel = key === selected;
              return (
                <div
                  key={key}
                  className={cx(
                    'relative min-h-14 border-b border-r border-zinc-100 md:min-h-28 dark:border-zinc-800/70 [&:nth-child(7n)]:border-r-0',
                    isSel && 'bg-electric-50/60 dark:bg-electric-950/25'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelected(key)}
                    aria-label={`${prettyDay(key)}, ${list.length} ${list.length === 1 ? 'post' : 'posts'}`}
                    aria-pressed={isSel}
                    className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-electric-500"
                  />
                  <div className="pointer-events-none relative flex flex-col items-center p-1 md:items-stretch md:p-1.5">
                    <span
                      className={cx(
                        'flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums md:self-end',
                        isToday ? 'bg-electric-600 text-white' : 'text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      {day}
                    </span>
                    {/* Phones: one dot per post */}
                    {list.length ? (
                      <span className="mt-1 flex gap-0.5 md:hidden">
                        {list.slice(0, 3).map((i) => (
                          <span key={i.id} className={cx('h-1.5 w-1.5 rounded-full', STAGE_STYLES[i.status]?.dot ?? 'bg-zinc-400')} />
                        ))}
                      </span>
                    ) : null}
                    {/* Larger screens: post titles */}
                    <div className="mt-1 hidden space-y-1 md:block">
                      {list.slice(0, 2).map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => onSelectItem(i)}
                          className="pointer-events-auto flex w-full items-center gap-1.5 rounded-md bg-zinc-100 px-1.5 py-1 text-left text-[11.5px] font-medium text-zinc-800 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        >
                          <span className={cx('mt-[5px] h-1.5 w-1.5 shrink-0 self-start rounded-full', STAGE_STYLES[i.status]?.dot ?? 'bg-zinc-400')} />
                          <span className="line-clamp-2 leading-snug">{i.title}</span>
                        </button>
                      ))}
                      {list.length > 2 ? (
                        <p className="px-1.5 text-[11px] font-semibold text-zinc-500">+{list.length - 2} more</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected day */}
        <aside aria-label="Posts on the selected day" className="min-w-0 self-start rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">{prettyDay(selected)}</p>
          {selectedItems.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <CalendarDays className="h-6 w-6 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Nothing planned for this day.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {selectedItems.map((i) => {
                const thumb = i.coverAsset?.url || i.slides[0]?.url || null;
                return (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => onSelectItem(i)}
                      className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    >
                      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        {thumb ? <MediaImage src={thumb} alt="" className="h-full w-full object-cover" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{i.title}</span>
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          <PlatformIcon platform={i.platform} size={14} />
                          <span className="truncate">
                            {getPlatformShortLabel(i.platform)}
                            {i.channelName ? ` · ${i.channelName}` : ''}
                            {i.postDate ? ' · Posted' : ' · Target'}
                          </span>
                        </span>
                      </span>
                      <StagePill status={i.status} className="shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
