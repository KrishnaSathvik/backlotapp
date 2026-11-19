/**
 * Public-site facts shared by metadata, robots.txt, the sitemap, JSON-LD and llms.txt (Launch L4).
 *
 * The production domain isn't recorded anywhere in this repository, so it comes from SITE_URL
 * (e.g. https://backlot.example), read at request time. When it isn't set, pages still render
 * but omit canonical URLs, og:url, the sitemap entries and JSON-LD, all of which need an
 * absolute URL. Nothing here guesses a domain.
 */

type Env = Record<string, string | undefined>;

export const SITE_NAME = 'Backlot';
export const SITE_TAGLINE = 'Every post, one backlot';
export const SITE_DESCRIPTION =
  'Backlot is a private workspace for creators to keep YouTube videos, Shorts, Reels, TikToks and Instagram posts together: covers, videos, slides, captions, hashtags and ideas, with Slate, an AI creative partner that answers from your own saved posts.';

/** Indexable public pages: path, title for breadcrumbs, and when their content last changed. */
export const PUBLIC_PAGES = [
  { path: '/', name: 'Home', updated: '2026-11-17' },
  { path: '/slate', name: 'Slate', updated: '2026-11-17' },
  { path: '/support', name: 'Help & support', updated: '2026-11-17' },
  { path: '/privacy', name: 'Privacy Policy', updated: '2026-11-17' },
  { path: '/terms', name: 'Terms of Service', updated: '2026-11-17' },
] as const;

export type PublicPath = (typeof PUBLIC_PAGES)[number]['path'];

/**
 * Paths that must never be indexed. They're kept out of search with noindex (meta tag and an
 * X-Robots-Tag header, see next.config.ts), and their data is protected by sign-in. robots.txt
 * only disallows /api/: a crawler has to be able to fetch a page to see its noindex.
 */
export const NOINDEX_PATHS = ['/app', '/login', '/account', '/api'] as const;
export const ROBOTS_DISALLOW = ['/api/'] as const;

/**
 * Model-training crawlers, by their documented user-agent tokens. robots.txt asks them not to
 * crawl by default (product decision, L4); ROBOTS_DISALLOW_AI_TRAINING=false opts back in.
 * Search crawlers, including AI search ones such as OAI-SearchBot and Claude-SearchBot, are
 * allowed either way. robots.txt is a voluntary signal; private data is protected by sign-in.
 */
export const AI_TRAINING_AGENTS = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

export function disallowAiTraining(env: Env = process.env): boolean {
  return env.ROBOTS_DISALLOW_AI_TRAINING?.trim().toLowerCase() !== 'false';
}

/** The validated site origin (no trailing slash), or null when SITE_URL is unset or invalid. */
export function siteUrl(env: Env = process.env): string | null {
  return readSiteUrl(env).url;
}

export function readSiteUrl(env: Env = process.env): { url: string | null; error?: string } {
  const raw = env.SITE_URL?.trim();
  if (!raw) return { url: null };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: null, error: 'SITE_URL is not a valid URL.' };
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    return { url: null, error: 'SITE_URL must use https://.' };
  }
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
    return { url: null, error: 'SITE_URL must be an origin only (no path, query or fragment).' };
  }
  return { url: u.origin };
}

export function absoluteUrl(path: string, env: Env = process.env): string | null {
  const base = siteUrl(env);
  return base ? `${base}${path === '/' ? '/' : path}` : null;
}

/** The contact address shown on public pages (PRIVACY_CONTACT_EMAIL). Never invented. */
export function contactEmail(env: Env = process.env): string | null {
  return env.PRIVACY_CONTACT_EMAIL?.trim() || null;
}

/** Serialize JSON-LD for a <script> tag without allowing it to close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
