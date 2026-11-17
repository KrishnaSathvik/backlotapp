'use client';

import React, { useState } from 'react';
import { ArrowRight, ChevronDown, ExternalLink, ImagePlus, Lightbulb, Link2, Trash2, X } from 'lucide-react';
import {
  extractDomainAndTitle,
  formatTagsForCopy,
  getPlatformLabel,
  parseTagsInput,
  PLATFORM_OPTIONS,
  type ChannelItem,
  type IdeaItem,
  type PlatformKey,
} from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { IMAGE_TYPES } from '@/src/lib/upload-limits';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { MediaImage } from './MediaImage';
import { buttonStyles, cardStyles, cx, inputStyles, labelStyles, sizes } from './ui';

interface IdeasViewProps {
  ideas: IdeaItem[];
  channels: ChannelItem[];
  authToken: string | null;
  initialSharedDraft?: { title: string; text: string; url: string } | null;
  onCaptureIdea: (payload: {
    title: string;
    linkUrl: string;
    linkTitle: string;
    linkDomain: string;
    screenshotUrl: string;
    notes: string;
    platform: PlatformKey;
    channelName: string;
    tags: string[];
    targetDate: string;
  }) => Promise<boolean>;
  onMakePost: (idea: IdeaItem) => Promise<void>;
  onDeleteIdea: (idea: IdeaItem) => Promise<void>;
  /** Demo mode: browse only, no capture/convert/delete. */
  readOnly?: boolean;
}

const isWebLink = (url: string) => /^https?:\/\//i.test(url.trim());

export const IdeasView: React.FC<IdeasViewProps> = ({
  ideas,
  channels,
  authToken,
  initialSharedDraft,
  onCaptureIdea,
  onMakePost,
  onDeleteIdea,
  readOnly = false,
}) => {
  const [title, setTitle] = useState(initialSharedDraft?.title ?? '');
  const [linkUrl, setLinkUrl] = useState(initialSharedDraft?.url ?? '');
  const [notes, setNotes] = useState(initialSharedDraft?.text ?? '');
  const [platform, setPlatform] = useState<PlatformKey>('youtube_long');
  const [channelName, setChannelName] = useState(channels[0]?.name ?? '');
  const [tagsRaw, setTagsRaw] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploadingShot, setUploadingShot] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyIdeaId, setBusyIdeaId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const preview = extractDomainAndTitle(linkUrl);

  const handleScreenshotPick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setUploadingShot(true);
    try {
      const asset = await uploadAssetResumable({ file, authToken });
      setScreenshotUrl(asset.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach screenshot.');
    } finally {
      setUploadingShot(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !linkUrl.trim() && !notes.trim() && !screenshotUrl) {
      setError('Paste a link, add a screenshot, or type a note.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await onCaptureIdea({
      title: title.trim() || preview.suggestedTitle || 'Captured idea',
      linkUrl: preview.validUrl,
      linkTitle: preview.suggestedTitle,
      linkDomain: preview.domain,
      screenshotUrl,
      notes: notes.trim(),
      platform,
      channelName,
      tags: parseTagsInput(tagsRaw),
      targetDate,
    });
    setSaving(false);
    if (ok) {
      setTitle('');
      setLinkUrl('');
      setNotes('');
      setTagsRaw('');
      setTargetDate('');
      setScreenshotUrl('');
    }
  };

  const withBusy = async (idea: IdeaItem, fn: (idea: IdeaItem) => Promise<void>) => {
    setBusyIdeaId(idea.id);
    try {
      await fn(idea);
    } finally {
      setBusyIdeaId(null);
    }
  };

  return (
    <section aria-label="Ideas" className={cx('grid gap-6', !readOnly && 'lg:grid-cols-[minmax(0,400px)_1fr] lg:items-start')}>
      {/* Capture */}
      {readOnly ? null : (
      <form onSubmit={handleSubmit} className={cx(cardStyles, 'p-4 sm:p-5 lg:sticky lg:top-20')}>
        <h2 className="text-base font-semibold">Capture an idea</h2>
        <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">Paste a link, add a screenshot, or jot a note.</p>

        <div className="mt-4 space-y-3">
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              id="idea-link"
              type="url"
              inputMode="url"
              aria-label="Reference link"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Paste a YouTube or Instagram link"
              className={cx(inputStyles, 'h-11 pl-10')}
            />
          </div>
          {preview.domain ? (
            <p className="flex items-center gap-1.5 truncate px-1 text-xs text-zinc-500 dark:text-zinc-400">
              <ExternalLink className="h-3 w-3 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" />
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">{preview.domain}</span>
              <span className="truncate">· {preview.suggestedTitle}</span>
            </p>
          ) : null}

          <input
            id="idea-title"
            aria-label="Idea title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={preview.suggestedTitle || 'Title (optional)'}
            maxLength={300}
            className={cx(inputStyles, 'h-11')}
          />

          <div className="flex gap-3">
            <textarea
              id="idea-notes"
              aria-label="Notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What caught your eye? Hook, angle, pacing…"
              className={cx(inputStyles, 'flex-1 py-2.5')}
            />
            {screenshotUrl ? (
              <div className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <MediaImage src={screenshotUrl} alt="Screenshot" />
                <button
                  type="button"
                  onClick={() => setScreenshotUrl('')}
                  aria-label="Remove screenshot"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label
                className={cx(
                  'flex h-[88px] w-[88px] shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 text-center text-[11px] font-semibold text-zinc-500 transition-colors hover:border-electric-400 hover:bg-electric-50/50 hover:text-electric-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-electric-950/30',
                  uploadingShot && 'pointer-events-none animate-pulse'
                )}
              >
                <ImagePlus className="h-5 w-5" aria-hidden="true" />
                {uploadingShot ? 'Adding…' : 'Screenshot'}
                <input
                  type="file"
                  accept={IMAGE_TYPES.join(',')}
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    handleScreenshotPick(f);
                  }}
                />
              </label>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="flex items-center gap-1 text-[13px] font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ChevronDown className={cx('h-4 w-4 transition-transform', showMore && 'rotate-180')} aria-hidden="true" />
            Platform, channel, tags & date
          </button>

          {showMore ? (
            <div className="animate-pop-in grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="idea-platform" className={labelStyles}>
                  Platform
                </label>
                <FormSelect id="idea-platform" value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="idea-channel" className={labelStyles}>
                  Channel
                </label>
                <FormSelect id="idea-channel" value={channelName} onChange={(e) => setChannelName(e.target.value)}>
                  <option value="">None</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="idea-tags" className={labelStyles}>
                  Tags
                </label>
                <input
                  id="idea-tags"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="#hook #lighting"
                  autoCapitalize="none"
                  className={cx(inputStyles, 'h-11')}
                />
              </div>
              <div>
                <label htmlFor="idea-target-date" className={labelStyles}>
                  Target date
                </label>
                <input
                  id="idea-target-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className={cx(inputStyles, 'h-11')}
                />
              </div>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <button type="submit" disabled={saving || uploadingShot} className={cx(buttonStyles.primary, sizes.lg, 'w-full')}>
            {saving ? 'Saving…' : 'Save idea'}
          </button>
        </div>
      </form>
      )}

      {/* Saved ideas */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">
          Saved <span className="tabular-nums">({ideas.length})</span>
        </h2>

        {ideas.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-800">
            <Lightbulb className="h-6 w-6 text-zinc-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold">No ideas yet</p>
            <p className="mt-1 max-w-xs text-[13px] text-zinc-500 dark:text-zinc-400">
              Save anything that inspires you. When you’re ready, turn it into a post with one tap.
            </p>
          </div>
        ) : (
          <div data-testid="ideas-grid" className={cx('grid grid-cols-1 gap-3 xl:grid-cols-2', readOnly && 'md:grid-cols-2')}>
            {ideas.map((idea) => {
              const busy = busyIdeaId === idea.id;
              return (
                <article
                  key={idea.id}
                  className={cx(cardStyles, 'flex overflow-hidden transition-shadow hover:shadow-md', busy && 'opacity-60')}
                >
                  {idea.screenshotUrl ? (
                    <div className="w-24 shrink-0 bg-zinc-100 sm:w-32 dark:bg-zinc-800">
                      <MediaImage src={idea.screenshotUrl} alt="" fallbackLabel="" />
                    </div>
                  ) : null}

                  <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-4">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
                        <PlatformIcon platform={idea.platform} size={16} />
                        {getPlatformLabel(idea.platform)}
                      </span>
                      {idea.channelName ? <span className="whitespace-nowrap">{idea.channelName}</span> : null}
                      {idea.targetDate ? (
                        <span className="whitespace-nowrap rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums dark:bg-zinc-800">
                          {idea.targetDate}
                        </span>
                      ) : null}
                    </p>
                    <h3 className="mt-1 line-clamp-2 font-display text-[16.5px] font-bold leading-snug tracking-tight">{idea.title}</h3>

                    {isWebLink(idea.linkUrl) ? (
                      <a
                        href={idea.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex max-w-full items-center gap-1 self-start text-xs font-medium text-electric-600 hover:underline dark:text-electric-400"
                      >
                        <span className="truncate">{idea.linkDomain || idea.linkUrl}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      </a>
                    ) : null}

                    {idea.notes ? (
                      <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">{idea.notes}</p>
                    ) : null}
                    {idea.tags.length > 0 ? (
                      <p className="mt-1.5 truncate font-mono text-[11px] text-zinc-500">{formatTagsForCopy(idea.tags)}</p>
                    ) : null}

                    {readOnly ? null : (
                    <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => withBusy(idea, onDeleteIdea)}
                        aria-label={`Delete idea ${idea.title}`}
                        className={cx(buttonStyles.ghost, sizes.iconSm, 'rounded-full hover:text-red-600 dark:hover:text-red-400')}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => withBusy(idea, onMakePost)}
                        className={cx(
                          idea.convertedItemId ? buttonStyles.secondary : buttonStyles.primary,
                          'h-9 rounded-full px-3.5 text-xs'
                        )}
                      >
                        {idea.convertedItemId ? 'Open post' : 'Make it a post'}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
