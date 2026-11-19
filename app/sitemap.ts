import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, absoluteUrl } from '@/src/lib/site';

export const dynamic = 'force-dynamic';

/** Indexable public pages only. Empty until SITE_URL is set, since entries must be absolute. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.flatMap((p) => {
    const url = absoluteUrl(p.path);
    return url ? [{ url, lastModified: p.updated }] : [];
  });
}
