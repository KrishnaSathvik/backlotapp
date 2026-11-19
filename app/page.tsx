import type { Metadata } from 'next';
import { Landing } from '@/src/components/site/Landing';
import { JsonLd } from '@/src/components/site/JsonLd';
import { pageMetadata } from '@/src/lib/seo';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, absoluteUrl, contactEmail } from '@/src/lib/site';

export function generateMetadata(): Metadata {
  return pageMetadata({ path: '/', title: `${SITE_NAME} — ${SITE_TAGLINE}`, description: SITE_DESCRIPTION, absoluteTitle: true });
}

/**
 * Organization, WebSite and WebApplication JSON-LD. Only implemented features are listed; there
 * is deliberately no price, rating, review, user count or platform-integration claim.
 */
function homeJsonLd() {
  const url = absoluteUrl('/');
  if (!url) return null;
  const email = contactEmail();
  const org = {
    '@type': 'Organization',
    '@id': `${url}#organization`,
    name: SITE_NAME,
    url,
    logo: absoluteUrl('/brand/backlot-mark-512.png'),
    ...(email ? { email } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      { '@type': 'WebSite', '@id': `${url}#website`, name: SITE_NAME, url, publisher: { '@id': `${url}#organization` }, inLanguage: 'en' },
      {
        '@type': 'WebApplication',
        '@id': `${url}#app`,
        name: SITE_NAME,
        url,
        description: SITE_DESCRIPTION,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any (web browser; installable as a progressive web app)',
        browserRequirements: 'Requires JavaScript and a modern web browser.',
        publisher: { '@id': `${url}#organization` },
        screenshot: absoluteUrl('/screens/desktop-library-light.jpg'),
        featureList: [
          'Library of posts for YouTube videos, YouTube Shorts, Instagram Reels, TikTok and Instagram posts',
          'Covers, videos, carousel slides, captions, hashtags, notes and live links on each post',
          'Ideas inbox for links, screenshots and notes, convertible into posts',
          'Stages from idea to posted, with channels and filters',
          'Month calendar of target and posted dates',
          'Slate, an AI creative partner that answers from your saved posts and ideas and suggests changes you approve',
        ],
      },
    ],
  };
}

export default function HomePage() {
  return (
    <>
      <JsonLd data={homeJsonLd()} />
      <Landing />
    </>
  );
}
