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
  Sparkles,
  X,
} from 'lucide-react';
import {
  channelPlatform,
  formatTagsForCopy,
  getPlatformShortLabel,
  PLATFORM_OPTIONS,
  type ChannelItem,
  type ContentItem,
  type LibraryFilters,
  type PlatformKey,
} from '@/src/lib/content-logic';
import { PlatformIcon } from './PlatformIcon';
import { MediaImage } from './MediaImage';
import {
  buttonStyles,
  cardStyles,
  copyToClipboard,
  cx,
  inputStyles,
  labelStyles,
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
  onAddChannel: (name: string, handle: string) => Promise<boolean>;
  /** Demo mode: browse only. */
  readOnly?: boolean;
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
  readOnly = false,
}) => {
  const { toast } = useFeedback();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelHandle, setChannelHandle] = useState('');
  const [channelError, setChannelError] = useState('');
  const [savingChannel, setSavingChannel] = useState(false);

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

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim()) {
      setChannelError('Channel name is required.');
      return;
    }
    setChannelError('');
    setSavingChannel(true);
    const ok = await onAddChannel(channelName.trim(), channelHandle.trim());
    setSavingChannel(false);
    if (ok) {
      setChannelName('');
      setChannelHandle('');
      setShowChannelForm(false);
    }
  };

  const hasActiveFilters =
    filters.platform !== 'all' ||
    filters.channel !== 'all' ||
    filters.status !== 'all' ||
    filters.search.trim() !== '';

  const channelForm = showChannelForm ? (
    <form
      onSubmit={handleCreateChannel}
      className={cx(cardStyles, 'animate-pop-in grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end')}
    >
      <div>
        <label htmlFor="new-channel-name" className={labelStyles}>
          Channel or brand name
        </label>
        <input
          id="new-channel-name"
          autoFocus
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          placeholder="e.g. Main Channel"
          maxLength={120}
          className={cx(inputStyles, 'h-11')}
        />
      </div>
      <div>
        <label htmlFor="new-channel-handle" className={labelStyles}>
          Handle <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="new-channel-handle"
          value={channelHandle}
          onChange={(e) => setChannelHandle(e.target.value)}
          placeholder="@mainchannel"
          maxLength={120}
          className={cx(inputStyles, 'h-11')}
        />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setShowChannelForm(false)} className={cx(buttonStyles.secondary, 'h-11 px-4 text-sm')}>
          Cancel
        </button>
        <button type="submit" disabled={savingChannel} className={cx(buttonStyles.primary, 'h-11 flex-1 px-4 text-sm sm:flex-none')}>
          {savingChannel ? 'Saving…' : 'Save channel'}
        </button>
      </div>
      {channelError ? (
        <p className="text-xs font-medium text-red-600 sm:col-span-3 dark:text-red-400">{channelError}</p>
      ) : null}
    </form>
  ) : null;

  if (totalItemsCount === 0) {
    return (
      <section aria-label="Content library" className="space-y-4">
        {channelForm}
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
                action: () => setShowChannelForm(true),
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
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
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

        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          {filters.channel !== 'all' ? (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, channel: 'all' })}
              aria-label={`Remove channel filter ${filters.channel}`}
              className="hidden h-10 items-center gap-1.5 rounded-xl bg-electric-50 px-3 lg:flex text-[13px] font-semibold text-electric-700 ring-1 ring-electric-200 transition-colors hover:bg-electric-100 dark:bg-electric-950/50 dark:text-electric-300 dark:ring-electric-900"
            >
              # {filters.channel}
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {readOnly ? null : (
          <button
            type="button"
            onClick={() => setShowChannelForm((v) => !v)}
            aria-expanded={showChannelForm}
            aria-label="Add channel"
            title="Add channel"
            className={cx(buttonStyles.secondary, 'h-10 shrink-0 px-3 text-[13px] min-[400px]:px-3.5')}
          >
            <FolderPlus className="h-4 w-4 text-electric-600 dark:text-electric-400" aria-hidden="true" />
            <span className="hidden min-[400px]:inline">Channel</span>
          </button>
          )}
          {hasActiveFilters ? (
            // Desktop only: on phones the "All" chips clear each filter.
            <div className="hidden lg:block">
              <button
                type="button"
                onClick={() => onFiltersChange(EMPTY_FILTERS)}
                className={cx(buttonStyles.ghost, 'h-10 shrink-0 px-3 text-[13px] text-electric-600 dark:text-electric-400')}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {channelForm}

      {/* Channel chips (phones and tablets; desktop uses the sidebar) */}
      {channels.length ? (
        <div
          role="tablist"
          aria-label="Filter by channel"
          className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:hidden"
        >
          {[{ id: -1, name: 'all', handle: '' }, ...channels].map((ch) => {
            const isAll = ch.id === -1;
            const active = filters.channel === ch.name;
            const platform = isAll ? null : channelPlatform(allItems, ch.name);
            return (
              <button
                key={ch.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onFiltersChange({ ...filters, channel: ch.name })}
                className={cx(
                  'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-all',
                  active
                    ? 'bg-electric-600 text-white shadow-sm'
                    : 'border border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300'
                )}
              >
                {platform ? <PlatformIcon platform={platform} size={16} /> : null}
                {isAll ? 'All channels' : ch.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Platform chips */}
      <div
        role="tablist"
        aria-label="Filter by platform"
        className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        {[{ key: 'all' as const, label: 'All' }, ...PLATFORM_OPTIONS].map((p) => {
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

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-800">
          <Search className="h-6 w-6 text-zinc-400" aria-hidden="true" />
          <p className="mt-3 text-base font-semibold">No posts match these filters</p>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Try a different search, or clear the filters to see everything.
          </p>
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
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
          {items.map((item) => {
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
