import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/src/lib/auth-server.ts';
import { badRequest } from '@/src/lib/api-utils.ts';
import { isTikTokLink, oembedUrl, youtubeThumbnail, type LinkPreview } from '@/src/lib/link-preview.ts';

/**
 * GET /api/link-preview?url=… → { title, thumbnailUrl } for a YouTube or TikTok link.
 *
 * Signed-in only. The server only ever calls YouTube's or TikTok's own oEmbed endpoint with the
 * link as a parameter; it never fetches the link itself, so this can't be used to reach other
 * hosts. Failures (private or deleted videos, timeouts) return nulls, never an error.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  const link = request.nextUrl.searchParams.get('url') ?? '';
  if (link.length > 2048) return badRequest('Link is too long.');
  const endpoint = oembedUrl(link);
  if (!endpoint) return NextResponse.json({ title: null, thumbnailUrl: null } satisfies LinkPreview);

  let title: string | null = null;
  let thumbnailUrl: string | null = youtubeThumbnail(link);
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = (await res.json()) as { title?: unknown; thumbnail_url?: unknown };
      if (typeof data.title === 'string' && data.title.trim()) title = data.title.trim().slice(0, 300);
      if (!thumbnailUrl && isTikTokLink(link) && typeof data.thumbnail_url === 'string' && /^https:\/\//.test(data.thumbnail_url)) {
        thumbnailUrl = data.thumbnail_url;
      }
    }
  } catch {
    // Timeout or network error: no title. The YouTube thumbnail still works.
  }
  return NextResponse.json({ title, thumbnailUrl } satisfies LinkPreview, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  });
}
