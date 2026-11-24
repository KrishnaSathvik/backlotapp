'use client';

import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Files,
  MessageSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatTagsForCopy,
  getPlatformLabel,
  getPlatformShortLabel,
  normalizeStatus,
  parseTagsInput,
  PLATFORM_OPTIONS,
  type ChannelItem,
  type ContentItem,
  type PlatformKey,
  type MediaAsset,
  type StatusKey,
  referencePreview,
} from '@/src/lib/content-logic';
import { firstPreviewLink } from '@/src/lib/link-preview';
import { fetchAssetAsBlob, resolveAssetUrl } from '@/src/lib/local-vault';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { LinkThumbnail } from './LinkThumbnail';
import { FramedImage, MediaImage } from './MediaImage';
import {
  ActionMenu,
  buttonStyles,
  copyToClipboard,
  cx,
  inputStyles,
  labelStyles,
  Sheet,
  SheetCloseButton,
  sizes,
  StagePill,
  StageSwitch,
  useFeedback,
} from './ui';
import { PostFiles } from './PostFiles';

const isWebLink = (url: string) => /^https?:\/\//i.test(url.trim());

/** Cover first, then slides. A cover that is already the first slide is not shown twice. */
function galleryFrames(item: ContentItem): MediaAsset[] {
  const slides = [...item.slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const cover = item.coverAsset;
  if (cover && !slides.some((slide) => slide.id === cover.id || slide.url === cover.url)) {
    return [cover, ...slides];
  }
  return slides;
}

function PlayableVideo({ url, className }: { url: string; className?: string }) {
  const isIdb = url.startsWith('idb://');
  const [src, setSrc] = useState(isIdb ? '' : url);

  useEffect(() => {
    if (!isIdb) {
      setSrc(url);
      return;
    }
    let active = true;
    let revokeUrl: string | null = null;
    resolveAssetUrl(url).then((resolved) => {
      if (!active) {
        if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved);
        return;
      }
      if (resolved.startsWith('blob:')) revokeUrl = resolved;
      setSrc(resolved);
    });
    return () => {
      active = false;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [isIdb, url]);

  if (!src) return <div className={className} />;
  return <video src={src} controls playsInline className={className} />;
}

type PostDraft = {
  title: string;
  caption: string;
  tags: string;
  status: StatusKey;
  platform: PlatformKey;
  channelName: string;
  targetDate: string;
  postDate: string;
  liveLink: string;
  notes: string;
};

/** Date inputs only accept yyyy-mm-dd. A longer stored value still starts with that. */
const dateInputValue = (value: string) => (/^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value);

const draftFrom = (src: ContentItem | null): PostDraft => ({
  title: src?.title ?? '',
  caption: src?.caption ?? '',
  tags: formatTagsForCopy(src?.tags ?? []),
  status: (src?.status ?? 'idea') as StatusKey,
  platform: (src?.platform ?? 'youtube_long') as PlatformKey,
  channelName: src?.channelName ?? '',
  targetDate: dateInputValue(src?.targetDate ?? ''),
  postDate: dateInputValue(src?.postDate ?? ''),
  liveLink: src?.liveLink ?? '',
  notes: src?.notes ?? '',
});

/**
 * The shape the server stores. Title and the live URL are trimmed, tags are rewritten with
 * hashes, and retired stages fold into Planned. Comparing the raw input to that row left the
 * dialog dirty after a save that had already succeeded.
 */
const canonicalDraft = (d: PostDraft): PostDraft => ({
  ...d,
  title: d.title.trim(),
  tags: formatTagsForCopy(parseTagsInput(d.tags)),
  status: normalizeStatus(d.status),
  liveLink: d.liveLink.trim(),
  targetDate: dateInputValue(d.targetDate),
  postDate: dateInputValue(d.postDate),
});

const sameDraft = (a: PostDraft, b: PostDraft) => {
  const left = canonicalDraft(a);
  const right = canonicalDraft(b);
  return (Object.keys(left) as Array<keyof PostDraft>).every((k) => left[k] === right[k]);
};

export type ItemFieldsPatch = Partial<
  Pick<
    ContentItem,
    | 'title'
    | 'caption'
    | 'tags'
    | 'status'
    | 'platform'
    | 'channelName'
    | 'targetDate'
    | 'postDate'
    | 'liveLink'
    | 'notes'
    | 'coverAsset'
    | 'videoAsset'
    | 'slides'
  >
>;

interface ItemDetailModalProps {
  item: ContentItem | null;
  channels: ChannelItem[];
  /** For TikTok link thumbnails (YouTube's need nothing). */
  authToken?: string | null;
  onClose: () => void;
  sourceIdea?: { id: number; title: string } | null;
  onOpenIdea?: (id: number) => void;
  onDelete: (item: ContentItem) => Promise<void>;
  onDuplicate: (item: ContentItem) => Promise<void>;
  onUpdateFields: (itemId: number, patch: ItemFieldsPatch) => Promise<ContentItem | null>;
  onAskAI: (item: ContentItem) => void;
  /** The same post on other channels, shown as one library card. */
  alsoOn?: ContentItem[];
  onOpenItem?: (item: ContentItem) => void;
}

export const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  item,
  channels,
  authToken = null,
  onClose,
  sourceIdea = null,
  onOpenIdea,
  onDelete,
  onDuplicate,
  onUpdateFields,
  onAskAI,
  alsoOn = [],
  onOpenItem,
}) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState(false);

  // Everything on the right is edited in place; one Save writes all of it.
  const [draft, setDraft] = useState(() => draftFrom(item));
  const [saving, setSaving] = useState(false);
  const liveLinkRef = useRef<HTMLInputElement>(null);
  const { toast, confirm } = useFeedback();
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setStage = (next: 'idea' | 'ready' | 'posted') => {
    setDraft((d) => {
      if (next !== 'posted' || d.postDate) return { ...d, status: next };
      const t = new Date();
      const postDate = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
      return { ...d, status: next, postDate };
    });
    if (next === 'posted') requestAnimationFrame(() => liveLinkRef.current?.focus());
  };

  const frames = item ? galleryFrames(item) : [];
  const frameIndex = frames.length ? Math.min(slideIndex, frames.length - 1) : 0;
  const frame = frames[frameIndex] ?? null;

  useEffect(() => {
    setSlideIndex(0);
  }, [item?.id]);

  useEffect(() => {
    if (frames.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      setSlideIndex((current) => {
        const index = Math.min(current, frames.length - 1);
        if (event.key === 'ArrowRight') return (index + 1) % frames.length;
        return index === 0 ? frames.length - 1 : index - 1;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frames.length]);

  if (!item) return null;

  const showNext = () => {
    if (frames.length < 2) return;
    setSlideIndex((current) => (Math.min(current, frames.length - 1) + 1) % frames.length);
  };
  const showPrevious = () => {
    if (frames.length < 2) return;
    setSlideIndex((current) => {
      const index = Math.min(current, frames.length - 1);
      return index === 0 ? frames.length - 1 : index - 1;
    });
  };
  const removeFrame = (asset: MediaAsset) => {
    if (item.coverAsset?.id === asset.id) {
      void onUpdateFields(item.id, { coverAsset: null });
      return;
    }
    const slides = item.slides.filter((slide) => slide.id !== asset.id).map((slide, index) => ({ ...slide, order: index }));
    void onUpdateFields(item.id, { slides });
  };

  const copyText = async (key: string, value: string) => {
    if (!value.trim()) return;
    if (await copyToClipboard(value)) {
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1500);
    } else {
      toast('Could not copy to clipboard', 'error');
    }
  };

  const handleDownloadAllZip = async () => {
    setZipProgress(true);
    try {
      const zip = new JSZip();
      const assets: Array<{ folder: string; asset: MediaAsset }> = [];
      if (item.coverAsset) assets.push({ folder: 'cover', asset: item.coverAsset });
      if (item.videoAsset) assets.push({ folder: 'video', asset: item.videoAsset });
      item.slides.forEach((slide, index) => {
        assets.push({
          folder: `slides/${String(index + 1).padStart(2, '0')}-${slide.name}`,
          asset: slide,
        });
      });

      const textSummary = [
        `Title: ${item.title}`,
        `Platform: ${getPlatformLabel(item.platform)}`,
        `Channel: ${item.channelName || 'None'}`,
        `Status: ${item.status}`,
        `Post Date: ${item.postDate || 'Not set'}`,
        `Live Link: ${item.liveLink || 'Not set'}`,
        '',
        'Caption:',
        item.caption || '',
        '',
        'Tags:',
        formatTagsForCopy(item.tags),
        '',
        'Notes:',
        item.notes || '',
      ].join('\n');

      zip.file('caption-and-tags.txt', textSummary);

      for (const entry of assets) {
        const blob = await fetchAssetAsBlob(entry.asset.url);
        if (blob) {
          const targetPath = entry.folder.includes('/')
            ? entry.folder
            : `${entry.folder}/${entry.asset.name}`;
          zip.file(targetPath, blob);
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const slug =
        item.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || 'backlot-item';

      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not build the zip file', 'error');
    } finally {
      setZipProgress(false);
    }
  };

  const saved = draftFrom(item);
  const current = canonicalDraft(draft);
  const previous = canonicalDraft(saved);
  const changedKeys = (Object.keys(current) as Array<keyof PostDraft>).filter((k) => current[k] !== previous[k]);
  const dirty = !sameDraft(draft, saved);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!current.title) {
      toast('Give the post a title', 'error');
      return;
    }
    const patch: ItemFieldsPatch = {};
    for (const k of changedKeys) {
      if (k === 'tags') patch.tags = parseTagsInput(draft.tags);
      else if (k === 'status') patch.status = current.status;
      else if (k === 'title') patch.title = current.title;
      else if (k === 'liveLink') patch.liveLink = current.liveLink;
      else if (k === 'postDate') patch.postDate = current.postDate;
      else if (k === 'targetDate') patch.targetDate = current.targetDate;
      else Object.assign(patch, { [k]: current[k] });
    }
    setSaving(true);
    try {
      const savedItem = await onUpdateFields(item.id, patch);
      // Adopt the saved row so X closes. The server's copy is the new baseline.
      if (savedItem) setDraft(draftFrom(savedItem));
    } finally {
      setSaving(false);
    }
  };

  /** Runs `next` right away, or after confirming that unsaved edits can be dropped. */
  const leave = async (next: () => void) => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard your changes?',
        body: 'You have edits on this post that haven’t been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    next();
  };
  const requestClose = () => leave(onClose);

  const allAssets: Array<{ label: string; asset: MediaAsset }> = [];
  if (item.coverAsset) allAssets.push({ label: 'Cover', asset: item.coverAsset });
  if (item.videoAsset) allAssets.push({ label: 'Video', asset: item.videoAsset });
  item.slides.forEach((s, idx) =>
    allAssets.push({ label: `Slide ${idx + 1}`, asset: s })
  );

  const copyButton = (key: string, value: string) => (
    <button
      type="button"
      onClick={() => copyText(key, value)}
      disabled={!value.trim()}
      className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-electric-600 hover:bg-electric-50 disabled:opacity-40 disabled:hover:bg-transparent dark:text-electric-400 dark:hover:bg-electric-950/40"
    >
      {copiedField === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copiedField === key ? 'Copied' : 'Copy'}
    </button>
  );
  const channelOptions = channels.some((c) => c.name === draft.channelName) || !draft.channelName
    ? channels.map((c) => c.name)
    : [draft.channelName, ...channels.map((c) => c.name)];

  return (
    <Sheet onClose={requestClose} label={`Details for ${item.title}`} size="lg" fullscreenOnMobile>
        <div className="shrink-0 border-b border-zinc-100 px-5 pb-4 pt-3 sm:px-6 sm:pt-5 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 pt-1 text-lg font-bold leading-snug tracking-tight sm:text-xl">{item.title}</h2>
            <SheetCloseButton onClick={requestClose} label="Close" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => leave(() => onAskAI(item))} className={cx(buttonStyles.secondary, sizes.sm, 'h-9')}>
              <MessageSquare className="h-3.5 w-3.5 text-cantaloupe-500" aria-hidden="true" />
              Ask Slate
            </button>
            <ActionMenu
              className="ml-auto"
              items={[
                { label: 'Duplicate', icon: Files, onSelect: () => leave(() => onDuplicate(item)) },
                { label: 'Delete post', icon: Trash2, onSelect: () => onDelete(item), tone: 'danger' },
              ]}
            />
          </div>
          {alsoOn.length > 0 && onOpenItem ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Also on</span>
              {alsoOn.map((other) => (
                <button
                  key={other.id}
                  type="button"
                  onClick={() => onOpenItem(other)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:border-border-strong dark:text-zinc-200"
                >
                  <PlatformIcon platform={other.platform} size={14} />
                  {getPlatformShortLabel(other.platform)}
                  <StagePill status={other.status} />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-1 items-start gap-5 p-5 sm:p-6">
          {/* Media and files, then the form. One scrolling column on phone, tablet and desktop. */}
          <div className="min-w-0 space-y-4">
            {item.videoAsset?.url ? (
              <div className="group relative overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
                <PlayableVideo url={item.videoAsset.url} className="max-h-56 w-full sm:max-h-64 md:max-h-[300px]" />
                <button
                  type="button"
                  aria-label="Remove video"
                  onClick={() => void onUpdateFields(item.id, { videoAsset: null })}
                  className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            {frame ? (
              <div className="group relative aspect-video max-h-56 w-full overflow-hidden rounded-xl border border-border bg-surface-2 sm:max-h-64 md:aspect-[4/3] md:max-h-none">
                {frame.mimeType.startsWith('video/') ? (
                  <PlayableVideo url={frame.url} className="absolute inset-0 h-full w-full bg-black object-contain" />
                ) : (
                  <button
                    type="button"
                    onClick={showNext}
                    aria-label={frames.length > 1 ? 'Next image' : frame.name}
                    className={cx('absolute inset-0 block h-full w-full', frames.length > 1 ? 'cursor-pointer' : 'cursor-default')}
                  >
                    <FramedImage
                      src={frame.url}
                      alt={frame.name || `Image ${frameIndex + 1}`}
                      fallbackLabel={`Image ${frameIndex + 1}`}
                      preferFull
                    />
                  </button>
                )}
                {frames.length > 1 ? (
                  <div className="pointer-events-none absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2 items-center justify-between">
                    <button
                      type="button"
                      onClick={showPrevious}
                      aria-label="Previous image"
                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={showNext}
                      aria-label="Next image"
                      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                {frames.length > 1 ? (
                  <div className="absolute bottom-2.5 right-2.5 z-10 rounded-md bg-black/75 px-2 py-1 font-mono text-xs text-white tabular-nums">
                    {frameIndex + 1} / {frames.length}
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-label={frame.mimeType.startsWith('video/') ? 'Remove this video' : 'Remove this image'}
                  onClick={() => removeFrame(frame)}
                  className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : !item.videoAsset?.url && (item.coverAsset?.url || referencePreview(item.attachedReferences).screenshotUrl || firstPreviewLink(draft.liveLink, referencePreview(item.attachedReferences).link)) ? (
              <div className="aspect-video max-h-56 w-full overflow-hidden rounded-xl border border-border bg-surface-2 sm:max-h-64 md:aspect-[16/10] md:max-h-72">
                {(() => {
                  const ref = referencePreview(item.attachedReferences);
                  const previewLink = firstPreviewLink(draft.liveLink, ref.link);
                  const fallback = <MediaImage src={null} alt={item.title} fallbackLabel="No video or cover uploaded yet" />;
                  if (item.coverAsset?.url || ref.screenshotUrl) return <MediaImage src={item.coverAsset?.url || ref.screenshotUrl} alt={item.title} />;
                  return <LinkThumbnail link={previewLink} authToken={authToken} className="h-full w-full object-cover" fallback={fallback} />;
                })()}
              </div>
            ) : null}

            {sourceIdea ? (
              <button
                type="button"
                onClick={() => onOpenIdea?.(sourceIdea.id)}
                className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface-2 px-3 py-2 text-left text-sm"
              >
                <span>
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">From idea</span>
                  <span className="font-semibold">{sourceIdea.title}</span>
                </span>
                <span className="text-xs font-semibold text-link">Open</span>
              </button>
            ) : null}
            <PostFiles
              item={item}
              authToken={authToken}
              onPatch={async (patch) => (await onUpdateFields(item.id, patch)) != null}
              onDownloadAll={handleDownloadAllZip}
              zipBusy={zipProgress}
            />
          </div>

          {/* Right Column: the post's copy and details, edited in place */}
          <form id="post-inline-form" onSubmit={handleSave} className="min-w-0 space-y-5">
            <div className="min-w-0 space-y-5">
            <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="detail-title" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Title</label>
                  {copyButton('title', draft.title)}
                </div>
                <input
                  id="detail-title"
                  value={draft.title}
                  onChange={(e) => set('title')(e.target.value)}
                  maxLength={300}
                  className={cx(inputStyles, 'h-11 font-medium')}
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="detail-caption" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{draft.platform === 'youtube_long' ? 'Description' : 'Caption'}</label>
                  {copyButton('caption', draft.caption)}
                </div>
                <textarea
                  id="detail-caption"
                  rows={4}
                  value={draft.caption}
                  onChange={(e) => set('caption')(e.target.value)}
                  placeholder="Write the caption…"
                  className={cx(inputStyles, 'py-2.5 leading-relaxed')}
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="detail-tags" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Tags</label>
                  {copyButton('tags', formatTagsForCopy(parseTagsInput(draft.tags)))}
                </div>
                <input
                  id="detail-tags"
                  value={draft.tags}
                  onChange={(e) => set('tags')(e.target.value)}
                  placeholder="#travel #cinematic"
                  className={cx(inputStyles, 'h-11 font-mono lg:text-xs')}
                />
              </div>
            </div>

            {/* Attached References */}
            {item.attachedReferences.length > 0 ? (
              <div className="space-y-2.5 rounded-2xl border border-border bg-surface p-4">
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Attached References ({item.attachedReferences.length})
                </h3>
                <div className="space-y-2">
                  {item.attachedReferences.map((ref) => (
                    <div
                      key={ref.id}
                      className="flex gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      {ref.screenshotUrl ? (
                        <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
                          <MediaImage src={ref.screenshotUrl} alt={ref.title} />
                        </div>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          {ref.title}
                        </p>
                        {ref.note ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {ref.note}
                          </p>
                        ) : null}
                        {isWebLink(ref.url) ? (
                          <a
                            href={ref.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-link hover:underline"
                          >
                            Open Reference
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            </div>

            <div className="min-w-0 space-y-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Details</h3>
              <div>
                <p className={labelStyles}>Stage</p>
                <StageSwitch value={draft.status} onChange={setStage} />
              </div>
              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                <div>
                  <label htmlFor="detail-platform" className={labelStyles}>Platform</label>
                  <FormSelect id="detail-platform" value={draft.platform} onChange={(e) => set('platform')(e.target.value as PlatformKey)}>
                    {PLATFORM_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </FormSelect>
                </div>
                <div className="min-[400px]:col-span-2">
                  <label htmlFor="detail-channel" className={labelStyles}>Channel</label>
                  <FormSelect id="detail-channel" value={draft.channelName} onChange={(e) => set('channelName')(e.target.value)}>
                    <option value="">No channel</option>
                    {channelOptions.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </FormSelect>
                </div>
                <div>
                  <label htmlFor="detail-target-date" className={labelStyles}>Target date</label>
                  <input
                    id="detail-target-date"
                    type="date"
                    value={draft.targetDate}
                    onChange={(e) => set('targetDate')(e.target.value)}
                    className={cx(inputStyles, 'h-11')}
                  />
                </div>
                <div>
                  <label htmlFor="detail-post-date" className={labelStyles}>Posted on</label>
                  <input
                    id="detail-post-date"
                    type="date"
                    value={draft.postDate}
                    onChange={(e) => set('postDate')(e.target.value)}
                    className={cx(inputStyles, 'h-11')}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="detail-live-link" className={labelStyles}>Live post URL</label>
                <div className="flex items-center gap-2">
                  <input
                    id="detail-live-link"
                    ref={liveLinkRef}
                    type="url"
                    value={draft.liveLink}
                    onChange={(e) => set('liveLink')(e.target.value)}
                    placeholder="https://youtube.com/... or instagram.com/..."
                    className={cx(inputStyles, 'h-11 flex-1')}
                  />
                  {isWebLink(draft.liveLink) ? (
                    <a
                      href={draft.liveLink.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open live link"
                      className={cx(buttonStyles.secondary, 'h-11 w-11 shrink-0 text-link')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div>
                <label htmlFor="detail-notes" className={labelStyles}>Production notes</label>
                <textarea
                  id="detail-notes"
                  rows={2}
                  value={draft.notes}
                  onChange={(e) => set('notes')(e.target.value)}
                  className={cx(inputStyles, 'py-2.5')}
                />
              </div>
            </div>

          </form>
        </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-surface px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden">
          <button type="button" onClick={() => copyText('caption', draft.caption)} className={cx(buttonStyles.secondary, sizes.md, 'flex-1')}>
            <Copy className="h-4 w-4" />
            Copy caption
          </button>
          <button type="button" onClick={handleDownloadAllZip} disabled={zipProgress || !allAssets.length} className={cx(buttonStyles.primary, sizes.md, 'flex-1')}>
            <Download className="h-4 w-4" />
            {zipProgress ? 'Zipping…' : 'Download all'}
          </button>
        </div>
        {dirty ? (
          <div className="animate-pop-in flex items-center justify-between gap-3 border-t border-zinc-100 bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="min-w-0 truncate text-[13px] font-medium text-zinc-500 max-[359px]:sr-only dark:text-zinc-400">Unsaved changes</p>
            <div className="ml-auto flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setDraft(draftFrom(item))}
                disabled={saving}
                className={cx(buttonStyles.secondary, sizes.md)}
              >
                Discard
              </button>
              <button type="submit" form="post-inline-form" disabled={saving} className={cx(buttonStyles.primary, sizes.md)}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        ) : null}
    </Sheet>
  );
};

