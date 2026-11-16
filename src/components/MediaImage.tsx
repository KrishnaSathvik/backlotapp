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
}

export const MediaImage: React.FC<MediaImageProps> = ({
  src,
  alt,
  className = 'h-full w-full object-cover',
  fallbackLabel,
  isVideo = false,
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
      onError={() => setFailedSrc(src ?? null)}
      className={className}
    />
  );
};
