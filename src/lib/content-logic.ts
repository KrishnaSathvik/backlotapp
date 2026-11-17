export type PlatformKey =
  | 'youtube_long'
  | 'youtube_shorts'
  | 'instagram_reel'
  | 'tiktok'
  | 'instagram_carousel'
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

export interface ChannelItem {
  id: number;
  name: string;
  handle: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface IdeaItem {
  id: number;
  title: string;
  linkUrl: string;
  linkTitle: string;
  linkDomain: string;
  screenshotUrl: string;
  notes: string;
  platform: PlatformKey;
  channelName: string;
  tags: string[];
  targetDate: string;
  convertedItemId?: number | null;
  createdAt: string;
}

export const PLATFORM_OPTIONS: Array<{ key: PlatformKey; label: string; shortLabel: string }> = [
  { key: 'youtube_long', label: 'YouTube videos', shortLabel: 'YouTube' },
  { key: 'youtube_shorts', label: 'YouTube Shorts', shortLabel: 'Shorts' },
  { key: 'instagram_reel', label: 'Instagram Reels', shortLabel: 'Reels' },
  { key: 'tiktok', label: 'TikTok', shortLabel: 'TikTok' },
  { key: 'instagram_carousel', label: 'Instagram posts', shortLabel: 'Instagram' },
  { key: 'other', label: 'Other', shortLabel: 'Other' },
];

export const STATUS_OPTIONS: Array<{ key: StatusKey; label: string }> = [
  { key: 'idea', label: 'Idea' },
  { key: 'scripting', label: 'Scripting' },
  { key: 'editing', label: 'Editing' },
  { key: 'ready', label: 'Ready' },
  { key: 'posted', label: 'Posted' },
];

export function getPlatformLabel(platform: PlatformKey): string {
  return PLATFORM_OPTIONS.find((p) => p.key === platform)?.label ?? 'Other';
}

/** The platform a channel posts to most, for showing its logo. Null if it has no posts yet. */
export function channelPlatform(items: ContentItem[], channelName: string): PlatformKey | null {
  const counts = new Map<PlatformKey, number>();
  for (const i of items) if (i.channelName === channelName) counts.set(i.platform, (counts.get(i.platform) ?? 0) + 1);
  let best: PlatformKey | null = null;
  let max = 0;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

export function getPlatformShortLabel(platform: PlatformKey): string {
  return PLATFORM_OPTIONS.find((p) => p.key === platform)?.shortLabel ?? 'Other';
}

export function getStatusLabel(status: StatusKey): string {
  return STATUS_OPTIONS.find((s) => s.key === status)?.label ?? 'Idea';
}

export interface LibraryFilters {
  platform: PlatformKey | 'all';
  channel: string;
  /** A single stage, every stage, or 'in_progress' (scripting + editing). */
  status: StatusKey | 'all' | 'in_progress';
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
    if (filters.status === 'in_progress') {
      if (item.status !== 'scripting' && item.status !== 'editing') return false;
    } else if (filters.status !== 'all' && item.status !== filters.status) {
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
    const bucket = grouped[item.status] ?? grouped.idea;
    bucket.push(item);
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
    }

    const suggestedTitle =
      cleanedSegment && cleanedSegment.length > 3 && cleanedSegment.length < 48
        ? `${platformHint}: ${cleanedSegment}`
        : platformHint;

    return {
      validUrl: parsed.toString(),
      domain,
      suggestedTitle,
    };
  } catch {
    return { validUrl: trimmed, domain: '', suggestedTitle: trimmed.slice(0, 60) };
  }
}

export function convertIdeaToPostDraft(idea: IdeaItem): Omit<
  ContentItem,
  'id' | 'createdAt' | 'updatedAt'
> {
  const references: ReferenceAttachment[] = [];
  if (idea.linkUrl || idea.screenshotUrl || idea.notes) {
    references.push({
      id: `ref-${idea.id}-${Date.now()}`,
      url: idea.linkUrl,
      title: idea.linkTitle || idea.title,
      note: idea.notes,
      screenshotUrl: idea.screenshotUrl,
    });
  }

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

export function nextWorkflowStatus(current: StatusKey): StatusKey {
  const index = STATUS_OPTIONS.findIndex((s) => s.key === current);
  if (index === -1 || index >= STATUS_OPTIONS.length - 1) return 'posted';
  return STATUS_OPTIONS[index + 1].key;
}

export function prevWorkflowStatus(current: StatusKey): StatusKey {
  const index = STATUS_OPTIONS.findIndex((s) => s.key === current);
  if (index <= 0) return 'idea';
  return STATUS_OPTIONS[index - 1].key;
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
