'use client';

import React, { useState } from 'react';
import { ArrowRight, ExternalLink, ImagePlus, Link2, Trash2 } from 'lucide-react';
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
import { FormSelect } from './CustomSelect';
import { MediaImage } from './MediaImage';

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
  }) => Promise<void>;
  onMakePost: (idea: IdeaItem) => Promise<void>;
  onDeleteIdea: (ideaId: number) => Promise<void>;
}

export const IdeasView: React.FC<IdeasViewProps> = ({
  ideas,
  channels,
  authToken,
  initialSharedDraft,
  onCaptureIdea,
  onMakePost,
  onDeleteIdea,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const preview = extractDomainAndTitle(linkUrl);

  const handleScreenshotPick = async (file: File | undefined) => {
    if (!file) return;
    setUploadingShot(true);
    try {
      const asset = await uploadAssetResumable({ file, authToken });
      setScreenshotUrl(asset.url);
    } catch {
      setError('Could not attach screenshot.');
    } finally {
      setUploadingShot(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !linkUrl.trim() && !notes.trim() && !screenshotUrl) {
      setError('Paste a link, drop a screenshot, or type a note to capture an idea.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      await onCaptureIdea({
        title: title.trim() || preview.suggestedTitle || 'Captured Reference',
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

      setTitle('');
      setLinkUrl('');
      setNotes('');
      setTagsRaw('');
      setTargetDate('');
      setScreenshotUrl('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Ideas and References" className="space-y-8">
      {/* Capture Idea Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              Capture an Idea or Reference
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Paste a YouTube or Instagram link, drop a screenshot, or jot a quick note.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="idea-link"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Reference Link
            </label>
            <div className="relative mt-1">
              <Link2
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                id="idea-link"
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=... or instagram.com/reel/..."
                className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="idea-title"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Idea Title
            </label>
            <input
              id="idea-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={preview.suggestedTitle || 'e.g. Fast Hook Pacing Breakdown'}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
        </div>

        {preview.domain ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950">
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
              Link preview: {preview.domain} · {preview.suggestedTitle}
            </span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="idea-notes"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Notes
            </label>
            <textarea
              id="idea-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What caught your eye? Camera angle, hook line, pacing..."
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <div className="flex flex-col justify-between gap-3">
            <div>
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Reference Screenshot
              </span>
              <label className="mt-1 flex h-[84px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 text-xs font-medium text-zinc-600 hover:border-blue-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                <ImagePlus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span>
                  {uploadingShot
                    ? 'Attaching screenshot...'
                    : screenshotUrl
                    ? 'Screenshot attached — click to replace'
                    : 'Drop or pick a screenshot'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleScreenshotPick(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="idea-platform"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Platform
            </label>
            <FormSelect
              id="idea-platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as PlatformKey)}
              className="mt-1 h-10 dark:bg-zinc-950"
            >
              {PLATFORM_OPTIONS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </FormSelect>
          </div>

          <div>
            <label
              htmlFor="idea-channel"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Channel
            </label>
            <FormSelect
              id="idea-channel"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              className="mt-1 h-10 dark:bg-zinc-950"
            >
              <option value="">No channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
          </div>

          <div>
            <label
              htmlFor="idea-tags"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Tags
            </label>
            <input
              id="idea-tags"
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="#hook #lighting"
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <div>
            <label
              htmlFor="idea-target-date"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Target Date (optional)
            </label>
            <input
              id="idea-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving Idea...' : 'Save to Ideas'}
          </button>
        </div>
      </form>

      {/* Captured Ideas List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Saved References ({ideas.length})
          </h3>
        </div>

        {ideas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              No saved ideas or references yet
            </p>
            <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Use this inbox for future post ideas. Paste a link, attach a screenshot, or jot a quick note above — then tap <strong>Make it a post</strong> whenever you are ready to move it into your Library.
            </p>
          </div>
        ) : (
          <div
            data-testid="ideas-grid"
            className="grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {ideas.map((idea) => (
              <article
                key={idea.id}
                className="flex flex-col justify-between overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex flex-col sm:flex-row">
                  {idea.screenshotUrl ? (
                    <div className="h-44 w-full shrink-0 bg-zinc-100 sm:h-auto sm:w-40 dark:bg-zinc-950">
                      <MediaImage
                        src={idea.screenshotUrl}
                        alt={`${idea.title} reference screenshot`}
                        fallbackLabel={idea.title}
                      />
                    </div>
                  ) : null}

                  <div className="flex-1 p-4">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium text-blue-600 dark:text-blue-400">
                        {getPlatformLabel(idea.platform)}
                      </span>
                      {idea.channelName ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{idea.channelName}</span>
                        </>
                      ) : null}
                      {idea.targetDate ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">Target {idea.targetDate}</span>
                        </>
                      ) : null}
                    </div>

                    <h4 className="mt-1.5 text-base font-semibold text-zinc-950 dark:text-zinc-50">
                      {idea.title}
                    </h4>

                    {idea.linkUrl ? (
                      <a
                        href={idea.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                      >
                        <span>{idea.linkDomain || idea.linkUrl}</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : null}

                    {idea.notes ? (
                      <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {idea.notes}
                      </p>
                    ) : null}

                    {idea.tags.length > 0 ? (
                      <p className="mt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {formatTagsForCopy(idea.tags)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => onDeleteIdea(idea.id)}
                    aria-label={`Delete idea ${idea.title}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </button>

                  {idea.convertedItemId ? (
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      Converted to post
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onMakePost(idea)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
                    >
                      <span>Make it a post</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
