'use client';

import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, ImageIcon, Lightbulb, Link2 } from 'lucide-react';
import { formatTagsForCopy, getPlatformShortLabel, ideaImages, SORT_OPTIONS, sortIdeas, type ChannelItem, type IdeaItem, type LibrarySort, type PlatformKey } from '@/src/lib/content-logic';
import { hasLinkPreview } from '@/src/lib/link-preview';
import { FormSelect } from './CustomSelect';
import { IdeaCaptureSheet, type IdeaCapturePayload } from './IdeaCaptureSheet';
import { IdeaDetailSheet, type IdeaFieldsPatch } from './IdeaDetailSheet';
import { LinkThumbnail } from './LinkThumbnail';
import { MediaImage } from './MediaImage';
import { PlatformIcon } from './PlatformIcon';
import { buttonStyles, cx, PAGE_SIZE, Pager } from './ui';

interface IdeasViewProps {
  ideas: IdeaItem[];
  channels: ChannelItem[];
  authToken: string | null;
  /** Arrived through the share sheet: open the capture panel prefilled. */
  initialSharedDraft?: { title: string; text: string; url: string } | null;
  onCaptureIdea: (payload: IdeaCapturePayload) => Promise<boolean>;
  onUpdateIdea: (ideaId: number, patch: IdeaFieldsPatch) => Promise<boolean>;
  onMakePost: (idea: IdeaItem, platform?: PlatformKey) => Promise<void>;
  onDeleteIdea: (idea: IdeaItem) => Promise<boolean>;
  onAskSlate: (idea: IdeaItem) => void;
  /** Opens this idea's detail sheet on mount (e.g. from a Slate reference). */
  initialOpenIdeaId?: number | null;
  onInitialIdeaOpened?: () => void;
  /** Phone create button asks the dialog to open. */
  createOpen?: boolean;
  onCreateClose?: () => void;
  /** Null when a channel header already shows the page name. */
  heading?: string | null;
}

export const IdeasView: React.FC<IdeasViewProps> = ({
  ideas,
  channels,
  authToken,
  initialSharedDraft,
  onCaptureIdea,
  onUpdateIdea,
  onMakePost,
  onDeleteIdea,
  onAskSlate,
  initialOpenIdeaId = null,
  onInitialIdeaOpened,
  createOpen = false,
  onCreateClose,
  heading = 'Ideas',
}) => {
  const [captureOpen, setCaptureOpen] = useState(!!initialSharedDraft);
  const dialogOpen = captureOpen || createOpen;
  const [openIdeaId, setOpenIdeaId] = useState<number | null>(initialOpenIdeaId);
  useEffect(() => {
    if (initialOpenIdeaId !== null) onInitialIdeaOpened?.();
    // Only on mount: the request is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [sort, setSort] = useState<LibrarySort>('updated');
  const [page, setPage] = useState(1);
  const [busyIdeaId, setBusyIdeaId] = useState<number | null>(null);

  const listKey = sort;
  const [pageKey, setPageKey] = useState(listKey);
  if (pageKey !== listKey) {
    setPageKey(listKey);
    setPage(1);
  }
  const pageCount = Math.max(1, Math.ceil(ideas.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = sortIdeas(ideas, sort).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const openIdea = ideas.find((i) => i.id === openIdeaId) ?? null;

  const makePost = async (idea: IdeaItem, platform?: PlatformKey) => {
    setBusyIdeaId(idea.id);
    try {
      await onMakePost(idea, platform);
    } finally {
      setBusyIdeaId(null);
    }
  };

  const remove = async (idea: IdeaItem) => {
    if (await onDeleteIdea(idea)) setOpenIdeaId((id) => (id === idea.id ? null : id));
  };

  return (
    <section aria-label="Ideas" className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {heading ? <h1 className="min-w-0 truncate text-2xl font-extrabold tracking-tight">{heading}</h1> : <span className="max-md:hidden" />}
        <div className="flex items-center gap-2 md:shrink-0">
          <FormSelect
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            aria-label="Sort ideas"
            className="h-10 w-full pr-9 text-[13px] font-semibold md:w-auto"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </FormSelect>
          <button
            type="button"
            onClick={() => setCaptureOpen(true)}
            className={cx(buttonStyles.primary, 'h-11 shrink-0 px-4 max-md:!hidden md:inline-flex')}
          >
            New idea
          </button>
        </div>
      </div>
      {ideas.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong px-6 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-muted">
            <Lightbulb className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-bold tracking-tight">No ideas saved yet</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">Your saved thoughts, links and inspiration will appear here.</p>
        </div>
      ) : (
        <>
            <div data-testid="ideas-grid" className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
              {pageItems.map((idea) => {
                const busy = busyIdeaId === idea.id;
                const converted = !!idea.convertedItemId;
                const images = ideaImages(idea);
                // A picture only when there is one. A note, or a link with no thumbnail, is a text card.
                const picture = images.length > 0 || hasLinkPreview(idea.linkUrl);
                return (
                  <article
                    key={idea.id}
                    className={cx(
                      'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 hover:border-border-strong',
                      busy && 'opacity-60'
                    )}
                  >
                    {picture ? (
                    <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
                      {images.length ? (
                        <MediaImage
                          src={images[0]}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <LinkThumbnail
                          link={idea.linkUrl}
                          authToken={authToken}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                          fallback={null}
                        />
                      )}
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
                        {converted ? (
                          <span className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-text shadow-sm">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Linked post
                          </span>
                        ) : (
                          <span />
                        )}
                        {images.length > 1 ? (
                          <span className="ml-auto mr-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur tabular-nums">
                            <ImageIcon className="h-3 w-3" aria-hidden="true" />
                            {images.length}
                          </span>
                        ) : null}
                        {idea.targetDate ? (
                          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur tabular-nums">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            {idea.targetDate}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    ) : null}

                    <div className={cx('flex flex-1 flex-col p-4', !picture && 'min-h-52 p-5')}>
                      <div className={cx(!picture && 'flex flex-1 flex-col justify-center')}>
                      {idea.platform !== 'other' || idea.channelName || (!picture && (converted || idea.targetDate)) ? (
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {idea.platform !== 'other' ? (
                            <>
                              <PlatformIcon platform={idea.platform} size={16} />
                              <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">{getPlatformShortLabel(idea.platform)}</span>
                            </>
                          ) : null}
                          {idea.channelName ? (
                            <span className="inline-flex max-w-full items-center gap-1.5">
                              {idea.platform !== 'other' ? <span aria-hidden="true">·</span> : null}
                              <span className="truncate">{idea.channelName}</span>
                            </span>
                          ) : null}
                          {!picture && converted ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-text">
                              {(idea.platform !== 'other' || idea.channelName) ? <span aria-hidden="true">·</span> : null}
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Linked post
                            </span>
                          ) : null}
                          {!picture && idea.targetDate ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              {(idea.platform !== 'other' || idea.channelName || converted) ? <span aria-hidden="true">·</span> : null}
                              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                              {idea.targetDate}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <h3 className={cx(picture ? 'line-clamp-2 text-[16.5px]' : 'line-clamp-6 text-[22px] leading-snug', 'font-bold tracking-tight', (idea.platform !== 'other' || idea.channelName || (!picture && (converted || idea.targetDate))) && 'mt-1.5')}>
                        {/* Stretched button: the whole card opens the idea. */}
                        <button
                          type="button"
                          onClick={() => setOpenIdeaId(idea.id)}
                          className="text-left after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-electric-500"
                        >
                          {idea.title}
                        </button>
                      </h3>
                      {!picture && idea.linkDomain ? (
                        <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                          <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{idea.linkDomain}</span>
                        </p>
                      ) : null}
                      {idea.notes ? (
                        <p className={cx('mt-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400', picture ? 'line-clamp-2' : 'line-clamp-4')}>{idea.notes}</p>
                      ) : idea.tags.length ? (
                        <p className="mt-2 truncate font-mono text-[11px] text-zinc-500">{formatTagsForCopy(idea.tags)}</p>
                      ) : null}
                      </div>

                      <p className="mt-auto pt-4 text-xs font-medium text-muted">Click to edit</p>
                    </div>
                  </article>
                );
              })}
            </div>
          <Pager page={currentPage} pageCount={pageCount} onPage={setPage} label="Idea pages" />
        </>
      )}

      {dialogOpen ? (
        <IdeaCaptureSheet
          authToken={authToken}
          initialDraft={initialSharedDraft}
          onCapture={onCaptureIdea}
          onClose={() => {
            setCaptureOpen(false);
            onCreateClose?.();
          }}
        />
      ) : null}

      {openIdea ? (
        <IdeaDetailSheet
          key={`idea-${openIdea.id}`}
          idea={openIdea}
          channels={channels}
          authToken={authToken}
          onClose={() => setOpenIdeaId(null)}
          onSave={onUpdateIdea}
          onMakePost={async (idea) => {
            setOpenIdeaId(null);
            await makePost(idea);
          }}
          onAskSlate={(idea) => {
            setOpenIdeaId(null);
            onAskSlate(idea);
          }}
          onDelete={remove}
        />
      ) : null}
    </section>
  );
};
