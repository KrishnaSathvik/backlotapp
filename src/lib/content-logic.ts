export type PlatformKey =
  | 'youtube_long'
  | 'youtube_shorts'
  | 'instagram_reel'
  | 'tiktok'
  | 'instagram_carousel'
  | 'linkedin'
  | 'facebook'
  | 'other';

export type StatusKey = 'idea' | 'scripting' | 'editing' | 'ready' | 'posted';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface MediaAsset {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  order?: number;
}

export interface ReferenceAttachment {
  id: string;
  url: string;
  title: string;
  note: string;
  screenshotUrl: string;
}

/** A post's reference screenshot or link to show when it has no cover or slides of its own. */
export function referencePreview(refs: ReferenceAttachment[]): { screenshotUrl: string; link: string } {
  return {
    screenshotUrl: refs.find((r) => r.screenshotUrl)?.screenshotUrl ?? '',
    link: refs.find((r) => /^https?:\/\//i.test(r.url))?.url ?? '',
  };
}

export interface ChannelItem {
  id: number;
  name: string;
  handle: string;
  /** Chosen when the channel is added; 'other' (or missing) for channels added before that. */
  platform?: PlatformKey;
}

export interface ContentItem {
  id: number;
  title: string;
  platform: PlatformKey;
  channelId?: number | null;
  channelName: string;
  status: StatusKey;
  caption: string;
  tags: string[];
  notes: string;
  liveLink: string;
  postDate: string;
  targetDate: string;
  coverAsset: MediaAsset | null;
  videoAsset: MediaAsset | null;
  slides: MediaAsset[];
  attachedReferences: ReferenceAttachment[];
  sourceIdeaId?: number | null;
  /** Server version for optimistic concurrency (absent in the demo). */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaItem {
  id: number;
  title: string;
  linkUrl: string;
  linkTitle: string;
  linkDomain: string;
  /** The first reference image (kept for older code paths); see `images`. */
  screenshotUrl: string;
  /** Reference images, max MAX_IDEA_IMAGES. Missing on ideas saved before images existed. */
  images?: string[];
  notes: string;
  platform: PlatformKey;
  channelName: string;
  tags: string[];
  targetDate: string;
  convertedItemId?: number | null;
  /** Server version for optimistic concurrency (absent in the demo). */
  version?: number;
  createdAt: string;
}

export const PLATFORM_OPTIONS: Array<{ key: PlatformKey; label: string; shortLabel: string }> = [
  { key: 'youtube_long', label: 'YouTube videos', shortLabel: 'YouTube' },
  { key: 'youtube_shorts', label: 'YouTube Shorts', shortLabel: 'Shorts' },
  { key: 'instagram_reel', label: 'Instagram Reels', shortLabel: 'Reels' },
  { key: 'tiktok', label: 'TikTok', shortLabel: 'TikTok' },
  { key: 'instagram_carousel', label: 'Instagram posts', shortLabel: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn', shortLabel: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook', shortLabel: 'Facebook' },
  { key: 'other', label: 'Other', shortLabel: 'Other' },
];

/** The three stages the product shows. Older stored values fold into Planned. */
export type StageKey = 'idea' | 'ready' | 'posted';

/** scripting and editing were retired. Anything else that is not Made or Posted is Planned. */
export function normalizeStatus(status: string): StageKey {
  if (status === 'ready' || status === 'posted') return status;
  return 'idea';
}

export const STATUS_OPTIONS: Array<{ key: StageKey; label: string }> = [
  { key: 'idea', label: 'Planned' },
  { key: 'ready', label: 'Made' },
  { key: 'posted', label: 'Posted' },
];

export function getPlatformLabel(platform: PlatformKey): string {
  return PLATFORM_OPTIONS.find((p) => p.key === platform)?.label ?? 'Other';
}

/**
 * A post belongs to this channel. A saved id wins, so two channels can share a name.
 * A post from before ids existed stays with the oldest channel of that name.
 */
export function postInChannel(item: Pick<ContentItem, 'channelId' | 'channelName'>, channel: ChannelItem, channels: ChannelItem[]): boolean {
  if (typeof item.channelId === 'number') return item.channelId === channel.id;
  if (!item.channelName || item.channelName.toLowerCase() !== channel.name.toLowerCase()) return false;
  return oldestNamed(channels, channel.name)?.id === channel.id;
}

/** The first channel created with this name. Name-only posts and ideas stay with it. */
function oldestNamed(channels: ChannelItem[], name: string): ChannelItem | null {
  const same = channels.filter((c) => c.name.toLowerCase() === name.toLowerCase());
  return same.reduce<ChannelItem | null>((best, c) => (best === null || c.id < best.id ? c : best), null);
}

/** An idea has no channel id, so it stays with the oldest channel of its name. */
export function ideaInChannel(idea: Pick<IdeaItem, 'channelName'>, channel: ChannelItem, channels: ChannelItem[]): boolean {
  if (!idea.channelName || idea.channelName.toLowerCase() !== channel.name.toLowerCase()) return false;
  return oldestNamed(channels, channel.name)?.id === channel.id;
}

/**
 * A channel's platform: the one saved on the channel, else the one its own posts use most
 * (channels added before platforms were saved). Null when neither is known.
 */
export function platformOfChannel(channel: ChannelItem, items: ContentItem[], channels: ChannelItem[] = [channel]): PlatformKey | null {
  if (channel.platform && channel.platform !== 'other') return channel.platform;
  return channelPlatform(items, channel, channels);
}

/** The platform a channel's own posts use most. Null if it has no posts yet. */
export function channelPlatform(items: ContentItem[], channel: ChannelItem, channels: ChannelItem[]): PlatformKey | null {
  const counts = new Map<PlatformKey, number>();
  for (const i of items) if (postInChannel(i, channel, channels)) counts.set(i.platform, (counts.get(i.platform) ?? 0) + 1);
  let best: PlatformKey | null = null;
  let max = 0;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

export function getPlatformShortLabel(platform: PlatformKey): string {
  return PLATFORM_OPTIONS.find((p) => p.key === platform)?.shortLabel ?? 'Other';
}

function copyAsset(asset: MediaAsset | null): MediaAsset | null {
  return asset ? { ...asset } : null;
}

/**
 * A new Planned post on another channel. The files are the same objects already
 * stored: the copy keeps their URLs and uploads nothing.
 */
export function postForAnotherChannel(
  item: ContentItem,
  channel: ChannelItem,
  items: ContentItem[],
  channels: ChannelItem[],
) {
  return {
    title: item.title,
    platform: platformOfChannel(channel, items, channels) ?? channel.platform ?? item.platform,
    channelName: channel.name,
    channelId: channel.id,
    status: 'idea' as const,
    caption: item.caption,
    tags: [...item.tags],
    notes: item.notes,
    liveLink: '',
    postDate: '',
    targetDate: '',
    coverAsset: copyAsset(item.coverAsset),
    videoAsset: copyAsset(item.videoAsset),
    slides: item.slides.map((slide) => ({ ...slide })),
    attachedReferences: item.attachedReferences.map((ref) => ({ ...ref })),
  };
}

export function getStatusLabel(status: string): string {
  return STATUS_OPTIONS.find((s) => s.key === normalizeStatus(status))?.label ?? 'Planned';
}

export type LibrarySort = 'updated' | 'target' | 'created';

export const SORT_OPTIONS: Array<{ key: LibrarySort; label: string }> = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'target', label: 'Target date' },
  { key: 'created', label: 'Newest first' },
];

/**
 * Returns a sorted copy. "target" puts the soonest date first (target date, or
 * post date when there is none) and undated posts last.
 */
export function sortContentItems(items: ContentItem[], sort: LibrarySort): ContentItem[] {
  const time = (v: string) => {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  };
  const copy = [...items];
  if (sort === 'target') {
    return copy.sort((a, b) => {
      const da = a.targetDate || a.postDate;
      const db = b.targetDate || b.postDate;
      if (!da && !db) return time(b.updatedAt) - time(a.updatedAt);
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }
  const key = sort === 'created' ? 'createdAt' : 'updatedAt';
  return copy.sort((a, b) => time(b[key]) - time(a[key]));
}

/** Same order as posts. Ideas have no separate edit time, so "updated" uses when they were saved. */
export function sortIdeas(items: IdeaItem[], sort: LibrarySort): IdeaItem[] {
  const time = (v: string) => {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  };
  const copy = [...items];
  if (sort === 'target') {
    return copy.sort((a, b) => {
      if (!a.targetDate && !b.targetDate) return time(b.createdAt) - time(a.createdAt);
      if (!a.targetDate) return 1;
      if (!b.targetDate) return -1;
      return a.targetDate.localeCompare(b.targetDate);
    });
  }
  return copy.sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export interface LibraryFilters {
  platform: PlatformKey | 'all';
  channel: string;
  /** A single stage, or every stage. */
  status: StageKey | 'all';
  search: string;
}

export function filterContentItems(
  items: ContentItem[],
  filters: LibraryFilters
): ContentItem[] {
  const query = filters.search.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.platform !== 'all' && item.platform !== filters.platform) {
      return false;
    }
    if (
      filters.channel &&
      filters.channel !== 'all' &&
      item.channelName.toLowerCase() !== filters.channel.toLowerCase()
    ) {
      return false;
    }
    if (filters.status !== 'all' && normalizeStatus(item.status) !== filters.status) {
      return false;
    }
    if (query) {
      const haystack = [
        item.title,
        item.caption,
        item.notes,
        item.channelName,
        ...item.tags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export function groupItemsByStatus(
  items: ContentItem[]
): Record<StatusKey, ContentItem[]> {
  const grouped: Record<StatusKey, ContentItem[]> = {
    idea: [],
    scripting: [],
    editing: [],
    ready: [],
    posted: [],
  };

  for (const item of items) {
    grouped[normalizeStatus(item.status)].push(item);
  }

  return grouped;
}

export function reorderSlides<T extends { order?: number }>(
  slides: T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= slides.length ||
    toIndex >= slides.length ||
    fromIndex === toIndex
  ) {
    return slides.map((slide, idx) => ({ ...slide, order: idx }));
  }

  const next = [...slides];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((slide, idx) => ({ ...slide, order: idx }));
}

export function parseTagsInput(raw: string): string[] {
  if (!raw.trim()) return [];
  const tokens = raw
    .split(/[,\n]+|\s+/)
    .map((token) => token.trim().replace(/^#+/, ''))
    .filter(Boolean);

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      normalized.push(token);
    }
  }
  return normalized;
}

export function formatTagsForCopy(tags: string[]): string {
  return tags
    .map((t) => t.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(' ');
}

export function extractDomainAndTitle(rawUrl: string): {
  validUrl: string;
  domain: string;
  suggestedTitle: string;
} {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { validUrl: '', domain: '', suggestedTitle: '' };
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const domain = parsed.hostname.replace(/^www\./, '');
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
    const cleanedSegment = decodeURIComponent(lastSegment)
      .replace(/[-_]+/g, ' ')
      .trim();

    let platformHint = domain;
    if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
      platformHint = parsed.pathname.includes('/shorts/')
        ? 'YouTube Short Reference'
        : 'YouTube Reference';
    } else if (domain.includes('instagram.com')) {
      platformHint = parsed.pathname.includes('/reel')
        ? 'Instagram Reel Reference'
        : 'Instagram Post Reference';
    } else if (domain.includes('linkedin.com')) {
      platformHint = 'LinkedIn Reference';
    } else if (domain.includes('facebook.com') || domain === 'fb.com') {
      platformHint = 'Facebook Reference';
    }

    // Skip path words ("watch", "reel") and video ids: they aren't titles.
    const meaningful =
      cleanedSegment.length > 3 &&
      cleanedSegment.length < 48 &&
      !/^(watch|reels?|p|tv|shorts|video|live|embed)$/i.test(cleanedSegment) &&
      !(/^[\w-]{6,}$/.test(lastSegment) && /\d/.test(lastSegment));
    const suggestedTitle = meaningful ? `${platformHint}: ${cleanedSegment}` : platformHint;

    return {
      validUrl: parsed.toString(),
      domain,
      suggestedTitle,
    };
  } catch {
    return { validUrl: trimmed, domain: '', suggestedTitle: trimmed.slice(0, 60) };
  }
}

export const MAX_IDEA_IMAGES = 6;

/** An idea's reference images; older ideas only have `screenshotUrl`. */
export function ideaImages(idea: Pick<IdeaItem, 'images' | 'screenshotUrl'>): string[] {
  if (idea.images && idea.images.length) return idea.images;
  return idea.screenshotUrl ? [idea.screenshotUrl] : [];
}

export function convertIdeaToPostDraft(idea: IdeaItem): Omit<
  ContentItem,
  'id' | 'createdAt' | 'updatedAt'
> {
  const references: ReferenceAttachment[] = [];
  const images = ideaImages(idea);
  if (idea.linkUrl || images.length || idea.notes) {
    references.push({
      id: `ref-${idea.id}-${Date.now()}`,
      url: idea.linkUrl,
      title: idea.linkTitle || idea.title,
      note: idea.notes,
      screenshotUrl: images[0] ?? '',
    });
  }
  // Every further reference image becomes its own reference on the post.
  images.slice(1).forEach((url, i) => {
    references.push({ id: `ref-${idea.id}-img${i + 2}-${Date.now()}`, url: '', title: `Reference image ${i + 2}`, note: '', screenshotUrl: url });
  });

  return {
    title: idea.title.trim() || idea.linkTitle || 'Untitled Post',
    platform: idea.platform,
    channelId: null,
    channelName: idea.channelName,
    status: 'idea',
    caption: '',
    tags: [...idea.tags],
    notes: idea.notes,
    liveLink: '',
    postDate: '',
    targetDate: idea.targetDate,
    coverAsset: null,
    videoAsset: null,
    slides: [],
    attachedReferences: references,
    sourceIdeaId: idea.id,
  };
}

const WORKFLOW: StageKey[] = ['idea', 'ready', 'posted'];

export function nextWorkflowStatus(current: string): StageKey {
  const index = WORKFLOW.indexOf(normalizeStatus(current));
  return WORKFLOW[Math.min(index + 1, WORKFLOW.length - 1)];
}

export function prevWorkflowStatus(current: string): StageKey {
  const index = WORKFLOW.indexOf(normalizeStatus(current));
  return WORKFLOW[Math.max(index - 1, 0)];
}

/**
 * Dropped files land on the post. The first video is the post video. Any video after that
 * is kept as a slide, so a second video still shows in the gallery. A single image with
 * nothing else on the post becomes the cover, and every other image is appended as a slide.
 */
export function placeUploadedAssets(
  current: { coverAsset: MediaAsset | null; videoAsset: MediaAsset | null; slides: MediaAsset[] },
  incoming: MediaAsset[]
): { coverAsset: MediaAsset | null; videoAsset: MediaAsset | null; slides: MediaAsset[] } {
  let cover = current.coverAsset;
  let video = current.videoAsset;
  const slides = current.slides.map((s, i) => ({ ...s, order: i }));
  const images = incoming.filter((a) => a.mimeType.startsWith('image/'));
  const videos = incoming.filter((a) => a.mimeType.startsWith('video/'));
  if (videos[0]) video = videos[0];
  for (const extra of videos.slice(1)) slides.push({ ...extra, order: slides.length });
  if (images.length === 1 && !cover && slides.length === 0) {
    cover = images[0];
  } else {
    for (const image of images) slides.push({ ...image, order: slides.length });
  }
  return { coverAsset: cover, videoAsset: video, slides };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}
