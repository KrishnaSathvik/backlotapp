'use client';

import React, { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { getPlatformShortLabel, SORT_OPTIONS, sortIdeas, type ChannelItem, type IdeaItem, type LibrarySort, type PlatformKey } from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { IdeaCaptureSheet, type IdeaCapturePayload } from './IdeaCaptureSheet';
import { IdeaDetailSheet, type IdeaFieldsPatch } from './IdeaDetailSheet';
import { PlatformIcon } from './PlatformIcon';
import { buttonStyles, cx, IDEAS_PAGE_SIZE, Pager } from './ui';

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
  const [sort, setSort] = useState<LibrarySort>('uploaded');
  const [page, setPage] = useState(1);
  const [busyIdeaId, setBusyIdeaId] = useState<number | null>(null);

  const listKey = sort;
  const [pageKey, setPageKey] = useState(listKey);
  if (pageKey !== listKey) {
    setPageKey(listKey);
    setPage(1);
  }
  const pageCount = Math.max(1, Math.ceil(ideas.length / IDEAS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * IDEAS_PAGE_SIZE;
  const pageItems = sortIdeas(ideas, sort).slice(pageStart, pageStart + IDEAS_PAGE_SIZE);
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
            <div data-testid="ideas-list" className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-3">
              {pageItems.map((idea) => {
                const busy = busyIdeaId === idea.id;
                const named = idea.platform !== 'other';
                return (
                  <article
                    key={idea.id}
                    className={cx(
                      'group relative rounded-2xl border border-border bg-surface transition-colors hover:bg-surface-2',
                      busy && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-semibold tracking-tight">
                          <button
                            type="button"
                            onClick={() => setOpenIdeaId(idea.id)}
                            className="block w-full truncate text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-electric-500"
                          >
                            {idea.title}
                          </button>
                        </h3>
                        {idea.channelName ? <p className="mt-0.5 truncate text-[13px] text-zinc-500 dark:text-zinc-400">{idea.channelName}</p> : null}
                      </div>
                      {named ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                          <PlatformIcon platform={idea.platform} size={16} />
                          <span className="max-w-24 truncate sm:max-w-none">{getPlatformShortLabel(idea.platform)}</span>
                        </span>
                      ) : null}
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
          onMakePost={async (idea, platform) => {
            setOpenIdeaId(null);
            await makePost(idea, platform);
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
