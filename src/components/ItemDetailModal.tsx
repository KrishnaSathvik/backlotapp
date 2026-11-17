'use client';

import React, { useEffect, useState } from 'react';
import JSZip from 'jszip';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  MessageSquare,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatFileSize,
  formatTagsForCopy,
  getPlatformLabel,
  STATUS_OPTIONS,
  type ContentItem,
  type MediaAsset,
  type StatusKey,
} from '@/src/lib/content-logic';
import { fetchAssetAsBlob, resolveAssetUrl } from '@/src/lib/local-vault';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { MediaImage } from './MediaImage';
import {
  buttonStyles,
  copyToClipboard,
  cx,
  inputStyles,
  labelStyles,
  Sheet,
  SheetCloseButton,
  sizes,
  StagePill,
  useFeedback,
} from './ui';

const isWebLink = (url: string) => /^https?:\/\//i.test(url.trim());

interface ItemDetailModalProps {
  item: ContentItem | null;
  onClose: () => void;
  onEdit: (item: ContentItem) => void;
  onDelete: (item: ContentItem) => Promise<void>;
  /** Demo mode: view and copy only. */
  readOnly?: boolean;
  onUpdateFields: (
    itemId: number,
    patch: Partial<Pick<ContentItem, 'status' | 'postDate' | 'liveLink' | 'notes'>>
  ) => Promise<void>;
  onAskAI: (item: ContentItem) => void;
}

export const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  item,
  onClose,
  onEdit,
  onDelete,
  onUpdateFields,
  readOnly = false,
  onAskAI,
}) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState(false);
  const [resolvedVideoEntry, setResolvedVideoEntry] = useState<{
    key: string;
    url: string;
  }>({ key: '', url: '' });

  const [status, setStatus] = useState<StatusKey>(item?.status ?? 'idea');
  const [postDate, setPostDate] = useState(item?.postDate ?? '');
  const [liveLink, setLiveLink] = useState(item?.liveLink ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [savingMeta, setSavingMeta] = useState(false);
  const { toast } = useFeedback();

  const rawVideoUrl = item?.videoAsset?.url ?? '';
  const isIdbVideo = rawVideoUrl.startsWith('idb://');

  useEffect(() => {
    if (!rawVideoUrl || !isIdbVideo) return;
    let active = true;
    let revokeUrl: string | null = null;

    resolveAssetUrl(rawVideoUrl).then((resolved) => {
      if (!active) {
        if (resolved.startsWith('blob:')) URL.revokeObjectURL(resolved);
        return;
      }
      if (resolved.startsWith('blob:')) revokeUrl = resolved;
      setResolvedVideoEntry({ key: rawVideoUrl, url: resolved });
    });

    return () => {
      active = false;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [rawVideoUrl, isIdbVideo]);

  const videoSrc = !rawVideoUrl
    ? ''
    : isIdbVideo
    ? resolvedVideoEntry.key === rawVideoUrl
      ? resolvedVideoEntry.url
      : ''
    : rawVideoUrl;

  if (!item) return null;

  const copyText = async (key: string, value: string) => {
    if (!value.trim()) return;
    if (await copyToClipboard(value)) {
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1500);
    } else {
      toast('Could not copy to clipboard', 'error');
    }
  };

  const downloadSingleAsset = async (asset: MediaAsset) => {
    const blob = await fetchAssetAsBlob(asset.url);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = asset.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }
    const a = document.createElement('a');
    a.href = asset.url.includes('?') ? `${asset.url}&download=1` : `${asset.url}?download=1`;
    a.download = asset.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
          .replace(/^-|-$/g, '') || 'content-vault-item';

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

  const handleSaveTracking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMeta(true);
    try {
      await onUpdateFields(item.id, { status, postDate, liveLink, notes });
    } finally {
      setSavingMeta(false);
    }
  };

  const allAssets: Array<{ label: string; asset: MediaAsset }> = [];
  if (item.coverAsset) allAssets.push({ label: 'Cover', asset: item.coverAsset });
  if (item.videoAsset) allAssets.push({ label: 'Video', asset: item.videoAsset });
  item.slides.forEach((s, idx) =>
    allAssets.push({ label: `Slide ${idx + 1}`, asset: s })
  );

  const tagsFormatted = formatTagsForCopy(item.tags);

  return (
    <Sheet onClose={onClose} label={`Details for ${item.title}`} size="xl">
        <div className="border-b border-zinc-100 px-5 pb-4 pt-3 sm:px-6 sm:pt-5 dark:border-zinc-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <StagePill status={item.status} />
                <span className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
                  <PlatformIcon platform={item.platform} size={16} />
                  {getPlatformLabel(item.platform)}
                </span>
                {item.channelName ? <span>· {item.channelName}</span> : null}
              </div>
              <h2 className="mt-2 text-lg font-bold leading-snug tracking-tight sm:text-xl">{item.title}</h2>
            </div>
            <SheetCloseButton onClick={onClose} label="Close" />
          </div>
          <div className="mt-3 flex gap-2">
            {readOnly ? null : (
              <button type="button" onClick={() => onEdit(item)} className={cx(buttonStyles.secondary, sizes.sm, 'h-9')}>
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            )}
            <button type="button" onClick={() => onAskAI(item)} className={cx(buttonStyles.secondary, sizes.sm, 'h-9')}>
              <MessageSquare className="h-3.5 w-3.5 text-electric-600 dark:text-electric-400" aria-hidden="true" />
              Ask AI
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-1 gap-5 p-5 sm:p-6 lg:grid-cols-12">
          {/* Left Column: Media Preview & Downloads */}
          <div className="space-y-4 lg:col-span-7">
            {videoSrc ? (
              <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
                <video
                  src={videoSrc}
                  controls
                  playsInline
                  className="max-h-[360px] w-full"
                />
              </div>
            ) : item.slides.length > 0 ? (
              <div className="space-y-3">
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                  <MediaImage
                    src={item.slides[slideIndex]?.url}
                    alt={`Slide ${slideIndex + 1}`}
                    fallbackLabel={`Slide ${slideIndex + 1}`}
                  />
                  {item.slides.length > 1 ? (
                    <div className="absolute inset-x-3 top-1/2 flex -translate-y-1/2 items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          setSlideIndex((i) =>
                            i === 0 ? item.slides.length - 1 : i - 1
                          )
                        }
                        aria-label="Previous slide"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSlideIndex((i) => (i + 1) % item.slides.length)
                        }
                        aria-label="Next slide"
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                  <div className="absolute bottom-2.5 right-2.5 rounded-md bg-black/75 px-2 py-1 font-mono text-xs text-white tabular-nums">
                    {slideIndex + 1} / {item.slides.length}
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {item.slides.map((slide, idx) => (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => setSlideIndex(idx)}
                      aria-label={`View slide ${idx + 1}`}
                      className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${
                        idx === slideIndex
                          ? 'border-electric-600'
                          : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <MediaImage src={slide.url} alt={slide.name} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="aspect-[16/10] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                <MediaImage
                  src={item.coverAsset?.url}
                  alt={item.title}
                  fallbackLabel="No video or cover uploaded yet"
                />
              </div>
            )}

            {/* Files & ZIP Download */}
            <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    Files ({allAssets.length})
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Save one file, or everything plus the caption as a .zip.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  disabled={zipProgress}
                  className={cx(buttonStyles.primary, sizes.sm, 'h-9')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {zipProgress ? 'Zipping…' : 'Download all'}
                </button>
              </div>

              {allAssets.length > 0 ? (
                <ul className="mt-3 divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {allAssets.map(({ label, asset }) => (
                    <li
                      key={`${label}-${asset.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{label}</p>
                        <p className="truncate text-zinc-500 dark:text-zinc-400">
                          {asset.name} · <span className="tabular-nums">{formatFileSize(asset.size)}</span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadSingleAsset(asset)}
                        aria-label={`Download ${asset.name}`}
                        className={cx(buttonStyles.secondary, sizes.sm, 'shrink-0')}
                      >
                        <Download className="h-3 w-3" />
                        Save
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Right Column: One-tap Copy + Tracking + References */}
          <div className="space-y-5 lg:col-span-5">
            {/* One-tap Copy Blocks */}
            <div className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Title
                </span>
                <button
                  type="button"
                  onClick={() => copyText('title', item.title)}
                  className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-electric-600 hover:bg-electric-50 dark:text-electric-400 dark:hover:bg-electric-950/40"
                >
                  {copiedField === 'title' ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {item.title}
              </p>

              <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Caption
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText('caption', item.caption)}
                    className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-electric-600 hover:bg-electric-50 dark:text-electric-400 dark:hover:bg-electric-950/40"
                  >
                    {copiedField === 'caption' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {item.caption || 'No caption written yet.'}
                </p>
              </div>

              <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Tags
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText('tags', tagsFormatted)}
                    className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-electric-600 hover:bg-electric-50 dark:text-electric-400 dark:hover:bg-electric-950/40"
                  >
                    {copiedField === 'tags' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                  {tagsFormatted || 'No tags added.'}
                </p>
              </div>
            </div>

            {/* Status, Post Date, Live Link, Notes */}
            {readOnly ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-zinc-200/80 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
                <div>
                  <dt className="text-xs font-medium text-zinc-500">Stage</dt>
                  <dd className="mt-1"><StagePill status={item.status} /></dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-zinc-500">{item.postDate ? 'Posted on' : 'Target date'}</dt>
                  <dd className="mt-1 font-medium tabular-nums">{item.postDate || item.targetDate || '—'}</dd>
                </div>
                {isWebLink(item.liveLink) ? (
                  <div className="col-span-2">
                    <dt className="text-xs font-medium text-zinc-500">Live post</dt>
                    <dd className="mt-1">
                      <a href={item.liveLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-electric-600 hover:underline dark:text-electric-400">
                        <span className="truncate">{item.liveLink.replace(/^https?:\/\//, '')}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </a>
                    </dd>
                  </div>
                ) : null}
                {item.notes ? (
                  <div className="col-span-2">
                    <dt className="text-xs font-medium text-zinc-500">Production notes</dt>
                    <dd className="mt-1 leading-relaxed text-zinc-700 dark:text-zinc-300">{item.notes}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
            <form
              onSubmit={handleSaveTracking}
              className="space-y-3 rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60"
            >
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Tracking
              </h3>

              <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
                <div>
                  <label
                    htmlFor="detail-status"
                    className={labelStyles}
                  >
                    Stage
                  </label>
                  <FormSelect
                    id="detail-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusKey)}
                    className="mt-0"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </FormSelect>
                </div>

                <div>
                  <label
                    htmlFor="detail-post-date"
                    className={labelStyles}
                  >
                    Post Date
                  </label>
                  <input
                    id="detail-post-date"
                    type="date"
                    value={postDate}
                    onChange={(e) => setPostDate(e.target.value)}
                    className={cx(inputStyles, 'h-11')}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="detail-live-link"
                  className={labelStyles}
                >
                  Live Post URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="detail-live-link"
                    type="url"
                    value={liveLink}
                    onChange={(e) => setLiveLink(e.target.value)}
                    placeholder="https://youtube.com/... or instagram.com/..."
                    className={cx(inputStyles, 'h-11 flex-1')}
                  />
                  {isWebLink(liveLink) ? (
                    <a
                      href={liveLink.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open live link"
                      className={cx(buttonStyles.secondary, 'h-11 w-11 shrink-0 text-electric-600 dark:text-electric-400')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div>
                <label
                  htmlFor="detail-notes"
                  className={labelStyles}
                >
                  Production Notes
                </label>
                <textarea
                  id="detail-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={cx(inputStyles, 'py-2.5')}
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => onDelete(item)}
                  className={cx(buttonStyles.dangerGhost, sizes.sm, 'h-10 px-3')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Post
                </button>

                <button
                  type="submit"
                  disabled={savingMeta}
                  className={cx(buttonStyles.primary, sizes.md)}
                >
                  {savingMeta ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
            )}

            {/* Attached References */}
            {item.attachedReferences.length > 0 ? (
              <div className="space-y-2.5 rounded-2xl border border-zinc-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
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
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-electric-600 hover:underline dark:text-electric-400"
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
        </div>
        </div>
    </Sheet>
  );
};
