import { searchTerms } from './search.ts';
import type { IdeaRecord, PostRecord } from './types.ts';

/**
 * Creative continuity (M5.3): facts about the creator's own records. Recurring topics,
 * ideas left open, posts that haven't moved, possible series and related unfinished work.
 * Everything here comes from stored titles, tags, stages and dates; there are no views,
 * reach or engagement numbers. Suggestions are left to Slate, clearly separated.
 */

const DAY = 86_400_000;
const STAGE: Record<string, string> = { idea: 'Planned', scripting: 'Scripting', editing: 'Editing', ready: 'Ready', posted: 'Posted' };

/** Topic words for a record: its tags plus content words from the title (4+ letters, crude plural folding). */
export function topicsOf(title: string, tags: string[]): string[] {
  const fold = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const words = [...tags.map((t) => t.toLowerCase().replace(/^#/, '')), ...searchTerms(title).filter((w) => w.length >= 4)];
  return [...new Set(words.map(fold).filter((w) => w.length >= 3 && !/^\d+$/.test(w)))];
}

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()) / DAY);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s);

export interface ContinuityOptions {
  today: string;
  /** Open ideas older than this many days count as long-open. */
  ideaOpenDays?: number;
  /** Unposted posts not updated for this many days count as stalled. */
  stalledDays?: number;
}

export function buildContinuity(posts: PostRecord[], ideas: IdeaRecord[], opts: ContinuityOptions) {
  const ideaOpenDays = opts.ideaOpenDays ?? 30;
  const stalledDays = opts.stalledDays ?? 21;
  const pRef = (p: PostRecord) => ({ ref: `post:${p.id}`, title: p.title, stage: STAGE[p.status] ?? p.status });
  const iRef = (i: IdeaRecord) => ({ ref: `idea:${i.id}`, title: i.title });

  // Topic → records.
  const topics = new Map<string, { posts: PostRecord[]; ideas: IdeaRecord[] }>();
  for (const p of posts) for (const t of topicsOf(p.title, p.tags)) (topics.get(t) ?? topics.set(t, { posts: [], ideas: [] }).get(t)!).posts.push(p);
  for (const i of ideas) for (const t of topicsOf(i.title, i.tags)) (topics.get(t) ?? topics.set(t, { posts: [], ideas: [] }).get(t)!).ideas.push(i);

  const recurring = [...topics.entries()]
    .filter(([, v]) => v.posts.length + v.ideas.length >= 3)
    .sort((a, b) => b[1].posts.length + b[1].ideas.length - (a[1].posts.length + a[1].ideas.length) || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([topic, v]) => {
      const posted = v.posts.filter((p) => p.status === 'posted' && isDate(p.postDate)).sort((a, b) => a.postDate.localeCompare(b.postDate));
      return {
        topic,
        posted: posted.length,
        in_progress: v.posts.filter((p) => p.status !== 'posted').length,
        open_ideas: v.ideas.filter((i) => !i.convertedItemId).length,
        ...(posted.length ? { first_posted: posted[0].postDate, last_posted: posted[posted.length - 1].postDate } : {}),
        examples: [...v.posts.slice(0, 4).map(pRef), ...v.ideas.slice(0, 2).map(iRef)],
      };
    });

  // Series: a topic posted 3+ times, with the actual gaps between posts.
  const series = recurring
    .filter((r) => r.posted >= 3)
    .map((r) => {
      const dates = topics
        .get(r.topic)!
        .posts.filter((p) => p.status === 'posted' && isDate(p.postDate))
        .map((p) => p.postDate)
        .sort();
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
      return { topic: r.topic, posted: r.posted, average_gap_days: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, days_since_last: daysBetween(dates[dates.length - 1], opts.today) };
    });

  const longOpen = ideas
    .filter((i) => !i.convertedItemId && daysBetween(i.createdAt, opts.today) >= ideaOpenDays)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 10)
    .map((i) => ({ ...iRef(i), saved: i.createdAt.slice(0, 10), days_open: daysBetween(i.createdAt, opts.today) }));

  const stalled = posts
    .filter((p) => p.status !== 'posted' && daysBetween(p.updatedAt, opts.today) >= stalledDays)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(0, 10)
    .map((p) => ({ ...pRef(p), last_changed: p.updatedAt.slice(0, 10), days_unchanged: daysBetween(p.updatedAt, opts.today), target: p.targetDate || null }));

  // Unfinished work that shares a topic with something already posted.
  const related: { topic: string; posted_example: ReturnType<typeof pRef>; unfinished: (ReturnType<typeof pRef> | ReturnType<typeof iRef>)[] }[] = [];
  for (const [topic, v] of topics) {
    const done = v.posts.find((p) => p.status === 'posted');
    const unfinished = [...v.posts.filter((p) => p.status !== 'posted').map(pRef), ...v.ideas.filter((i) => !i.convertedItemId).map(iRef)];
    if (done && unfinished.length) related.push({ topic, posted_example: pRef(done), unfinished: unfinished.slice(0, 3) });
  }

  const refs = [
    ...recurring.flatMap((r) => r.examples.map((e) => e.ref)),
    ...longOpen.map((i) => i.ref),
    ...stalled.map((p) => p.ref),
    ...related.flatMap((r) => [r.posted_example.ref, ...r.unfinished.map((u) => u.ref)]),
  ];
  return {
    payload: {
      today: opts.today,
      based_on: { posts: posts.length, ideas: ideas.length },
      recurring_topics: recurring,
      possible_series: series,
      long_open_ideas: { older_than_days: ideaOpenDays, items: longOpen },
      stalled_posts: { unchanged_for_days: stalledDays, items: stalled },
      related_unfinished_work: related.slice(0, 6),
      note: 'Facts from stored titles, tags, stages and dates only. Topics come from tags and title words, not meaning. There are no views, reach or engagement numbers: never claim any. Label your suggestions as suggestions.',
    },
    refs: [...new Set(refs)],
  };
}
