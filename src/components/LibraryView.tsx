'use client';

import React, { useState } from 'react';
import {
  Calendar,
  Check,
  Copy,
  Film,
  FolderPlus,
  Layers,
  Lightbulb,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import {
  channelPlatform,
  formatTagsForCopy,
  getPlatformShortLabel,
  PLATFORM_OPTIONS,
  SORT_OPTIONS,
  sortContentItems,
  type ChannelItem,
  type ContentItem,
  type LibraryFilters,
  type LibrarySort,
  type PlatformKey,
} from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { MediaImage } from './MediaImage';
import {
  buttonStyles,
  cardStyles,
  copyToClipboard,
  cx,
  inputStyles,
  Sheet,
  SheetCloseButton,
  sizes,
  StagePill,
  useFeedback,
} from './ui';

interface LibraryViewProps {
  items: ContentItem[];
  totalItemsCount: number;
  /** Every post (unfiltered), for channel counts and logos. */
  allItems: ContentItem[];
  channels: ChannelItem[];
  filters: LibraryFilters;
  onFiltersChange: (next: LibraryFilters) => void;
  onSelectItem: (item: ContentItem) => void;
  onCreateNew: () => void;
  onOpenIdeas: () => void;
  /** Opens the add-channel dialog (also in the sidebar on desktop). */
  onAddChannel: () => void;
}

const EMPTY_FILTERS: LibraryFilters = { platform: 'all', channel: 'all', status: 'all', search: '' };

export const LibraryView: React.FC<LibraryViewProps> = ({
  items,
  totalItemsCount,
  allItems,
  channels,
  filters,
  onFiltersChange,
  onSelectItem,
  onCreateNew,
  onOpenIdeas,
  onAddChannel,
}) => {
  const { toast } = useFeedback();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('updated');
  const sortedItems = sortContentItems(items, sort);

  const handleQuickCopy = async (e: React.MouseEvent, item: ContentItem) => {
    e.stopPropagation();
    const parts = [item.caption.trim(), formatTagsForCopy(item.tags)].filter(Boolean);
    if (!parts.length) {
      toast('Nothing to copy yet — add a caption or tags', 'info');
      return;
    }
    if (await copyToClipboard(parts.join('\n\n'))) {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500);
    } else {
      toast('Could not copy to clipboard', 'error');
    }
  };

  // The channel is the page you're on, not a filter: clearing keeps it.
  const hasActiveFilters = filters.platform !== 'all' || filters.status !== 'all' || filters.search.trim() !== '';
  // Platforms that have posts in the current scope (a channel page, or the whole library).
  const scopePosts = filters.channel === 'all' ? allItems : allItems.filter((i) => i.channelName.toLowerCase() === filters.channel.toLowerCase());
  const platformOptions = PLATFORM_OPTIONS.filter((p) => scopePosts.some((i) => i.platform === p.key));
  const clearFilters = () => onFiltersChange({ ...EMPTY_FILTERS, channel: filters.channel });
  // Phones and tablets: channel, platform and sort live in one Filters sheet.
  const sheetFilterCount = (filters.channel !== 'all' ? 1 : 0) + (filters.platform !== 'all' ? 1 : 0);

  const chip = (active: boolean) =>
    cx(
      'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-all',
      active
        ? 'bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-zinc-950'
        : 'border border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
    );

  if (totalItemsCount === 0) {
    return (
      <section aria-label="Content library" className="space-y-4">
        <div data-testid="library-empty-state" className={cx(cardStyles, 'overflow-hidden')}>
          <div className="relative px-6 pb-8 pt-10 text-center sm:px-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-electric-50 to-transparent dark:from-electric-950/30"
            />
            <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-500 to-electric-700 text-white shadow-lg shadow-electric-600/30">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="relative mt-5 text-xl font-bold tracking-tight">Your backlot is empty</h2>
            <p className="relative mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Keep every video, Short, Reel and carousel — with its cover, caption and tags — in one place.
            </p>
            <div className="relative mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
              <button type="button" onClick={onCreateNew} className={cx(buttonStyles.primary, sizes.lg)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first post
              </button>
            </div>
          </div>

          <div className="grid border-t border-zinc-100 sm:grid-cols-3 dark:border-zinc-800">
            {[
              {
                icon: FolderPlus,
                title: 'Add a channel',
                text: 'Group posts by YouTube channel or Instagram account.',
                action: onAddChannel,
                cta: 'Add channel',
              },
              {
                icon: Lightbulb,
                title: 'Capture ideas',
                text: 'Save links and screenshots, then turn them into posts.',
                action: onOpenIdeas,
                cta: 'Open Ideas',
              },
              {
                icon: Copy,
                title: 'Copy in one tap',
                text: 'Captions and tags are ready to paste when you publish.',
                action: onCreateNew,
                cta: 'New post',
              },
            ].map(({ icon: Icon, title, text, action, cta }) => (
              <div
                key={title}
                className="flex flex-col gap-2 border-zinc-100 p-5 sm:border-l sm:first:border-l-0 [&:not(:first-child)]:border-t sm:[&:not(:first-child)]:border-t-0 dark:border-zinc-800"
              >
                <Icon className="h-5 w-5 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{text}</p>
                <button
                  type="button"
                  onClick={action}
                  className="mt-auto self-start text-[13px] font-semibold text-electric-600 hover:underline dark:text-electric-400"
                >
                  {cta} →
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Content library" className="space-y-4">
      {/* Search + filters */}
      <div className="flex items-center gap-2.5">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Search titles, captions, tags…"
            aria-label="Search library"
            className={cx(inputStyles, 'h-11 pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden')}
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, search: '' })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className={cx(buttonStyles.secondary, 'relative h-11 shrink-0 px-3.5 text-[13px] lg:hidden')}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filters
          {sheetFilterCount ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-electric-600 px-1.5 text-[11px] font-bold text-white tabular-nums">
              {sheetFilterCount}
            </span>
          ) : null}
        </button>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className={cx(buttonStyles.ghost, 'h-10 shrink-0 px-3 text-[13px] text-electric-600 dark:text-electric-400')}
            >
              Clear filters
            </button>
          ) : null}
          <FormSelect
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            aria-label="Sort posts"
            className="h-10 pr-9 text-[13px] font-semibold"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </FormSelect>
        </div>
      </div>

      {/* Platform chips (desktop): only platforms this view has; hidden when there is just one */}
      {platformOptions.length > 1 ? (
      <div
        role="tablist"
        aria-label="Filter by platform"
        className="hidden items-center gap-2 lg:flex lg:flex-wrap"
      >
        {[{ key: 'all' as const, label: 'All' }, ...platformOptions].map((p) => {
          const active = filters.platform === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFiltersChange({ ...filters, platform: p.key as PlatformKey | 'all' })}
              className={cx(
                'flex h-10 shrink-0 items-center gap-2 rounded-full pl-2.5 pr-4 text-[13px] font-semibold transition-all',
                p.key === 'all' && 'pl-4',
                active
                  ? 'bg-zinc-950 text-white shadow-sm dark:bg-white dark:text-zinc-950'
                  : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-white'
              )}
            >
              {p.key === 'all' ? null : <PlatformIcon platform={p.key as PlatformKey} size={20} />}
              {p.label}
            </button>
          );
        })}
      </div>
      ) : null}

      {filtersOpen ? (
        <Sheet onClose={() => setFiltersOpen(false)} label="Filters" size="sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 pb-3 pt-3 sm:pt-5 dark:border-zinc-800">
            <h2 className="text-lg font-bold tracking-tight">Filters</h2>
            <SheetCloseButton onClick={() => setFiltersOpen(false)} />
          </div>
          <div className="space-y-5 overflow-y-auto px-5 py-4">
            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Channel</legend>
              <div className="flex flex-wrap gap-2">
                {[{ id: -1, name: 'all', handle: '' }, ...channels].map((ch) => {
                  const isAll = ch.id === -1;
                  const platform = isAll ? null : channelPlatform(allItems, ch.name);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      aria-pressed={filters.channel.toLowerCase() === ch.name.toLowerCase()}
                      onClick={() => onFiltersChange({ ...filters, channel: ch.name, platform: 'all' })}
                      className={chip(filters.channel.toLowerCase() === ch.name.toLowerCase())}
                    >
                      {platform ? <PlatformIcon platform={platform} size={16} /> : null}
                      {isAll ? 'All channels' : ch.name}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setFiltersOpen(false);
                    onAddChannel();
                  }}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-zinc-300 px-3.5 text-[13px] font-semibold text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add channel
                </button>
              </div>
            </fieldset>

            {platformOptions.length > 1 ? (
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Platform</legend>
                <div className="flex flex-wrap gap-2">
                  {[{ key: 'all' as const, label: 'All platforms' }, ...platformOptions].map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={filters.platform === p.key}
                      onClick={() => onFiltersChange({ ...filters, platform: p.key as PlatformKey | 'all' })}
                      className={chip(filters.platform === p.key)}
                    >
                      {p.key === 'all' ? null : <PlatformIcon platform={p.key as PlatformKey} size={16} />}
                      {p.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset>
              <legend className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Sort by</legend>
              <div className="flex flex-wrap gap-2">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    aria-pressed={sort === o.key}
                    onClick={() => setSort(o.key)}
                    className={chip(sort === o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex gap-2 border-t border-zinc-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                onFiltersChange({ ...EMPTY_FILTERS, search: filters.search });
                setSort('updated');
              }}
              className={cx(buttonStyles.secondary, sizes.md, 'flex-1')}
            >
              Reset
            </button>
            <button type="button" onClick={() => setFiltersOpen(false)} className={cx(buttonStyles.primary, sizes.md, 'flex-1')}>
              Done
            </button>
          </div>
        </Sheet>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-800">
          <Search className="h-6 w-6 text-zinc-400" aria-hidden="true" />
          <p className="mt-3 text-base font-semibold">No posts match these filters</p>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Try a different search, or clear the filters to see everything.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className={cx(buttonStyles.secondary, sizes.md, 'mt-5')}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div
          data-testid="library-grid"
          className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4"
        >
          {sortedItems.map((item) => {
            const thumbUrl = item.coverAsset?.url || item.slides[0]?.url || null;
            const slideCount = item.slides.length;
            const date = item.postDate || item.targetDate;

            return (
              <article
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100 dark:bg-zinc-800/50">
                  <MediaImage
                    src={thumbUrl}
                    alt=""
                    fallbackLabel={item.title}
                    isVideo={!!item.videoAsset}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
                    <StagePill status={item.status} className="bg-white/90 shadow-sm backdrop-blur dark:bg-zinc-900/85" />
                    {item.videoAsset || slideCount > 0 ? (
                      <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur tabular-nums">
                        {slideCount > 0 ? (
                          <>
                            <Layers className="h-3 w-3" aria-hidden="true" />
                            {slideCount}
                          </>
                        ) : (
                          <>
                            <Film className="h-3 w-3" aria-hidden="true" />
                            Video
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <PlatformIcon platform={item.platform} size={16} />
                    <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">
                      {getPlatformShortLabel(item.platform)}
                    </span>
                    {item.channelName ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="min-w-0 truncate">{item.channelName}</span>
                      </>
                    ) : null}
                  </div>

                  <h3 className="mt-1.5 line-clamp-2 font-display text-[16.5px] font-bold leading-snug tracking-tight">
                    {/* Stretched link: the whole card opens the post. */}
                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                    >
                      {item.title}
                    </button>
                  </h3>

                  {item.caption ? (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {item.caption}
                    </p>
                  ) : null}

                  <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                      {date ? (
                        <>
                          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {date}
                        </>
                      ) : item.tags.length ? (
                        <span className="truncate font-mono">{formatTagsForCopy(item.tags.slice(0, 3))}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleQuickCopy(e, item)}
                      aria-label={`Copy caption and tags for ${item.title}`}
                      className={cx(
                        'relative z-10 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors',
                        copiedId === item.id
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                      )}
                    >
                      {copiedId === item.id ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {copiedId === item.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
