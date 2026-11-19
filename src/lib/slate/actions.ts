import { getPlatformLabel, PLATFORM_OPTIONS, type PlatformKey } from '../content-logic.ts';

/**
 * Slate Creative Actions: shared types and validation (no database access).
 *
 * Lifecycle: a model tool builds an ActionDraft (validated, nothing saved) → the server
 * persists it as a pending action once the reply finishes → the creator reviews, optionally
 * edits, and approves → the executor re-validates and applies it with a version check.
 * Model output never reaches the database directly.
 */

export const ACTION_KINDS = ['post_update', 'stage_change', 'target_date', 'post_create', 'idea_convert'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type ActionStatus = 'pending' | 'applied' | 'dismissed' | 'expired' | 'conflict' | 'failed';

export const ACTION_TTL_MS = 24 * 60 * 60 * 1000;
export const ACTION_LIMITS = { perReply: 6, perBatch: 5 } as const;

export const STAGE_KEYS = ['idea', 'scripting', 'editing', 'ready', 'posted'] as const;
export const STAGE_LABEL: Record<string, string> = { idea: 'Planned', scripting: 'Scripting', editing: 'Editing', ready: 'Ready', posted: 'Posted' };
const PLATFORM_KEYS = PLATFORM_OPTIONS.map((p) => p.key);

/** Post fields Slate may propose changing. */
export const CHANGE_FIELDS = ['title', 'caption', 'tags', 'notes', 'status', 'targetDate'] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export interface PostChanges {
  title?: string;
  caption?: string;
  tags?: string[];
  notes?: string;
  status?: string;
  targetDate?: string;
}

export interface PostDraft {
  title: string;
  platform: PlatformKey;
  channelId: number | null;
  channelName: string;
  caption: string;
  tags: string[];
  notes: string;
  targetDate: string;
  /** Repurposing: the post this draft adapts (re-checked when applied). */
  repurposedFromPostId?: number | null;
  /** Repurposing an idea: keeps the idea → post link. */
  sourceIdeaId?: number | null;
}

export interface ActionTarget {
  type: 'post' | 'idea';
  id: number;
  title: string;
}

/** Built by a tool from validated arguments. Not saved until the reply completes. */
export interface ActionDraft {
  kind: ActionKind;
  /** Drafts from the same batch tool call share this key. */
  batchKey?: string;
  target: ActionTarget | null;
  baseVersion: number | null;
  changes?: PostChanges;
  before?: PostChanges;
  draft?: PostDraft;
  summary: string;
  reason: string;
}

/** What the browser sees. */
export interface ActionView {
  id: string;
  kind: ActionKind;
  status: ActionStatus;
  batchId: string | null;
  target: ActionTarget | null;
  changes?: PostChanges;
  before?: PostChanges;
  draft?: PostDraft;
  summary: string;
  reason: string;
  expiresAt: string;
  resultPostId: number | null;
  resultIdeaId: number | null;
}

/* ---------------- validation ---------------- */

export class ActionInputError extends Error {}

const LIMITS = { title: 300, caption: 5000, notes: 5000, tag: 60, tags: 30, reason: 300 } as const;

function text(v: unknown, field: string, max: number, required = false): string {
  if (typeof v !== 'string') throw new ActionInputError(`${field} must be text.`);
  const t = v.replace(/\r\n/g, '\n').trim();
  if (required && !t) throw new ActionInputError(`${field} can't be empty.`);
  if (t.length > max) throw new ActionInputError(`${field} is too long (max ${max} characters).`);
  return t;
}

export function validTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new ActionInputError('tags must be a list.');
  if (v.length > LIMITS.tags) throw new ActionInputError(`At most ${LIMITS.tags} tags.`);
  const out: string[] = [];
  for (const t of v) {
    const tag = text(t, 'A tag', LIMITS.tag).replace(/^#+/, '').trim();
    if (tag && !out.some((o) => o.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

/** '' (no date) or a real calendar date as YYYY-MM-DD. */
export function validDate(v: unknown): string {
  if (v === '' || v === null) return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ActionInputError('Dates must be YYYY-MM-DD.');
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new ActionInputError('That date doesn’t exist.');
  const year = Number(v.slice(0, 4));
  if (year < 2000 || year > 2100) throw new ActionInputError('That date is out of range.');
  return v;
}

export function validStage(v: unknown): string {
  if (typeof v !== 'string' || !(STAGE_KEYS as readonly string[]).includes(v)) throw new ActionInputError(`stage must be one of: ${STAGE_KEYS.join(', ')}.`);
  return v;
}

export function validPlatform(v: unknown): PlatformKey {
  if (typeof v !== 'string' || !PLATFORM_KEYS.includes(v as PlatformKey)) throw new ActionInputError('Unknown platform.');
  return v as PlatformKey;
}

export function validReason(v: unknown): string {
  if (v === undefined || v === null) return '';
  return text(v, 'reason', LIMITS.reason);
}

/** Validates one change field. Used for model proposals and for the creator's edits. */
export function validField(field: ChangeField, v: unknown): string | string[] {
  switch (field) {
    case 'title':
      return text(v, 'Title', LIMITS.title, true);
    case 'caption':
      return text(v, 'Caption', LIMITS.caption);
    case 'notes':
      return text(v, 'Notes', LIMITS.notes);
    case 'tags':
      return validTags(v);
    case 'status':
      return validStage(v);
    case 'targetDate':
      return validDate(v);
  }
}

/** Which fields each kind may touch. */
export const KIND_FIELDS: Record<ActionKind, readonly ChangeField[]> = {
  post_update: CHANGE_FIELDS,
  stage_change: ['status'],
  target_date: ['targetDate'],
  post_create: ['title', 'caption', 'tags', 'notes', 'targetDate'],
  idea_convert: [],
};

/**
 * The creator's edits to a pending action, re-validated server-side. Only fields the
 * action already proposes can be edited (a new post's draft fields for post_create);
 * anything else is rejected rather than ignored.
 */
export function validateEdits(kind: ActionKind, proposedFields: string[], raw: unknown): PostChanges {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ActionInputError('edits must be an object.');
  const allowed: readonly string[] = kind === 'post_create' ? KIND_FIELDS.post_create : proposedFields;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.includes(k)) throw new ActionInputError(`"${k}" can't be edited on this suggestion.`);
    out[k] = validField(k as ChangeField, v);
  }
  return out as PostChanges;
}

/* ---------------- display ---------------- */

const FIELD_LABEL: Record<ChangeField, string> = { title: 'title', caption: 'caption', tags: 'hashtags', notes: 'notes', status: 'stage', targetDate: 'target date' };

export function describeChanges(changes: PostChanges): string {
  const keys = Object.keys(changes) as ChangeField[];
  if (keys.length === 1 && keys[0] === 'status') {
    return changes.status === 'posted' ? 'Mark as Posted in Backlot' : `Move to ${STAGE_LABEL[changes.status!] ?? changes.status}`;
  }
  if (keys.length === 1 && keys[0] === 'targetDate') return changes.targetDate ? `Set target date to ${changes.targetDate}` : 'Clear the target date';
  const names = keys.map((k) => FIELD_LABEL[k]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `Update ${list}`;
}

export function kindFor(changes: PostChanges): ActionKind {
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === 'status') return 'stage_change';
  if (keys.length === 1 && keys[0] === 'targetDate') return 'target_date';
  return 'post_update';
}

/** Shown wherever a change sets the stage to Posted: Backlot only tracks it. */
export const POSTED_NOTE = 'This only updates the stage in Backlot. Nothing is published to YouTube, Instagram or TikTok.';

export const marksPosted = (changes?: PostChanges) => changes?.status === 'posted';

export const platformName = (p: string) => getPlatformLabel(p as PlatformKey) || p;

/** Values are compared as stored; a proposal that changes nothing is refused. */
export function diffAgainst(current: PostChanges, proposed: PostChanges): { changes: PostChanges; before: PostChanges } {
  const changes: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(proposed)) {
    const cur = (current as Record<string, unknown>)[k];
    if (JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null)) {
      changes[k] = v;
      before[k] = cur;
    }
  }
  return { changes: changes as PostChanges, before: before as PostChanges };
}
