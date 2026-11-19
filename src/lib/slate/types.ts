/**
 * Slate's server-side view of a creator's workspace.
 * Every store method takes the authenticated uid and must only return that user's rows.
 */

export type FocusType = 'post' | 'idea';

export interface SlateFocus {
  type: FocusType;
  id: number;
}

export interface ChannelRecord {
  id: number;
  name: string;
  handle: string;
}

export interface PostRecord {
  id: number;
  title: string;
  platform: string;
  channelId: number | null;
  channelName: string;
  status: string;
  caption: string;
  tags: string[];
  notes: string;
  postDate: string;
  targetDate: string;
  /** Optimistic-concurrency version (see content-mutations.ts). */
  version: number;
  updatedAt: string;
  sourceIdeaId?: number | null;
  repurposedFromPostId?: number | null;
  /** Attachment metadata only (names, types, sizes); never file contents. */
  media?: PostMedia;
}

export interface MediaInfo {
  name: string;
  type: string;
  sizeKb: number;
}

export interface PostMedia {
  cover: MediaInfo | null;
  video: MediaInfo | null;
  slides: MediaInfo[];
  references: { title: string; note: string; url: string }[];
}

export interface IdeaRecord {
  id: number;
  title: string;
  platform: string;
  channelName: string;
  notes: string;
  linkUrl: string;
  linkDomain: string;
  tags: string[];
  targetDate: string;
  convertedItemId: number | null;
  version: number;
  createdAt: string;
  hasScreenshot?: boolean;
}

export interface PostQuery {
  channel?: ChannelRecord;
  /** 'upcoming': unposted, soonest date first (undated last). 'recent': most recently updated first. */
  order: 'upcoming' | 'recent';
  limit: number;
  excludeId?: number;
}

export interface IdeaQuery {
  channel?: ChannelRecord;
  openOnly: boolean;
  limit: number;
}

export interface PostSearch {
  /** Lower-cased keywords (1-6), already split and de-duplicated. */
  terms: string[];
  channel?: ChannelRecord;
  status?: string;
  platform?: string;
  limit: number;
}

export interface IdeaSearch {
  terms: string[];
  channel?: ChannelRecord;
  /** true: only ideas already turned into posts; false: only open ideas; undefined: both. */
  converted?: boolean;
  limit: number;
}

export interface PreferenceRow {
  id: number;
  channelId: number | null;
  key: string;
  value: string;
  source: string;
  updatedAt: string;
}

/** Read-only data access for Slate. Implementations must filter every query by uid. */
export interface SlateStore {
  getPost(uid: string, id: number): Promise<PostRecord | null>;
  getIdea(uid: string, id: number): Promise<IdeaRecord | null>;
  getChannel(uid: string, id: number): Promise<ChannelRecord | null>;
  listChannels(uid: string): Promise<ChannelRecord[]>;
  listPosts(uid: string, query: PostQuery): Promise<PostRecord[]>;
  listIdeas(uid: string, query: IdeaQuery): Promise<IdeaRecord[]>;
  countPostsByStatus(uid: string, channel?: ChannelRecord): Promise<Record<string, number>>;
  /** Keyword search, best matches first (title weighs most), then most recently updated. */
  searchPosts(uid: string, query: PostSearch): Promise<PostRecord[]>;
  searchIdeas(uid: string, query: IdeaSearch): Promise<IdeaRecord[]>;
  /** Number of posts per channel id. */
  channelPostCounts(uid: string, channels: ChannelRecord[]): Promise<Map<number, number>>;
  listPreferences(uid: string): Promise<PreferenceRow[]>;
  /** For continuity analysis: up to 500 posts and 300 ideas, newest first. */
  snapshot(uid: string, query: { channel?: ChannelRecord }): Promise<{ posts: PostRecord[]; ideas: IdeaRecord[] }>;
  /** Distinct words (3+ letters) from the creator's posts and ideas, for typo correction (max 5000). */
  vocabulary(uid: string): Promise<string[]>;
  /** For planning: every unposted post, plus posts published on or after `postedSince` (max 300). */
  calendarPosts(uid: string, query: { channel?: ChannelRecord; postedSince: string }): Promise<PostRecord[]>;
}
