'use client';

import React, { useState } from 'react';
import { Calendar, Film, Layers, Sparkles } from 'lucide-react';
import {
  filterContentItems,
  getPlatformShortLabel,
  SORT_OPTIONS,
  sortContentItems,
  STATUS_OPTIONS,
  type ContentItem,
  type LibraryFilters,
  type LibrarySort,
  referencePreview,
} from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { LinkThumbnail } from './LinkThumbnail';
import { MediaImage } from './MediaImage';
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
  onFiltersChange: (next: LibraryFilters) => void;
  onSelectItem: (item: ContentItem) => void;
  onCreateNew: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  items,
  totalItemsCount,
  allItems,
  authToken = null,
  filters,
  heading = 'Library',
  onFiltersChange,
  onSelectItem,
  onCreateNew,
}) => {
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [page, setPage] = useState(1);
  const listKey = `${filters.status}|${filters.channel}|${sort}`;
  const [pageKey, setPageKey] = useState(listKey);
  if (pageKey !== listKey) {
    setPageKey(listKey);
    setPage(1);
  }
  const sortedItems = sortContentItems(items, sort);
  const pageCount = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = sortedItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
          const n = s.key === 'all'
            ? filterContentItems(allItems, { ...filters, status: 'all' }).length
            : filterContentItems(allItems, { ...filters, status: s.key }).length;
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
          data-testid="library-grid"
          className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3"
        >
          {pageItems.map((item) => {
            const ref = referencePreview(item.attachedReferences);
            const thumbUrl = item.coverAsset?.url || item.slides[0]?.url || ref.screenshotUrl || null;
            const slideCount = item.slides.length;
            const date = item.postDate || item.targetDate;

            return (
              <article
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 hover:border-border-strong"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
                  {thumbUrl || !ref.link ? (
                    <MediaImage
                      src={thumbUrl}
                      alt=""
                      fallbackLabel={item.title}
                      isVideo={!!item.videoAsset}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <LinkThumbnail
                      link={ref.link}
                      authToken={authToken}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      fallback={<MediaImage src={null} alt="" fallbackLabel={item.title} isVideo={!!item.videoAsset} />}
                    />
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
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <PlatformIcon platform={item.platform} size={16} />
                    <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">
                      {getPlatformShortLabel(item.platform)}
                    </span>
                    <StagePill status={item.status} />
                    {item.channelName ? (
                      <span className="inline-flex max-w-full items-center gap-1.5">
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{item.channelName}</span>
                      </span>
                    ) : null}
                  </div>

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

                  <div className="mt-auto flex flex-col items-start gap-1.5 pt-4 text-xs text-muted">
                    {date ? (
                      <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
                        <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {date}
                      </span>
                    ) : null}
                    <span className="font-medium">Click to edit</span>
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
