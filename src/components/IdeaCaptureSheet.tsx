'use client';

import React, { useState } from 'react';
import { ExternalLink, ImagePlus, Link2, UploadCloud, X } from 'lucide-react';
import {
  extractDomainAndTitle,
  parseTagsInput,
  PLATFORM_OPTIONS,
  type ChannelItem,
  type PlatformKey,
} from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { IMAGE_TYPES } from '@/src/lib/upload-limits';
import { FormSelect } from './CustomSelect';
import { MediaImage } from './MediaImage';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes, useFeedback } from './ui';

export interface IdeaCapturePayload {
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
}

/** Quick capture: a link, screenshot or note. Everything else is optional and tucked away. */
export function IdeaCaptureSheet({
  channels,
  authToken,
  initialDraft,
  onCapture,
  onClose,
}: {
  channels: ChannelItem[];
  authToken: string | null;
  initialDraft?: { title: string; text: string; url: string } | null;
  onCapture: (payload: IdeaCapturePayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [linkUrl, setLinkUrl] = useState(initialDraft?.url ?? '');
  const [notes, setNotes] = useState(initialDraft?.text ?? '');
  const [platform, setPlatform] = useState<PlatformKey>('youtube_long');
  const [channelName, setChannelName] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [uploadingShot, setUploadingShot] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const { confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
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

  const dirty = !!(title.trim() || linkUrl.trim() || notes.trim() || tagsRaw.trim() || targetDate || screenshotUrl);

  const requestClose = async () => {
    if (dirty && !saving) {
      const ok = await confirm({
        title: 'Discard this idea?',
        body: 'What you’ve added here hasn’t been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !linkUrl.trim() && !notes.trim() && !screenshotUrl) {
      setError('Paste a link, add a screenshot, or type a note.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await onCapture({
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
    if (ok) onClose();
  };

  return (
    <Sheet onClose={requestClose} label="New idea" size="lg">
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 sm:px-6 sm:py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight">New idea</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">A link, a screenshot or a note is enough.</p>
          </div>
          <SheetCloseButton onClick={requestClose} label="Close" />
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {/* Basics */}
          <div className="space-y-4">
            <div>
              <label htmlFor="idea-title" className={labelStyles}>
                Title <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                id="idea-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={preview.suggestedTitle || 'e.g. Desk lighting flip transition'}
                maxLength={300}
                className={cx(inputStyles, 'h-12 text-base font-medium sm:text-[15px]')}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="idea-platform" className={labelStyles}>Platform</label>
                <FormSelect id="idea-platform" value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="idea-channel" className={labelStyles}>Channel</label>
                <FormSelect id="idea-channel" value={channelName} onChange={(e) => setChannelName(e.target.value)}>
                  <option value="">No channel yet</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </FormSelect>
              </div>
            </div>
          </div>

          {/* Reference */}
          <fieldset
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
              if (file) handleScreenshotPick(file);
            }}
            className={cx(
              'space-y-3 rounded-2xl border-2 border-dashed p-3 transition-colors sm:p-4',
              isDragOver ? 'border-electric-500 bg-electric-50/60 dark:bg-electric-950/30' : 'border-zinc-200 dark:border-zinc-800'
            )}
          >
            <legend className="px-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Reference</legend>
            <p className="hidden items-center gap-2 text-xs text-zinc-500 sm:flex dark:text-zinc-400">
              <UploadCloud className="h-4 w-4 text-electric-600 dark:text-electric-400" aria-hidden="true" />
              Paste the link that inspired you, and drop in a screenshot if you have one.
            </p>

            <div>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="idea-link"
                  type="url"
                  inputMode="url"
                  autoFocus
                  aria-label="Reference link"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="Paste a YouTube, Instagram or TikTok link"
                  className={cx(inputStyles, 'h-11 pl-10')}
                />
              </div>
              {preview.domain ? (
                <p className="mt-1.5 flex items-center gap-1.5 truncate px-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <ExternalLink className="h-3 w-3 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">{preview.domain}</span>
                  <span className="truncate">· {preview.suggestedTitle}</span>
                </p>
              ) : null}
            </div>

            {screenshotUrl ? (
              <div className="relative aspect-[16/7] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                <MediaImage src={screenshotUrl} alt="Screenshot" />
                <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                  Screenshot
                </span>
                <button
                  type="button"
                  onClick={() => setScreenshotUrl('')}
                  aria-label="Remove screenshot"
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <label
                className={cx(
                  'flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 text-center text-xs font-semibold text-zinc-600 transition-colors focus-within:ring-4 focus-within:ring-electric-500/15 hover:border-electric-300 hover:bg-electric-50/60 hover:text-electric-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-electric-800 dark:hover:bg-electric-950/30',
                  uploadingShot && 'pointer-events-none animate-pulse opacity-60'
                )}
              >
                <ImagePlus className="h-5 w-5" aria-hidden="true" />
                {uploadingShot ? 'Adding screenshot…' : 'Add a screenshot'}
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
          </fieldset>

          {/* Notes */}
          <div className="space-y-4">
            <div>
              <label htmlFor="idea-notes" className={labelStyles}>Notes</label>
              <textarea
                id="idea-notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What caught your eye? Hook, angle, pacing, shots you want…"
                className={cx(inputStyles, 'py-3 leading-relaxed')}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="idea-tags" className={labelStyles}>Tags</label>
                <input
                  id="idea-tags"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="#hook #lighting"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={cx(inputStyles, 'h-11 font-mono text-[13px]')}
                />
              </div>
              <div>
                <label htmlFor="idea-target-date" className={labelStyles}>Target date</label>
                <input
                  id="idea-target-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className={cx(inputStyles, 'h-11')}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-100 bg-white/90 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:px-6 sm:pb-3 dark:border-zinc-800 dark:bg-zinc-950/90">
          {error ? (
            <p role="alert" className="mb-2.5 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={requestClose} className={cx(buttonStyles.secondary, sizes.md, 'flex-1 sm:flex-none')}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || uploadingShot}
              className={cx(buttonStyles.primary, sizes.md, 'flex-[2] sm:flex-none sm:px-6')}
            >
              {saving ? 'Saving…' : 'Save idea'}
            </button>
          </div>
        </div>
      </form>
    </Sheet>
  );
}
