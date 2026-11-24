'use client';

import React, { useEffect, useState } from 'react';
import { Film, Image as ImageIcon } from 'lucide-react';
import { resolveAssetUrl } from '@/src/lib/local-vault';

interface MediaImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
  isVideo?: boolean;
  /** The loaded image, so a frame can show a tall picture whole instead of cropping it. */
  onLoad?: (image: HTMLImageElement) => void;
}

export const MediaImage: React.FC<MediaImageProps> = ({
  src,
  alt,
  className = 'h-full w-full object-cover',
  fallbackLabel,
  isVideo = false,
  onLoad,
}) => {
  const [blobEntry, setBlobEntry] = useState<{ key: string; url: string }>({
    key: '',
    url: '',
  });
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const isIdb = !!src && src.startsWith('idb://');

  useEffect(() => {
    if (!src || !isIdb) return;
    let active = true;
    let objectUrlToRevoke: string | null = null;

    resolveAssetUrl(src).then((url) => {
      if (!active) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      if (url.startsWith('blob:')) objectUrlToRevoke = url;
      setBlobEntry({ key: src, url });
    });

    return () => {
      active = false;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [src, isIdb]);

  const resolvedSrc = !src
    ? ''
    : isIdb
    ? blobEntry.key === src
      ? blobEntry.url
      : ''
    : src;
  const hasError = !!src && failedSrc === src;

  if (!resolvedSrc || hasError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-zinc-100 p-4 text-center text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        {isVideo ? (
          <Film className="h-6 w-6 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        ) : (
          <ImageIcon className="h-6 w-6 text-zinc-400 dark:text-zinc-500" aria-hidden="true" />
        )}
        {fallbackLabel ? (
          <span className="line-clamp-2 max-w-[180px] text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {fallbackLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    // Plain <img>: sources are blob: URLs or cookie-authenticated /api/files, which next/image can't optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onLoad={(event) => onLoad?.(event.currentTarget)}
      onError={() => setFailedSrc(src ?? null)}
      className={className}
    />
  );
};

/**
 * A library or slide frame. A wide picture fills it. A square or tall picture (an Instagram
 * slide) stays whole, with a blurred copy behind it so the frame does not show empty bars.
 */
export function FramedImage({
  src,
  alt,
  fallbackLabel,
  isVideo = false,
  preferFull = false,
}: {
  src?: string | null;
  alt: string;
  fallbackLabel?: string;
  isVideo?: boolean;
  /** Start uncropped. A wide picture still fills the frame once it has loaded. */
  preferFull?: boolean;
}) {
  const [full, setFull] = useState(preferFull);

  return (
    <>
      {full && src ? (
        <MediaImage
          src={src}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
        />
      ) : null}
      <MediaImage
        src={src}
        alt={alt}
        fallbackLabel={fallbackLabel}
        isVideo={isVideo}
        onLoad={(image) => {
          if (image.naturalWidth > 0) setFull(image.naturalWidth / image.naturalHeight < 1.25);
        }}
        className={
          full
            ? 'relative z-[1] h-full w-full object-contain'
            : 'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
        }
      />
    </>
  );
}
