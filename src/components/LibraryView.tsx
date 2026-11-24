'use client';

import React, { useState } from 'react';
import { Calendar, Film, Layers, Sparkles } from 'lucide-react';
import {
  filterContentItems,
  getPlatformShortLabel,
  libraryCards,
  postInChannel,
  SORT_OPTIONS,
  sortContentItems,
  STATUS_OPTIONS,
  type ChannelItem,
  type ContentItem,
  type LibraryFilters,
  type LibrarySort,
  referencePreview,
} from '@/src/lib/content-logic';
import { firstPreviewLink } from '@/src/lib/link-preview';
import { FormSelect } from './CustomSelect';
import { LayoutToggle, useLayoutMode } from './LayoutToggle';
import { PostToChannelMenu } from './PostToChannelMenu';
import { PlatformIcon } from './PlatformIcon';
import { LinkThumbnail } from './LinkThumbnail';
import { FramedImage, MediaImage } from './MediaImage';
import { buttonStyles, chipClass, cx, PAGE_SIZE, Pager, StagePill } from './ui';

interface LibraryViewProps {
  items: ContentItem[];
  totalItemsCount: number;
  /** Every post (unfiltered), for channel counts and logos. */
  allItems: ContentItem[];
  /** For TikTok link thumbnails (YouTube's need nothing). */
  authToken?: string | null;
  filters: LibraryFilters;
  /** Page title. Null when a channel header already shows it. */
  heading?: string | null;
  channels: ChannelItem[];
  /** Every post, so another channel's platform mark stays right. */
  catalog: ContentItem[];
  onFiltersChange: (next: LibraryFilters) => void;
  onSelectItem: (item: ContentItem) => void;
  onCreateNew: () => void;
  /** Shown on a channel's posts. The main library leaves this off. */
  showPostTo?: boolean;
  onPostToChannel: (item: ContentItem, channel: ChannelItem) => Promise<void> | void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  items,
  totalItemsCount,
  allItems,
  authToken = null,
  filters,
  heading = 'Library',
  channels,
  catalog,
  onFiltersChange,
  onSelectItem,
  onCreateNew,
  showPostTo = false,
  onPostToChannel,
}) => {
  const [sort, setSort] = useState<LibrarySort>('uploaded');
  const [postingId, setPostingId] = useState<number | null>(null);
  const [layout, setLayout] = useLayoutMode();
  const [page, setPage] = useState(1);
  const listKey = `${filters.status}|${filters.channel}|${sort}`;
  const [pageKey, setPageKey] = useState(listKey);
  if (pageKey !== listKey) {
    setPageKey(listKey);
    setPage(1);
  }
  const cards = libraryCards(items, allItems, !showPostTo);
  const openOrder = new Map(sortContentItems(cards.map((card) => cardSortStandIn(card)), sort).map((item, index) => [item.id, index]));
  const sortedCards = [...cards].sort((a, b) => (openOrder.get(a.open.id) ?? 0) - (openOrder.get(b.open.id) ?? 0));
  const pageCount = Math.max(1, Math.ceil(sortedCards.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = sortedCards.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section aria-label="Content library" className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {heading ? <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">{heading}</h1> : <span className="max-md:hidden" />}
        <div className="flex items-center gap-2 md:shrink-0">
          <FormSelect
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            aria-label="Sort posts"
            className="h-10 w-full pr-9 text-[13px] font-semibold md:w-auto"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </FormSelect>
          <LayoutToggle mode={layout} onChange={setLayout} />
          <button type="button" onClick={onCreateNew} className={cx(buttonStyles.primary, 'h-11 shrink-0 px-4 max-md:!hidden md:inline-flex')}>
            New post
          </button>
        </div>
      </div>

      {totalItemsCount === 0 ? (
        <div data-testid="library-empty-state" className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-bold tracking-tight">Your library is empty</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Your posts will appear here once you add them.</p>
        </div>
      ) : (
      <>
      <div role="tablist" aria-label="Filter by stage" className="flex flex-wrap items-center gap-2">
        {([{ key: 'all' as const, label: 'All' }, ...STATUS_OPTIONS] as const).map((s) => {
          const active = filters.status === s.key;
          // allItems is already this channel's posts. The channel filter holds an id, which
          // filterContentItems would compare to a name and count as nothing.
          const matched = filterContentItems(allItems, { ...filters, channel: 'all', status: s.key });
          const n = libraryCards(matched, allItems, !showPostTo).length;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFiltersChange({ ...filters, status: s.key })}
              className={cx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', chipClass(active))}
            >
              {s.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="text-base font-semibold">Nothing in this view</p>
          <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Posts in another stage, or on another channel, are still in the library.
          </p>
        </div>
      ) : (
        <div
          data-testid={layout === 'list' ? 'library-list' : 'library-grid'}
          className={layout === 'list' ? 'overflow-hidden rounded-2xl border border-border bg-surface' : 'grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3'}
        >
          {pageItems.map((card) => {
            const item = card.open;
            const places = card.members;
            const ref = referencePreview(item.attachedReferences);
            const otherChannels = channels.filter((channel) => !postInChannel(item, channel, channels));
            const postTo = showPostTo && channels.length > 1 ? (
              <PostToChannelMenu
                channels={otherChannels}
                posts={catalog}
                allChannels={channels}
                busy={postingId === item.id}
                onPick={async (channel) => {
                  if (postingId !== null) return;
                  setPostingId(item.id);
                  try {
                    await onPostToChannel(item, channel);
                  } finally {
                    setPostingId((current) => (current === item.id ? null : current));
                  }
                }}
              />
            ) : null;
            const thumbUrl = item.coverAsset?.url || item.slides[0]?.url || ref.screenshotUrl || null;
            const previewLink = firstPreviewLink(item.liveLink, ref.link);
            const slideCount = item.slides.length;
            const date = places.map((member) => member.postDate).filter(Boolean).sort().at(-1) || item.targetDate;

            if (layout === 'list') {
              return (
                <article
                  key={item.id}
                  className="group relative border-t border-border transition-colors first:border-t-0 hover:bg-surface-2"
                >
                  <div className="flex items-center gap-3 px-3 py-3 sm:px-4 md:py-2.5">
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 text-[15px] font-semibold tracking-tight md:line-clamp-1">
                        <button
                          type="button"
                          onClick={() => onSelectItem(item)}
                          className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-electric-500"
                        >
                          {item.title}
                        </button>
                      </h3>
                      {item.caption || item.channelName ? (
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
                          {item.channelName ? <span className="hidden shrink-0 font-medium lg:inline">{item.channelName}</span> : null}
                          {item.channelName && item.caption ? <span className="hidden lg:inline" aria-hidden="true">·</span> : null}
                          {item.caption ? <span className="truncate">{item.caption}</span> : null}
                        </p>
                      ) : null}
                      <div className="mt-1.5 md:hidden">
                        <Places places={places} date={date} iconSize={14} />
                      </div>
                    </div>
                    {postTo}
                    <div className="hidden shrink-0 md:block">
                      <Places places={places} date={date} iconSize={16} />
                    </div>
                  </div>
                </article>
              );
            }

            const hasPicture = Boolean(thumbUrl || previewLink);
            const thumb = !hasPicture ? null : thumbUrl || !previewLink ? (
              <FramedImage
                src={thumbUrl}
                alt=""
                fallbackLabel={item.title}
                isVideo={!!item.videoAsset}
                preferFull={item.platform === 'instagram_reel' || item.platform === 'instagram_carousel'}
              />
            ) : (
              <LinkThumbnail
                link={previewLink}
                authToken={authToken}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                fallback={<MediaImage src={null} alt="" fallbackLabel={item.title} isVideo={!!item.videoAsset} />}
              />
            );

            return (
              <article
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 hover:border-border-strong"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
                  {hasPicture ? thumb : (
                    <div className="flex h-full items-center justify-center text-zinc-300 dark:text-zinc-600">
                      <PlatformIcon platform={item.platform} size={40} />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-end p-2.5">
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
                  <Places places={places} iconSize={16} />

                  <h3 className="mt-1.5 line-clamp-2 text-[16.5px] font-bold leading-snug tracking-tight">
                    {/* Stretched link: the whole card opens the post. */}
                    <button
                      type="button"
                      onClick={() => onSelectItem(item)}
                      className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-electric-500"
                    >
                      {item.title}
                    </button>
                  </h3>

                  {item.caption ? (
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {item.caption}
                    </p>
                  ) : null}

                  <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                    <div className="flex flex-col items-start gap-1.5 text-xs text-muted">
                      {date ? (
                        <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
                          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {date}
                        </span>
                      ) : null}
                      <span className="font-medium">Click to edit</span>
                    </div>
                    {postTo}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Pager page={currentPage} pageCount={pageCount} onPage={setPage} label="Library pages" />
      </>
      )}
    </section>
  );
};

/** The card keeps the place of the first copy that was added, and the soonest date on it. */
function cardSortStandIn(card: { open: ContentItem; members: ContentItem[] }): ContentItem {
  const firstAdded = [...card.members].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
  )[0];
  const soonest = [...card.members]
    .filter((member) => member.targetDate || member.postDate)
    .sort((a, b) => (a.targetDate || a.postDate).localeCompare(b.targetDate || b.postDate) || a.id - b.id)[0];
  return {
    ...card.open,
    createdAt: firstAdded?.createdAt ?? card.open.createdAt,
    targetDate: soonest?.targetDate || '',
    postDate: soonest?.postDate || '',
  };
}

function Places({ places, date, iconSize }: { places: ContentItem[]; date?: string; iconSize: number }) {
  const names = [...new Set(places.map((place) => place.channelName.trim()).filter(Boolean))];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      {places.map((place, index) => (
        <span key={place.id} className="inline-flex min-w-0 items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <PlatformIcon platform={place.platform} size={iconSize} />
          <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">{getPlatformShortLabel(place.platform)}</span>
          <StagePill status={place.status} className="shrink-0" />
        </span>
      ))}
      {names.length === 1 ? (
        <span className="inline-flex max-w-full items-center gap-1.5">
          <span aria-hidden="true">·</span>
          <span className="truncate">{names[0]}</span>
        </span>
      ) : null}
      {date ? <span className="shrink-0 tabular-nums">{date}</span> : null}
    </div>
  );
}
