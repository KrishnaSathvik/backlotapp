'use client';

import React, { useRef, useState } from 'react';
import { Download, GripVertical, Plus, X } from 'lucide-react';
import { formatFileSize, placeUploadedAssets, reorderSlides, type ContentItem, type MediaAsset } from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { MediaImage } from './MediaImage';
import { buttonStyles, cx, sizes } from './ui';

/** Files on the post itself: drop or browse, then cover, video and slides stay in order. */
export function PostFiles({
  item,
  authToken,
  onPatch,
  onDownload,
  onDownloadAll,
  zipBusy,
}: {
  item: ContentItem;
  authToken: string | null;
  onPatch: (patch: { coverAsset?: MediaAsset | null; videoAsset?: MediaAsset | null; slides?: MediaAsset[] }) => Promise<boolean>;
  onDownload: (asset: MediaAsset) => void;
  onDownloadAll?: () => void;
  zipBusy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState('');
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const upload = async (files: File[]) => {
    const usable = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!usable.length) {
      setProgress('Choose an image or a video.');
      return;
    }
    try {
      const uploaded: MediaAsset[] = [];
      for (let i = 0; i < usable.length; i += 1) {
        // onProgress is already 0–100. Multiplying again showed 11% as 1100%.
        uploaded.push(
          await uploadAssetResumable({
            file: usable[i],
            authToken,
            onProgress: (p) => {
              const percent = Math.max(0, Math.min(100, Math.round(p)));
              setProgress(`Uploading ${i + 1} of ${usable.length} · ${percent}%`);
            },
          })
        );
      }
      const next = placeUploadedAssets(item, uploaded);
      setProgress('Saving…');
      const saved = await onPatch(next);
      setProgress(saved ? '' : 'The file uploaded, but it could not be saved on this post.');
    } catch (err) {
      setProgress(err instanceof Error && err.message ? err.message : 'Upload failed.');
    }
  };

  const patchSlides = (slides: MediaAsset[]) => onPatch({ slides: slides.map((s, i) => ({ ...s, order: i })) });

  return (
    <div className="space-y-3">
      {item.videoAsset ? <FileRow label="Video" asset={item.videoAsset} onDownload={onDownload} onRemove={() => onPatch({ videoAsset: null })} /> : null}
      {item.coverAsset ? <FileRow label="Cover" asset={item.coverAsset} onDownload={onDownload} onRemove={() => onPatch({ coverAsset: null })} /> : null}
      {item.slides.length ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {item.slides.map((slide, index) => (
            <li
              key={slide.id}
              draggable
              onDragStart={() => setDragFrom(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragFrom === null || dragFrom === index) return;
                patchSlides(reorderSlides(item.slides, dragFrom, index));
                setDragFrom(null);
              }}
              className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2"
            >
              <MediaImage src={slide.url} alt={slide.name} />
              <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-black/70 px-1 text-[11px] font-bold text-white tabular-nums">
                {index + 1}
              </span>
              <span className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <button type="button" aria-label={`Download ${slide.name}`} onClick={() => onDownload(slide)} className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                  <Download className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${slide.name}`}
                  onClick={() => patchSlides(item.slides.filter((s) => s.id !== slide.id))}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
              <GripVertical className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 text-white drop-shadow" aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(Array.from(e.dataTransfer.files)).catch((err) => setProgress(err instanceof Error ? err.message : 'Upload failed'));
        }}
        className={cx(
          'flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors',
          over ? 'border-accent bg-accent/5 text-text' : 'border-border-strong text-muted hover:border-accent hover:text-text'
        )}
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">Drop images, videos or slides here</span>
        <span className="text-xs">or click to browse</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          upload(files).catch((err) => setProgress(err instanceof Error ? err.message : 'Upload failed'));
        }}
      />
      {progress ? <p className="text-xs font-medium text-muted">{progress}</p> : null}
      {onDownloadAll && (item.coverAsset || item.videoAsset || item.slides.length) ? (
        <button type="button" onClick={onDownloadAll} disabled={zipBusy} className={cx(buttonStyles.primary, sizes.sm, 'h-9')}>
          <Download className="h-3.5 w-3.5" />
          {zipBusy ? 'Zipping…' : 'Download all'}
        </button>
      ) : null}
    </div>
  );
}

function FileRow({ label, asset, onDownload, onRemove }: { label: string; asset: MediaAsset; onDownload: (asset: MediaAsset) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">{label}</p>
        <p className="truncate text-muted">
          {asset.name} · {formatFileSize(asset.size)}
        </p>
      </div>
      <button type="button" aria-label={`Download ${asset.name}`} onClick={() => onDownload(asset)} className={cx(buttonStyles.ghost, 'h-8 w-8')}>
        <Download className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove} className={cx(buttonStyles.ghost, 'h-8 w-8')}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
