'use client';

import React, { useState } from 'react';
import { ExternalLink, ImagePlus, Link2, X } from 'lucide-react';
import { extractDomainAndTitle, MAX_IDEA_IMAGES, type PlatformKey } from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { IMAGE_TYPES } from '@/src/lib/upload-limits';
import { MediaImage } from './MediaImage';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes, useFeedback } from './ui';

export interface IdeaCapturePayload {
  title: string;
  linkUrl: string;
  linkTitle: string;
  linkDomain: string;
  screenshotUrl: string;
  images?: string[];
  notes: string;
  platform: PlatformKey;
  channelName: string;
  tags: string[];
  targetDate: string;
}

/**
 * Builds a saved idea from whatever was captured: any one of text, a link or a screenshot is
 * enough. No channel or platform (an idea isn't tied to one until it becomes a post). The card
 * title is the first line of the text, else the link's title, else "Saved idea"; longer text is
 * kept in full as notes.
 */
export function buildIdeaPayload({ text, link, screenshotUrl = '', images = [], title: givenTitle = '' }: { text: string; link: string; screenshotUrl?: string; images?: string[]; title?: string }): IdeaCapturePayload | null {
  const t = text.trim();
  const named = givenTitle.trim();
  const preview = extractDomainAndTitle(link.trim());
  const pics = images.length ? images : screenshotUrl ? [screenshotUrl] : [];
  if (!t && !named && !preview.validUrl && !pics.length) return null;
  const firstLine = t.split('\n')[0].trim();
  const rawTitle = named || firstLine || preview.suggestedTitle || 'Saved idea';
  const title = rawTitle.length > 80 ? `${rawTitle.slice(0, 77).trimEnd()}…` : rawTitle;
  return {
    title,
    linkUrl: preview.validUrl,
    linkTitle: preview.suggestedTitle,
    linkDomain: preview.domain,
    screenshotUrl: pics[0] ?? '',
    images: pics,
    notes: t && t !== title ? t : '',
    platform: 'other',
    channelName: '',
    tags: [],
    targetDate: '',
  };
}

/** If the text is just a link, treat it as the link. */
export function splitTextAndLink(input: string): { text: string; link: string } {
  const v = input.trim();
  return /^https?:\/\/\S+$/i.test(v) || /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(v) ? { text: '', link: v } : { text: v, link: '' };
}

/** "Save an idea": a thought, a link or a screenshot. That's enough. */
export function IdeaCaptureSheet({
  authToken,
  initialDraft,
  onCapture,
  onClose,
}: {
  authToken: string | null;
  initialDraft?: { title: string; text: string; url: string } | null;
  onCapture: (payload: IdeaCapturePayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState([initialDraft?.title, initialDraft?.text].filter(Boolean).join('\n'));
  const [linkUrl, setLinkUrl] = useState(initialDraft?.url ?? '');
  const [images, setImages] = useState<string[]>([]);
  const [uploadingShot, setUploadingShot] = useState(false);
  const { confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const preview = extractDomainAndTitle(linkUrl);

  const addImages = async (files: File[]) => {
    const room = MAX_IDEA_IMAGES - images.length;
    const next = files.filter((f) => f.type.startsWith('image/')).slice(0, room);
    if (!next.length) return;
    setError('');
    setUploadingShot(true);
    try {
      const urls: string[] = [];
      for (const file of next) urls.push((await uploadAssetResumable({ file, authToken })).url);
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IDEA_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach that image.');
    } finally {
      setUploadingShot(false);
    }
  };

  const dirty = !!(text.trim() || linkUrl.trim() || images.length);

  const requestClose = async () => {
    if (dirty && !saving) {
      const ok = await confirm({ title: 'Discard this idea?', body: 'It hasn’t been saved.', confirmLabel: 'Discard', tone: 'danger' });
      if (!ok) return;
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pasted = linkUrl.trim() ? { text, link: linkUrl.trim() } : splitTextAndLink(text);
    const payload = buildIdeaPayload({ text: pasted.text, link: pasted.link, images });
    if (!payload) {
      setError('Add at least one thing to save.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await onCapture(payload);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet onClose={requestClose} label="New idea" size="md" floatOnMobile>
      <form
        onSubmit={handleSubmit}
        onDragOver={(e) => e.preventDefault()}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            addImages(files);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          addImages(Array.from(e.dataTransfer.files));
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-8">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight sm:text-2xl">New idea</h2>
            <p className="mt-0.5 text-[13px] text-zinc-500 sm:mt-1 sm:text-sm dark:text-zinc-400">Enter anything, then add a link and images if you have them.</p>
          </div>
          <SheetCloseButton onClick={requestClose} label="Close" />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-6 sm:block sm:px-8 sm:pb-0">
          <div className="mt-5 space-y-4 sm:mt-6">
            <input
              id="new-idea-title"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter anything"
              aria-label="Enter anything"
              autoFocus
              autoComplete="off"
              disabled={saving}
              className={cx(inputStyles, 'h-12 sm:h-11 lg:text-[15px]')}
            />
            <div>
              <label htmlFor="new-idea-link" className={labelStyles}>Link</label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="new-idea-link"
                  type="url"
                  inputMode="url"
                  enterKeyHint="done"
                  autoComplete="off"
                  aria-label="Link"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="Paste a link…"
                  disabled={saving}
                  className={cx(inputStyles, 'h-12 pl-10 sm:h-11')}
                />
              </div>
              {preview.domain ? (
                <p className="mt-1.5 flex min-w-0 items-center gap-1.5 px-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <ExternalLink className="h-3 w-3 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                  <span className="shrink-0 font-semibold text-zinc-700 dark:text-zinc-300">{preview.domain}</span>
                  <span className="min-w-0 truncate">· {preview.suggestedTitle}</span>
                </p>
              ) : null}
            </div>
            <div>
              <p className={labelStyles}>Images</p>
              <div className="flex flex-wrap items-center gap-2">
                {images.map((url) => (
                  <span key={url} className="relative h-16 w-16 overflow-hidden rounded-xl border border-border">
                    <MediaImage src={url} alt="" />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                      aria-label="Remove image"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {images.length < MAX_IDEA_IMAGES ? (
                  <label
                    className={cx(
                      buttonStyles.secondary,
                      'h-16 cursor-pointer border-dashed px-4 focus-within:ring-4 focus-within:ring-electric-500/15',
                      uploadingShot && 'pointer-events-none animate-pulse opacity-60'
                    )}
                  >
                    <ImagePlus className="h-4 w-4" aria-hidden="true" />
                    {uploadingShot ? 'Adding…' : 'Add images'}
                    <input
                      type="file"
                      accept={IMAGE_TYPES.join(',')}
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        e.target.value = '';
                        addImages(files);
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-3 px-5 pb-5 pt-5 *:flex-1 max-sm:*:h-12 sm:justify-end sm:px-8 sm:pb-8 sm:pt-8 sm:*:flex-none">
          <button type="button" onClick={requestClose} className={cx(buttonStyles.secondary, sizes.md)}>
            Cancel
          </button>
          <button type="submit" disabled={saving || uploadingShot || !dirty} className={cx(buttonStyles.primary, sizes.md, 'sm:min-w-32')}>
            {saving ? 'Saving…' : 'Save idea'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
