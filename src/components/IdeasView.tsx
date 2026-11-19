'use client';

import React, { useEffect, useState } from 'react';
import { ArrowRight, Calendar, CheckCircle2, Lightbulb, Link2, MessageSquare, Plus, Search, X } from 'lucide-react';
import { formatTagsForCopy, getPlatformShortLabel, type ChannelItem, type IdeaItem } from '@/src/lib/content-logic';
import { IdeaCaptureSheet, type IdeaCapturePayload } from './IdeaCaptureSheet';
import { IdeaDetailSheet, type IdeaFieldsPatch } from './IdeaDetailSheet';
import { MediaImage } from './MediaImage';
import { PlatformIcon } from './PlatformIcon';
import { buttonStyles, cx, inputStyles, sizes } from './ui';

interface IdeasViewProps {
  ideas: IdeaItem[];
  channels: ChannelItem[];
  authToken: string | null;
  /** Arrived through the share sheet: open the capture panel prefilled. */
  initialSharedDraft?: { title: string; text: string; url: string } | null;
  onCaptureIdea: (payload: IdeaCapturePayload) => Promise<boolean>;
  onUpdateIdea: (ideaId: number, patch: IdeaFieldsPatch) => Promise<boolean>;
  onMakePost: (idea: IdeaItem) => Promise<void>;
  onDeleteIdea: (idea: IdeaItem) => Promise<boolean>;
  onAskSlate: (idea: IdeaItem) => void;
  /** Opens this idea's detail sheet on mount (e.g. from a Slate reference). */
  initialOpenIdeaId?: number | null;
  onInitialIdeaOpened?: () => void;
}

function matches(idea: IdeaItem, query: string) {
  if (!query) return true;
  return [idea.title, idea.notes, idea.linkDomain, idea.linkTitle, idea.channelName, ...idea.tags]
    .join(' ')
    .toLowerCase()
    .includes(query);
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
}) => {
  const [captureOpen, setCaptureOpen] = useState(!!initialSharedDraft);
  const [openIdeaId, setOpenIdeaId] = useState<number | null>(initialOpenIdeaId);
  useEffect(() => {
    if (initialOpenIdeaId !== null) onInitialIdeaOpened?.();
    // Only on mount: the request is consumed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [query, setQuery] = useState('');
  const [busyIdeaId, setBusyIdeaId] = useState<number | null>(null);

  const q = query.trim().toLowerCase();
  const visible = ideas.filter((i) => matches(i, q));
  const openIdea = ideas.find((i) => i.id === openIdeaId) ?? null;

  const makePost = async (idea: IdeaItem) => {
    setBusyIdeaId(idea.id);
    try {
      await onMakePost(idea);
    } finally {
      setBusyIdeaId(null);
    }
  };

  const remove = async (idea: IdeaItem) => {
    if (await onDeleteIdea(idea)) setOpenIdeaId((id) => (id === idea.id ? null : id));
  };

  const captureButton = (
    <button type="button" onClick={() => setCaptureOpen(true)} className={cx(buttonStyles.primary, sizes.md, 'h-11 shrink-0 px-4')}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      <span className="hidden min-[420px]:inline">Capture idea</span>
      <span className="min-[420px]:hidden">Capture</span>
    </button>
  );

  return (
    <section aria-label="Ideas" className="space-y-4">
      {ideas.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-800">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cantaloupe-400 to-cantaloupe-600 text-white shadow-lg shadow-cantaloupe-500/30">
            <Lightbulb className="h-6 w-6" aria-hidden="true" />
          </div>
          <h2 className="mt-5 text-xl font-bold tracking-tight">Start your creative inbox</h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            Save a link, a screenshot or a quick note whenever something inspires you. Turn it into a post when you’re ready.
          </p>
          <div className="mt-6">{captureButton}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <div className="relative min-w-0 flex-1 lg:max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ideas…"
                aria-label="Search ideas"
                className={cx(inputStyles, 'h-11 pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden')}
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="ml-auto">{captureButton}</div>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-800">
              <Search className="h-6 w-6 text-zinc-400" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold">No ideas match “{query.trim()}”</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className={cx(buttonStyles.secondary, sizes.md, 'mt-4')}
              >
                Clear search
              </button>
            </div>
          ) : (
            <div data-testid="ideas-grid" className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((idea) => {
                const busy = busyIdeaId === idea.id;
                const converted = !!idea.convertedItemId;
                return (
                  <article
                    key={idea.id}
                    className={cx(
                      'group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-zinc-950/5 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700',
                      busy && 'opacity-60'
                    )}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-zinc-100 dark:bg-zinc-800/50">
                      {idea.screenshotUrl ? (
                        <MediaImage
                          src={idea.screenshotUrl}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-electric-500/10 via-transparent to-cantaloupe-400/15 px-4 text-center">
                          {idea.linkDomain ? (
                            <Link2 className="h-6 w-6 text-electric-500" aria-hidden="true" />
                          ) : (
                            <Lightbulb className="h-6 w-6 text-cantaloupe-500" aria-hidden="true" />
                          )}
                          <span className="line-clamp-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                            {idea.linkDomain || 'Note'}
                          </span>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2.5">
                        {converted ? (
                          <span className="flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur dark:bg-zinc-900/85 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Linked post
                          </span>
                        ) : (
                          <span />
                        )}
                        {idea.targetDate ? (
                          <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur tabular-nums">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            {idea.targetDate}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <PlatformIcon platform={idea.platform} size={16} />
                        <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">{getPlatformShortLabel(idea.platform)}</span>
                        {idea.channelName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="min-w-0 truncate">{idea.channelName}</span>
                          </>
                        ) : null}
                      </div>

                      <h3 className="mt-1.5 line-clamp-2 font-display text-[16.5px] font-bold leading-snug tracking-tight">
                        {/* Stretched button: the whole card opens the idea. */}
                        <button
                          type="button"
                          onClick={() => setOpenIdeaId(idea.id)}
                          className="text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                        >
                          {idea.title}
                        </button>
                      </h3>
                      {idea.notes ? (
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">{idea.notes}</p>
                      ) : idea.tags.length ? (
                        <p className="mt-1.5 truncate font-mono text-[11px] text-zinc-500">{formatTagsForCopy(idea.tags)}</p>
                      ) : null}

                      <div className="relative z-10 mt-auto flex items-center gap-1.5 pt-4">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => makePost(idea)}
                          className={cx(converted ? buttonStyles.secondary : buttonStyles.primary, 'h-8 rounded-full px-3 text-xs')}
                        >
                          {converted ? 'Open post' : 'Make it a post'}
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onAskSlate(idea)}
                          aria-label={`Ask Slate about ${idea.title}`}
                          title="Ask Slate"
                          className={cx(buttonStyles.ghost, 'h-8 w-8 rounded-full p-0')}
                        >
                          <MessageSquare className="h-4 w-4 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {captureOpen ? (
        <IdeaCaptureSheet
          channels={channels}
          authToken={authToken}
          initialDraft={initialSharedDraft}
          onCapture={onCaptureIdea}
          onClose={() => setCaptureOpen(false)}
        />
      ) : null}

      {openIdea ? (
        <IdeaDetailSheet
          key={`idea-${openIdea.id}`}
          idea={openIdea}
          channels={channels}
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
