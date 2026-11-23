'use client';

import { hasLinkPreview, type LinkPreview } from './link-preview.ts';

/** One request per link per page load, shared by every card that shows it. */
const cache = new Map<string, Promise<LinkPreview>>();

/** Title and thumbnail for a YouTube or TikTok link (signed in only). Never rejects. */
export function fetchLinkPreview(link: string, token: string | null): Promise<LinkPreview> {
  const none: LinkPreview = { title: null, thumbnailUrl: null };
  if (!token || !hasLinkPreview(link)) return Promise.resolve(none);
  let p = cache.get(link);
  if (!p) {
    p = fetch(`/api/link-preview?url=${encodeURIComponent(link)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<LinkPreview>) : none))
      .catch(() => none);
    cache.set(link, p);
  }
  return p;
}
