import { getPlatformLabel, normalizeStatus, type PlatformKey } from '../content-logic.ts';
import { PREFERENCE_SPECS, type EffectivePreference } from './preferences.ts';
import type { ChannelRecord, IdeaRecord, PostRecord } from './types.ts';

/**
 * Formats retrieved workspace records into one bounded, clearly delimited data block.
 * Everything inside the block is creator-written data and must be treated as untrusted.
 */

export const CONTEXT_OPEN = '<workspace-data>';
export const CONTEXT_CLOSE = '</workspace-data>';
export const CONTEXT_CHAR_BUDGET = 12_000;

const STATUS_LABELS: Record<string, string> = {
  idea: 'Planned',
  ready: 'Made',
  posted: 'Posted',
};

/** Strips control characters and anything that could close or reopen the data block. */
export function sanitize(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/<\/?\s*(workspace-data|conversation-notes|transcript)\s*>/gi, '[removed tag]')
    .trim();
}

function clip(text: string, max: number): string {
  const clean = sanitize(text).replace(/\s+/g, ' ');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const platform = (p: string) => getPlatformLabel(p as PlatformKey) || p;
const stage = (s: string) => STATUS_LABELS[normalizeStatus(s)] ?? s;
const quote = (text: string, max: number) => `"${clip(text, max)}"`;

function postDates(p: PostRecord): string {
  if (p.postDate) return `posted ${p.postDate}`;
  if (p.targetDate) return `target ${p.targetDate}`;
  return 'no date';
}

export function describeFocusPost(p: PostRecord): string {
  return [
    `Focused post (id ${p.id}):`,
    `  title: ${quote(p.title, 300)}`,
    `  platform: ${platform(p.platform)} · channel: ${p.channelName ? quote(p.channelName, 80) : 'none'} · stage: ${stage(p.status)} · ${postDates(p)}`,
    `  caption: ${p.caption ? quote(p.caption, 3000) : '(empty)'}`,
    `  tags: ${p.tags.length ? p.tags.slice(0, 30).map((t) => `#${clip(t, 40)}`).join(' ') : '(none)'}`,
    `  notes: ${p.notes ? quote(p.notes, 1500) : '(none)'}`,
  ].join('\n');
}

export function describeFocusIdea(i: IdeaRecord): string {
  return [
    `Focused idea (id ${i.id}):`,
    `  title: ${quote(i.title, 300)}`,
    `  platform: ${platform(i.platform)} · channel: ${i.channelName ? quote(i.channelName, 80) : 'none'} · ${i.targetDate ? `target ${i.targetDate}` : 'no date'}${i.convertedItemId ? ' · already turned into a post' : ''}`,
    `  reference link: ${i.linkUrl ? clip(i.linkUrl, 300) : '(none)'}`,
    `  notes: ${i.notes ? quote(i.notes, 1500) : '(none)'}`,
    `  tags: ${i.tags.length ? i.tags.slice(0, 30).map((t) => `#${clip(t, 40)}`).join(' ') : '(none)'}`,
  ].join('\n');
}

export function describePostLine(p: PostRecord, withCaption: boolean): string {
  const meta = [platform(p.platform), p.channelName ? clip(p.channelName, 60) : '', stage(p.status), postDates(p)].filter(Boolean).join(' · ');
  const caption = withCaption && p.caption ? ` · caption: ${quote(p.caption, 280)}` : '';
  return `- [post ${p.id}] ${quote(p.title, 160)} (${meta})${caption}`;
}

export function describeIdeaLine(i: IdeaRecord): string {
  const meta = [platform(i.platform), i.channelName ? clip(i.channelName, 60) : '', i.targetDate ? `target ${i.targetDate}` : ''].filter(Boolean).join(' · ');
  const notes = i.notes ? ` · notes: ${quote(i.notes, 200)}` : '';
  return `- [idea ${i.id}] ${quote(i.title, 160)} (${meta})${notes}`;
}

export interface ContextParts {
  today: string;
  channels: ChannelRecord[];
  scope: ChannelRecord | null;
  counts: Record<string, number> | null;
  focusPost: PostRecord | null;
  focusIdea: IdeaRecord | null;
  /** Section title → records, in the order they should appear. */
  posts: { title: string; records: PostRecord[]; withCaption: boolean } | null;
  ideas: { title: string; records: IdeaRecord[] } | null;
  /** Saved creator preferences that apply here (already resolved global vs channel). */
  preferences?: EffectivePreference[];
  /** The channel the preferences were resolved for, if any. */
  preferencesChannel?: ChannelRecord | null;
}

/**
 * Builds the data block. Lists are added line by line until the character budget
 * is reached; anything left over is summarized as "N more not shown".
 */
export function buildContextBlock(parts: ContextParts, budget = CONTEXT_CHAR_BUDGET): string {
  const head: string[] = [`Today: ${parts.today}`];
  head.push(
    parts.channels.length
      ? `Channels: ${parts.channels.map((c) => `${quote(c.name, 60)} (channel_id ${c.id}${c.handle ? `, ${clip(c.handle, 40)}` : ''})`).join(', ')}`
      : 'Channels: none yet'
  );
  if (parts.scope) head.push(`Scope: only the channel ${quote(parts.scope.name, 60)}. Ignore other channels.`);
  if (parts.counts) {
    const total = Object.values(parts.counts).reduce((a, b) => a + b, 0);
    const planned = (parts.counts.idea ?? 0) + (parts.counts.scripting ?? 0) + (parts.counts.editing ?? 0);
    const byStage = `Planned ${planned} · Made ${parts.counts.ready ?? 0} · Posted ${parts.counts.posted ?? 0}`;
    head.push(`Posts: ${total} total (${byStage})`);
  }
  if (parts.focusPost) head.push('', describeFocusPost(parts.focusPost));
  if (parts.focusIdea) head.push('', describeFocusIdea(parts.focusIdea));
  if (parts.preferences) {
    const where = parts.preferencesChannel ? `for ${quote(parts.preferencesChannel.name, 60)}` : 'for all channels';
    head.push(
      '',
      parts.preferences.length
        ? `Creator's saved preferences ${where} (set by the creator; follow them unless asked otherwise):\n${parts.preferences
            .map((p) => `- ${PREFERENCE_SPECS[p.key].label}: ${quote(p.value, 300)}${p.scope === 'channel' ? ' (this channel)' : ''}`)
            .join('\n')}`
        : 'Creator\'s saved preferences: none yet'
    );
  }

  const out = [CONTEXT_OPEN, ...head];
  let used = out.join('\n').length + CONTEXT_CLOSE.length + 1;

  const addList = (title: string, lines: string[]) => {
    out.push('', `${title}:`);
    used += title.length + 3;
    if (!lines.length) {
      out.push('- none found');
      used += 13;
      return;
    }
    let shown = 0;
    for (const line of lines) {
      if (used + line.length + 1 > budget) break;
      out.push(line);
      used += line.length + 1;
      shown += 1;
    }
    if (shown < lines.length) {
      const more = `- …and ${lines.length - shown} more not shown`;
      out.push(more);
      used += more.length + 1;
    }
  };

  if (parts.posts) addList(parts.posts.title, parts.posts.records.map((p) => describePostLine(p, parts.posts!.withCaption)));
  if (parts.ideas) addList(parts.ideas.title, parts.ideas.records.map(describeIdeaLine));

  out.push(CONTEXT_CLOSE);
  return out.join('\n');
}
