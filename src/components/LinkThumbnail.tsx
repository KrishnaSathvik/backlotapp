'use client';

import React, { useEffect, useState } from 'react';
import { isTikTokLink, youtubeThumbnail } from '@/src/lib/link-preview';
import { fetchLinkPreview } from '@/src/lib/link-preview-client';

/**
 * The thumbnail of a YouTube or TikTok link, or `fallback` when there isn't one (other sites,
 * private videos, offline). YouTube's comes straight from the video id; TikTok's is looked up.
 */
export function LinkThumbnail({
  link,
  authToken,
  className,
  fallback,
}: {
  link: string;
  authToken: string | null;
  className?: string;
  fallback: React.ReactNode;
}) {
  const direct = youtubeThumbnail(link);
  const [looked, setLooked] = useState<{ link: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (direct || !isTikTokLink(link)) return;
    let live = true;
    fetchLinkPreview(link, authToken).then((p) => {
      if (live) setLooked({ link, url: p.thumbnailUrl });
    });
    return () => {
      live = false;
    };
  }, [link, authToken, direct]);

  const src = direct ?? (looked?.link === link ? looked.url : null);
  if (!src || failed === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, shown as-is
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} className={className} />
  );
}
