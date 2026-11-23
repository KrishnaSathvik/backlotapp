import type { ChannelRecord, IdeaRecord, IdeaSearch, PostRecord, PostSearch, PreferenceRow, SlateStore } from './types.ts';

/** In-memory SlateStore with the same ownership rules as the Postgres store. Tests only. */

export const ALICE = 'uid-alice';
export const BOB = 'uid-bob';

interface Owned<T> {
  uid: string;
  row: T;
}

export function post(id: number, over: Partial<PostRecord> = {}): PostRecord {
  return {
    id,
    title: `Post ${id}`,
    platform: 'youtube_long',
    channelId: null,
    channelName: '',
    status: 'editing',
    caption: '',
    tags: [],
    notes: '',
    postDate: '',
    targetDate: '',
    version: 1,
    updatedAt: `2026-11-${String(10 + (id % 18)).padStart(2, '0')}T10:00:00.000Z`,
    ...over,
  };
}

export function idea(id: number, over: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    id,
    title: `Idea ${id}`,
    platform: 'instagram_reel',
    channelName: '',
    notes: '',
    linkUrl: '',
    linkDomain: '',
    tags: [],
    targetDate: '',
    convertedItemId: null,
    version: 1,
    createdAt: `2026-11-${String(1 + (id % 20)).padStart(2, '0')}T10:00:00.000Z`,
    ...over,
  };
}

export class MemoryStore implements SlateStore {
  posts: Owned<PostRecord>[] = [];
  ideas: Owned<IdeaRecord>[] = [];
  channels: Owned<ChannelRecord>[] = [];
  preferences: Owned<PreferenceRow>[] = [];
  /** Every call, for asserting what was (and wasn't) fetched. */
  calls: string[] = [];

  addPost(uid: string, p: PostRecord) {
    this.posts.push({ uid, row: p });
    return this;
  }
  addIdea(uid: string, i: IdeaRecord) {
    this.ideas.push({ uid, row: i });
    return this;
  }
  addChannel(uid: string, c: ChannelRecord) {
    this.channels.push({ uid, row: c });
    return this;
  }
  addPreference(uid: string, p: Omit<PreferenceRow, 'id' | 'source' | 'updatedAt'> & Partial<PreferenceRow>) {
    this.preferences.push({ uid, row: { id: this.preferences.length + 1, source: 'user', updatedAt: '2026-11-17T00:00:00.000Z', ...p } });
    return this;
  }

  private inChannel(p: PostRecord, c?: ChannelRecord) {
    return !c || p.channelId === c.id || (p.channelId === null && p.channelName === c.name);
  }

  async getPost(uid: string, id: number) {
    this.calls.push('getPost');
    return this.posts.find((p) => p.uid === uid && p.row.id === id)?.row ?? null;
  }
  async getIdea(uid: string, id: number) {
    this.calls.push('getIdea');
    return this.ideas.find((p) => p.uid === uid && p.row.id === id)?.row ?? null;
  }
  async getChannel(uid: string, id: number) {
    this.calls.push('getChannel');
    return this.channels.find((c) => c.uid === uid && c.row.id === id)?.row ?? null;
  }
  async listChannels(uid: string) {
    this.calls.push('listChannels');
    return this.channels.filter((c) => c.uid === uid).map((c) => c.row).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  }
  async listPosts(uid: string, q: Parameters<SlateStore['listPosts']>[1]) {
    this.calls.push(`listPosts:${q.order}`);
    let rows = this.posts.filter((p) => p.uid === uid && this.inChannel(p.row, q.channel) && p.row.id !== q.excludeId).map((p) => p.row);
    if (q.order === 'upcoming') {
      rows = rows
        .filter((p) => p.status !== 'posted')
        .sort((a, b) => Number(!a.targetDate) - Number(!b.targetDate) || a.targetDate.localeCompare(b.targetDate) || a.id - b.id);
    } else {
      rows = rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
    }
    return rows.slice(0, q.limit);
  }
  async snapshot(uid: string, q: { channel?: ChannelRecord }) {
    this.calls.push('snapshot');
    return {
      posts: this.posts.filter((p) => p.uid === uid && this.inChannel(p.row, q.channel)).map((p) => p.row),
      ideas: this.ideas.filter((i) => i.uid === uid && (!q.channel || i.row.channelName === q.channel.name)).map((i) => i.row),
    };
  }
  async vocabulary(uid: string) {
    const text = [...this.posts.filter((p) => p.uid === uid).map((p) => `${p.row.title} ${p.row.tags.join(' ')} ${p.row.caption} ${p.row.notes}`), ...this.ideas.filter((i) => i.uid === uid).map((i) => `${i.row.title} ${i.row.tags.join(' ')} ${i.row.notes}`)].join(' ');
    return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))];
  }
  async calendarPosts(uid: string, q: Parameters<SlateStore['calendarPosts']>[1]) {
    this.calls.push('calendarPosts');
    return this.posts
      .filter((p) => p.uid === uid && this.inChannel(p.row, q.channel) && (p.row.status !== 'posted' || (!!p.row.postDate && p.row.postDate >= q.postedSince)))
      .map((p) => p.row)
      .sort((a, b) => a.id - b.id)
      .slice(0, 300);
  }
  async listIdeas(uid: string, q: Parameters<SlateStore['listIdeas']>[1]) {
    this.calls.push('listIdeas');
    return this.ideas
      .filter((i) => i.uid === uid && (!q.channel || i.row.channelName === q.channel.name) && (!q.openOnly || i.row.convertedItemId === null))
      .map((i) => i.row)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      .slice(0, q.limit);
  }
  async countPostsByStatus(uid: string, c?: ChannelRecord) {
    this.calls.push('countPostsByStatus');
    const out: Record<string, number> = {};
    for (const p of this.posts) if (p.uid === uid && this.inChannel(p.row, c)) out[p.row.status] = (out[p.row.status] ?? 0) + 1;
    return out;
  }

  /** Same weighting as the SQL store: title 3, tags 2, caption/notes/channel 1. */
  private score(terms: string[], fields: [string, number][]) {
    return terms.reduce((sum, t) => sum + fields.reduce((s, [text, w]) => s + (text.toLowerCase().includes(t) ? w : 0), 0), 0);
  }

  async searchPosts(uid: string, q: PostSearch) {
    this.calls.push('searchPosts');
    return this.posts
      .filter((p) => p.uid === uid && this.inChannel(p.row, q.channel) && (!q.status || p.row.status === q.status || (q.status === 'idea' && (p.row.status === 'scripting' || p.row.status === 'editing'))) && (!q.platform || p.row.platform === q.platform))
      .map((p) => ({ row: p.row, s: this.score(q.terms, [[p.row.title, 3], [JSON.stringify(p.row.tags), 2], [p.row.caption, 1], [p.row.notes, 1], [p.row.channelName, 1]]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.row.updatedAt.localeCompare(a.row.updatedAt) || b.row.id - a.row.id)
      .slice(0, q.limit)
      .map((x) => x.row);
  }

  async searchIdeas(uid: string, q: IdeaSearch) {
    this.calls.push('searchIdeas');
    return this.ideas
      .filter(
        (i) =>
          i.uid === uid &&
          (!q.channel || i.row.channelName === q.channel.name) &&
          (q.converted === undefined || (q.converted ? i.row.convertedItemId !== null : i.row.convertedItemId === null))
      )
      .map((i) => ({ row: i.row, s: this.score(q.terms, [[i.row.title, 3], [JSON.stringify(i.row.tags), 2], [i.row.notes, 1], [i.row.linkDomain, 1], [i.row.channelName, 1]]) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.row.createdAt.localeCompare(a.row.createdAt) || b.row.id - a.row.id)
      .slice(0, q.limit)
      .map((x) => x.row);
  }

  async channelPostCounts(uid: string, list: ChannelRecord[]) {
    this.calls.push('channelPostCounts');
    return new Map(list.map((c) => [c.id, this.posts.filter((p) => p.uid === uid && this.inChannel(p.row, c)).length]));
  }

  async listPreferences(uid: string) {
    this.calls.push('listPreferences');
    return this.preferences.filter((p) => p.uid === uid).map((p) => p.row);
  }
}
