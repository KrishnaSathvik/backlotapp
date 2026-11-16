'use client';

import React, { useState } from 'react';
import {
  Check,
  Copy,
  Film,
  Layers,
  Lightbulb,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  formatTagsForCopy,
  getPlatformShortLabel,
  getStatusLabel,
  PLATFORM_OPTIONS,
  STATUS_OPTIONS,
  type ChannelItem,
  type ContentItem,
  type LibraryFilters,
  type PlatformKey,
  type StatusKey,
} from '@/src/lib/content-logic';
import { FilterDropdown } from './CustomSelect';
import { MediaImage } from './MediaImage';

interface LibraryViewProps {
  items: ContentItem[];
  totalItemsCount: number;
  channels: ChannelItem[];
  filters: LibraryFilters;
  onFiltersChange: (next: LibraryFilters) => void;
  onSelectItem: (item: ContentItem) => void;
  onCreateNew: () => void;
  onOpenIdeas: () => void;
  onAddChannel: (name: string, handle: string) => Promise<void>;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  items,
  totalItemsCount,
  channels,
  filters,
  onFiltersChange,
  onSelectItem,
  onCreateNew,
  onOpenIdeas,
  onAddChannel,
}) => {
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelHandle, setChannelHandle] = useState('');
  const [channelError, setChannelError] = useState('');

  const handleQuickCopyCaption = async (
    e: React.MouseEvent,
    item: ContentItem
  ) => {
    e.stopPropagation();
    const parts = [item.caption.trim(), formatTagsForCopy(item.tags)].filter(Boolean);
    if (!parts.length) return;
    try {
      await navigator.clipboard.writeText(parts.join('\n\n'));
      setCopiedId(item.id);
      setTimeout(() => setCopiedId((prev) => (prev === item.id ? null : prev)), 1500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCreateChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim()) {
      setChannelError('Channel name is required.');
      return;
    }
    setChannelError('');
    await onAddChannel(channelName.trim(), channelHandle.trim());
    setChannelName('');
    setChannelHandle('');
    setShowChannelForm(false);
  };

  const hasActiveFilters =
    filters.platform !== 'all' ||
    filters.channel !== 'all' ||
    filters.status !== 'all' ||
    filters.search.trim() !== '';

  const resetFilters = () => {
    onFiltersChange({
      platform: 'all',
      channel: 'all',
      status: 'all',
      search: '',
    });
  };

  return (
    <section aria-label="Content Library" className="space-y-5">
      {/* Toolbar: Search + Channel + Stage + Add Channel */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            placeholder="Search title, caption, or tag..."
            aria-label="Search library by title, caption, or tag"
            className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-8 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500"
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, search: '' })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            label="Channel"
            ariaLabel="Filter by channel"
            allLabel="All Channels"
            emptyHint="No channels added yet"
            value={filters.channel}
            options={channels.map((ch) => ({
              value: ch.name,
              label: ch.name,
            }))}
            onChange={(val) => onFiltersChange({ ...filters, channel: val })}
          />

          <FilterDropdown
            label="Stage"
            ariaLabel="Filter by stage"
            allLabel="All Stages"
            value={filters.status}
            options={STATUS_OPTIONS.map((st) => ({
              value: st.key,
              label: st.label,
            }))}
            onChange={(val) =>
              onFiltersChange({
                ...filters,
                status: val as StatusKey | 'all',
              })
            }
          />

          <button
            type="button"
            onClick={() => setShowChannelForm((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              showChannelForm
                ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800'
            }`}
          >
            <Plus className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            Add Channel
          </button>

          {hasActiveFilters ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30 whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {showChannelForm ? (
        <form
          onSubmit={handleCreateChannelSubmit}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:flex-row sm:items-end dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex-1">
            <label
              htmlFor="new-channel-name"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Brand / Channel Name
            </label>
            <input
              id="new-channel-name"
              type="text"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="e.g. Main Channel"
              className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor="new-channel-handle"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Handle (optional)
            </label>
            <input
              id="new-channel-handle"
              type="text"
              value={channelHandle}
              onChange={(e) => setChannelHandle(e.target.value)}
              placeholder="@mainchannel"
              className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              Save Channel
            </button>
            <button
              type="button"
              onClick={() => setShowChannelForm(false)}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          {channelError ? (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {channelError}
            </p>
          ) : null}
        </form>
      ) : null}

      {/* Platform Segmented Bar */}
      <div
        role="tablist"
        aria-label="Filter by platform"
        className="flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50/90 p-1 dark:border-zinc-800 dark:bg-zinc-900/90"
      >
        <button
          type="button"
          role="tab"
          aria-selected={filters.platform === 'all'}
          onClick={() => onFiltersChange({ ...filters, platform: 'all' })}
          className={`h-8 rounded-lg px-3 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
            filters.platform === 'all'
              ? 'bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-950 dark:text-white dark:ring-zinc-800'
              : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          All Platforms
        </button>
        {PLATFORM_OPTIONS.map((p) => {
          const active = filters.platform === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() =>
                onFiltersChange({ ...filters, platform: p.key as PlatformKey })
              }
              className={`h-8 rounded-lg px-3 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-white text-blue-600 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-950 dark:text-blue-400 dark:ring-zinc-800'
                  : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Empty States or Cover Grid */}
      {totalItemsCount === 0 ? (
        <div
          data-testid="library-empty-state"
          className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-6 sm:p-10 dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">
              Your Content Library is empty
            </h2>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              Keep every YouTube video, Short, Instagram Reel, carousel, cover image, caption, and tag organized in one place. Here is how to get started:
            </p>
          </div>

          <div className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950">
              <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                01 · CHANNEL
              </span>
              <h3 className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Add your channel
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Optional: click <strong>+ Add Channel</strong> above to group posts by YouTube channel or Instagram account.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950">
              <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                02 · UPLOAD
              </span>
              <h3 className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Add post & files
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Click <strong>+ New Post</strong>, enter a title, and drop your video, cover, or carousel slides with captions & tags.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-left dark:border-zinc-800 dark:bg-zinc-950">
              <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                03 · REUSE
              </span>
              <h3 className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Copy, download & track
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Copy captions/tags with one tap, download individual files or a .zip bundle, and follow stages in <strong>Tracker</strong>.
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Your First Post
            </button>
            <button
              type="button"
              onClick={() => setShowChannelForm(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Plus className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              Add a Channel
            </button>
            <button
              type="button"
              onClick={onOpenIdeas}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              Save an Idea First
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No posts match your current filters
          </p>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Reset your channel, stage, or search filters to view your saved posts.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              Reset Filters
            </button>
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Post
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="library-grid"
          className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {items.map((item) => {
            const thumbUrl =
              item.coverAsset?.url || item.slides[0]?.url || null;
            const isVertical =
              item.platform === 'youtube_shorts' ||
              item.platform === 'instagram_reel';
            const slideCount = item.slides.length;

            return (
              <article
                key={item.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                <button
                  type="button"
                  onClick={() => onSelectItem(item)}
                  aria-label={`Open ${item.title}`}
                  className="relative aspect-[4/3] w-full overflow-hidden bg-zinc-100 text-left focus-visible:outline-2 focus-visible:outline-blue-600 dark:bg-zinc-950"
                >
                  <MediaImage
                    src={thumbUrl}
                    alt={`${item.title} cover`}
                    fallbackLabel={item.title}
                    isVideo={!!item.videoAsset}
                    className={`h-full w-full transition-transform duration-200 group-hover:scale-[1.02] ${
                      isVertical ? 'object-cover object-center' : 'object-cover'
                    }`}
                  />
                  {(item.videoAsset || slideCount > 0) && (
                    <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1.5 rounded-md bg-black/75 px-2 py-1 text-[11px] font-medium text-white tabular-nums">
                      {item.videoAsset ? (
                        <Film className="h-3 w-3" aria-hidden="true" />
                      ) : null}
                      {slideCount > 0 ? (
                        <>
                          <Layers className="h-3 w-3" aria-hidden="true" />
                          <span>{slideCount} slides</span>
                        </>
                      ) : (
                        <span>Video</span>
                      )}
                    </div>
                  )}
                </button>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-blue-600 whitespace-nowrap shrink-0 dark:text-blue-400">
                        {getPlatformShortLabel(item.platform)}
                      </span>
                      {item.channelName ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="min-w-0 truncate">{item.channelName}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-zinc-700 whitespace-nowrap shrink-0 dark:text-zinc-300">
                        {getStatusLabel(item.status)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      className="mt-1.5 block text-left text-base font-semibold leading-snug text-zinc-950 hover:text-blue-600 dark:text-zinc-50 dark:hover:text-blue-400"
                    >
                      {item.title}
                    </button>

                    {item.caption ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {item.caption}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {item.tags.length > 0
                        ? formatTagsForCopy(item.tags.slice(0, 3))
                        : item.postDate || item.targetDate || 'No tags'}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => handleQuickCopyCaption(e, item)}
                      aria-label={`Copy caption and tags for ${item.title}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy</span>
                        </>
                      )}
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
