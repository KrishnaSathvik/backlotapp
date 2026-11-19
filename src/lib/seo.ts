import type { Metadata } from 'next';
import { PUBLIC_PAGES, SITE_NAME, absoluteUrl, siteUrl, type PublicPath } from './site.ts';

/**
 * Per-page metadata for indexable public pages (Launch L4): title, description, canonical URL
 * and social previews. Absolute URLs are only emitted when SITE_URL is configured.
 */
export function pageMetadata({
  path,
  title,
  description,
  absoluteTitle = false,
}: {
  path: PublicPath;
  title: string;
  description: string;
  /** Use the title as-is instead of "<title> · Backlot". */
  absoluteTitle?: boolean;
}): Metadata {
  const url = absoluteUrl(path);
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  const image = siteUrl() ? [{ url: '/og.png', width: 1200, height: 630, alt: 'Backlot: every post, one backlot' }] : undefined;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      title: fullTitle,
      description,
      ...(url ? { url } : {}),
      ...(image ? { images: image } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: fullTitle,
      description,
      ...(image ? { images: ['/og.png'] } : {}),
    },
  };
}

/** Metadata for pages that must never appear in search results. */
export const NOINDEX: Metadata['robots'] = { index: false, follow: false, nocache: true };

/** BreadcrumbList JSON-LD (Home › page) for a public page, or null without SITE_URL. */
export function breadcrumbJsonLd(path: PublicPath) {
  const home = absoluteUrl('/');
  const here = absoluteUrl(path);
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!home || !here || !page || path === '/') return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE_NAME, item: home },
      { '@type': 'ListItem', position: 2, name: page.name, item: here },
    ],
  };
}
