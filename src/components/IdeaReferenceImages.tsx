'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { MAX_IDEA_IMAGES } from '@/src/lib/content-logic';
import { uploadAssetResumable } from '@/src/lib/upload-client';
import { IMAGE_TYPES } from '@/src/lib/upload-limits';
import { MediaImage } from './MediaImage';
import { cx } from './ui';

/**
 * An idea's reference images: small tiles, a + tile to add (pick or drop several), × to remove,
 * tap to view full size. Changes save straight away through `onChange`.
 */
export function IdeaReferenceImages({
  images,
  authToken,
  onChange,
}: {
  images: string[];
  authToken: string | null;
  /** Saves the new list; resolves false if saving failed (the caller shows the error). */
  onChange: (next: string[]) => Promise<boolean>;
}) {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const room = MAX_IDEA_IMAGES - images.length;

  const add = async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, room);
    if (!picked.length) return;
    setError('');
    setUploading(picked.length);
    const urls: string[] = [];
    for (const file of picked) {
      try {
        urls.push((await uploadAssetResumable({ file, authToken })).url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t add that image.');
      }
      setUploading((n) => n - 1);
    }
    if (urls.length) await onChange([...images, ...urls]);
  };

  const remove = (url: string) => onChange(images.filter((u) => u !== url));

  const tile = 'relative aspect-square w-[72px] shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 sm:w-20 dark:border-zinc-800 dark:bg-zinc-900';

  return (
    <section
      aria-labelledby="idea-images-label"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <p id="idea-images-label" className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        Reference images <span className="font-normal text-zinc-400">{images.length ? `${images.length}/${MAX_IDEA_IMAGES}` : ''}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={url} className={cx(tile, 'group')}>
            <button type="button" onClick={() => setViewing(url)} aria-label={`View image ${i + 1}`} className="block h-full w-full">
              <MediaImage src={url} alt="" className="h-full w-full object-cover" />
            </button>
            <button
              type="button"
              onClick={() => void remove(url)}
              aria-label={`Remove image ${i + 1}`}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-opacity hover:bg-black/85 pointer-coarse:h-8 pointer-coarse:w-8 lg:pointer-fine:opacity-0 lg:pointer-fine:group-hover:opacity-100 lg:pointer-fine:focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className={cx(tile, 'animate-pulse')} aria-label="Adding image" />
        ))}
        {room - uploading > 0 ? (
          <label
            title="Add images"
            className={cx(
              tile,
              'flex cursor-pointer items-center justify-center border-dashed border-border-strong bg-transparent text-muted transition-colors hover:border-accent hover:text-link focus-within:ring-4 focus-within:ring-accent/15'
            )}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">Add images</span>
            <input
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void add(files);
              }}
            />
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {viewing ? <ImageViewer url={viewing} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

/** Full-size view. Escape or a click closes it (without closing the idea underneath). */
function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image"
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
    >
      <button type="button" onClick={onClose} aria-label="Close image" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20">
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="max-h-full max-w-4xl overflow-hidden rounded-2xl">
        <MediaImage src={url} alt="" className="max-h-[85dvh] w-auto max-w-full object-contain" />
      </div>
    </div>,
    document.body
  );
}
