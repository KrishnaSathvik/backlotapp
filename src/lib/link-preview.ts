/**
 * Link previews for saved ideas (YouTube and TikTok). Pure helpers, shared by the browser and the
 * /api/link-preview route.
 *
 * - YouTube: the thumbnail address is built from the video id (no request needed); the title comes
 *   from YouTube's public oEmbed endpoint.
 * - TikTok: title and thumbnail come from TikTok's public oEmbed endpoint. Its thumbnail links
 *   expire, so they're fetched when shown, never stored.
 * - Instagram and other sites: no preview (Instagram's oEmbed needs a Meta developer app).
 */

const YT_ID = /^[\w-]{11}$/;

function parse(raw: string): URL | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The 11-character video id of a YouTube watch, Shorts, live, embed or youtu.be link. */
export function youtubeId(raw: string): string | null {
  const url = parse(raw);
  if (!url) return null;
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(shorts|live|embed|v)\/([^/?#]+)/);
      id = m ? m[2] : null;
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** A TikTok video link (www, m, vm or vt short links). */
export function isTikTokLink(raw: string): boolean {
  const url = parse(raw);
  return !!url && /(^|\.)tiktok\.com$/.test(url.hostname);
}

/** YouTube thumbnail address for a link, or null. 480×360, always available for public videos. */
export function youtubeThumbnail(raw: string): string | null {
  const id = youtubeId(raw);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** Whether Backlot can look up a title (and, for TikTok, a thumbnail) for this link. */
export function hasLinkPreview(raw: string): boolean {
  return !!youtubeId(raw) || isTikTokLink(raw);
}

/** The oEmbed request for a link: only YouTube's and TikTok's fixed endpoints, never the link itself. */
export function oembedUrl(raw: string): string | null {
  const id = youtubeId(raw);
  if (id) return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
  const url = parse(raw);
  if (url && isTikTokLink(raw)) return `https://www.tiktok.com/oembed?url=${encodeURIComponent(url.toString())}`;
  return null;
}

export interface LinkPreview {
  title: string | null;
  thumbnailUrl: string | null;
}
