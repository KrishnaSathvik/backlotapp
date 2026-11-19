import { PUBLIC_PAGES, SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from '@/src/lib/site';
import { formatLimit, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@/src/lib/upload-limits';

/**
 * /llms.txt (https://llmstxt.org): a plain-Markdown summary of Backlot for AI tools and search
 * systems that choose to read it. It's optional and not a ranking signal. Every statement
 * describes implemented behavior; keep it in sync with the public pages.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const link = (path: string) => absoluteUrl(path) ?? path;
  const page = (path: (typeof PUBLIC_PAGES)[number]['path'], note: string) =>
    `- [${PUBLIC_PAGES.find((p) => p.path === path)!.name}](${link(path)}): ${note}`;

  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

Backlot is a web app (installable as a progressive web app on phones and desktops) for solo creators and small studios who make their own content. Sign-in is with a Google account. A demo with sample data runs entirely in the browser without signing in.

## What it does

- **Library:** one card per post for YouTube videos, YouTube Shorts, Instagram Reels, TikTok and Instagram posts (plus "Other"). Each post holds a cover, video, carousel slides, title, caption, hashtags, notes, references, a target date, its stage and the live link once posted. Filter by platform, channel or stage.
- **Ideas:** save links, screenshots and notes, then turn an idea into a post.
- **Stages and calendar:** move posts from idea to posted; a month calendar shows target and posted dates.
- **Channels:** group posts by the accounts a creator runs.
- **Post details:** copy the caption or hashtags in one tap; download a post's files individually or as a .zip.
- **Slate (AI creative partner, signed-in only):** answers from the creator's own saved posts, ideas, channels and preferences. Helps with hooks, caption rewrites, hashtag sets, weekly plans and adapting one post into drafts for up to five platforms. It suggests changes as cards the creator applies or dismisses; it never edits the workspace on its own. It can look at one image the creator picks per message, never videos.

## Limits and what it doesn't do

- Backlot doesn't connect to social platforms, import from them or publish/schedule posts on them. Marking a post "Posted" only updates Backlot.
- Slate doesn't browse the web and only sees the signed-in creator's own workspace. It has daily message and image limits, and its suggestions can be wrong.
- Uploads: images (JPEG, PNG, WebP, GIF, AVIF, HEIC) up to ${formatLimit(MAX_IMAGE_BYTES)}, videos (MP4, MOV, WebM, M4V, MKV) up to ${formatLimit(MAX_VIDEO_BYTES)}, within a per-account storage quota.
- Each workspace belongs to one account; there's no team sharing.

## Privacy

- Workspaces and uploaded files are private to the account that created them. No advertising, no analytics or tracking scripts, no sale of data.
- Slate requests are processed by OpenAI, with Anthropic as a fallback when OpenAI is unavailable. Search by meaning uses OpenAI embeddings. Google AI models aren't used for Slate.
- Creators can delete their account in Settings; deletion usually completes within 15 minutes.

## Pages

${page('/', 'overview, features, who it is for and FAQ')}
${page('/slate', 'what Slate does, what it sees, its limits and providers')}
${page('/support', 'getting started, supported platforms, file limits, installing, account deletion and contact')}
${page('/privacy', 'what is stored, AI processing, retention, deletion and backups')}
${page('/terms', 'terms of use')}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
