'use client';

import React, { useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { placeUploadedAssets, type ContentItem, type MediaAsset } from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { buttonStyles, cx, sizes } from './ui';

/** Add files to the post, then download everything already on it. The pictures themselves show in the gallery above. */
export function PostFiles({
  item,
  authToken,
  onPatch,
  onDownloadAll,
  zipBusy,
}: {
  item: ContentItem;
  authToken: string | null;
  onPatch: (patch: { coverAsset?: MediaAsset | null; videoAsset?: MediaAsset | null; slides?: MediaAsset[] }) => Promise<boolean>;
  onDownloadAll?: () => void;
  zipBusy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState('');

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

  return (
    <div className="space-y-3">
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
