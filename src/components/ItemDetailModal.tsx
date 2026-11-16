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
import { MediaImage } from './MediaImage';

interface ItemDetailModalProps {
  item: ContentItem | null;
  onClose: () => void;
  onEdit: (item: ContentItem) => void;
  onDelete: (itemId: number) => Promise<void>;
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
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => setCopiedField((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      // Clipboard fallback ignored
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${item.title}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6"
    >
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white sm:rounded-2xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-blue-600 dark:text-blue-400">
                {getPlatformLabel(item.platform)}
              </span>
              {item.channelName ? ` · ${item.channelName}` : ''}
            </div>
            <h2 className="truncate text-lg font-bold text-zinc-950 dark:text-zinc-50">
              {item.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onAskAI(item)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              <MessageSquare className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Ask AI
            </button>
            <button
              type="button"
              onClick={() => onEdit(item)}
              aria-label={`Edit ${item.title}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close item detail"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-12">
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
                          ? 'border-blue-600'
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
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                    Files & Export ({allAssets.length})
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Download individual files or bundle media + caption text as a zip.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  disabled={zipProgress}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" />
                  {zipProgress ? 'Zipping...' : 'Download All (.zip)'}
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
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {label}
                        </span>
                        <span className="mx-1.5 text-zinc-400">·</span>
                        <span className="truncate text-zinc-600 dark:text-zinc-400">
                          {asset.name}
                        </span>
                        <span className="mx-1.5 text-zinc-400">·</span>
                        <span className="font-mono text-zinc-500 tabular-nums">
                          {formatFileSize(asset.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadSingleAsset(asset)}
                        aria-label={`Download ${asset.name}`}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800 shrink-0"
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
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Title
                </span>
                <button
                  type="button"
                  onClick={() => copyText('title', item.title)}
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                >
                  {copiedField === 'title' ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy Title
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
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                  >
                    {copiedField === 'caption' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Caption
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
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                  >
                    {copiedField === 'tags' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Tags
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
            <form
              onSubmit={handleSaveTracking}
              className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Tracking & Archive
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="detail-status"
                    className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Status
                  </label>
                  <FormSelect
                    id="detail-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as StatusKey)}
                    className="mt-1 h-9 dark:border-zinc-700 dark:bg-zinc-950"
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
                    className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                  >
                    Post Date
                  </label>
                  <input
                    id="detail-post-date"
                    type="date"
                    value={postDate}
                    onChange={(e) => setPostDate(e.target.value)}
                    className="mt-1 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="detail-live-link"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Live Post URL
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id="detail-live-link"
                    type="url"
                    value={liveLink}
                    onChange={(e) => setLiveLink(e.target.value)}
                    placeholder="https://youtube.com/... or instagram.com/..."
                    className="h-9 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  {liveLink ? (
                    <a
                      href={liveLink}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open live link"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-blue-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-blue-400"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div>
                <label
                  htmlFor="detail-notes"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Production Notes
                </label>
                <textarea
                  id="detail-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2.5 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onDelete(item.id);
                    onClose();
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Post
                </button>

                <button
                  type="submit"
                  disabled={savingMeta}
                  className="h-9 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingMeta ? 'Saving...' : 'Save Tracking'}
                </button>
              </div>
            </form>

            {/* Attached References */}
            {item.attachedReferences.length > 0 ? (
              <div className="space-y-2.5 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
                        {ref.url ? (
                          <a
                            href={ref.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
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
    </div>
  );
};
