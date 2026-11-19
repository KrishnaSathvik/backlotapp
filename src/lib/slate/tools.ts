import { getPlatformLabel, PLATFORM_OPTIONS, type PlatformKey } from '../content-logic.ts';
import { sanitize } from './context.ts';
import { describePreference, effectivePreferences, PREFERENCE_KEYS, PREFERENCE_SPECS, validatePreference, type PreferenceKey } from './preferences.ts';
import type { ChannelRecord, IdeaRecord, PostRecord, SlateStore } from './types.ts';
import { correctTypos, searchTerms } from './search.ts';
import { fuse, type SemanticIndex } from './semantic.ts';
import { buildContinuity } from './continuity-insights.ts';
import {
  ACTION_LIMITS,
  ActionInputError,
  describeChanges,
  diffAgainst,
  kindFor,
  validDate,
  validField,
  validPlatform,
  validReason,
  validStage,
  validTags,
  type ActionDraft,
  type ChangeField,
  type PostChanges,
} from './actions.ts';

/**
 * Slate's tools. All are read-only. The propose_* tools change nothing either: they
 * validate a suggestion and hand it back as a draft. The server stores drafts as pending
 * actions after the reply, and only the creator's approval (a separate, authenticated
 * request to the action executor) applies them.
 *
 * Security model:
 * - The user id comes from the authenticated request (ToolContext), never from the model.
 * - Arguments are validated strictly; unknown tools and unknown fields are rejected.
 * - Results are bounded (per-tool limits, short excerpts, a shared character budget)
 *   and contain only the creator's own records, referenced by stable ids.
 * - Tool execution has no write access to posts, ideas or preferences.
 */

export const STAGES = ['idea', 'scripting', 'editing', 'ready', 'posted'] as const;
const STAGE_LABELS: Record<string, string> = { idea: 'Planned', scripting: 'Scripting', editing: 'Editing', ready: 'Ready', posted: 'Posted' };
const PLATFORMS = PLATFORM_OPTIONS.map((p) => p.key);

/** Caps shared by one request. */
export const TOOL_LIMITS = {
  maxRounds: 6,
  maxCallsPerRound: 6,
  maxResultChars: 6_000,
  totalResultChars: 24_000,
} as const;

export interface JsonSchema {
  [key: string]: unknown;
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

/** A reference to the creator's post or idea. `missing`: deleted since the reply was written. */
export type EntityRef = { type: 'post' | 'idea'; id: number; title: string; missing?: boolean };

export interface PreferenceProposal {
  key: PreferenceKey;
  value: string;
  channelId: number | null;
  channelName: string | null;
  label: string;
}

export interface ToolContext {
  uid: string;
  store: SlateStore;
  today: string;
  /** Characters of tool output left for this request (shared across calls). */
  budget: { chars: number };
  /** Meaning-based search, when available (OpenAI embeddings). Text search is used otherwise. */
  semantic?: SemanticIndex;
}

export interface ToolOutcome {
  /** JSON text returned to the model. */
  output: string;
  refs: EntityRef[];
  proposal?: PreferenceProposal;
  /** Suggested changes for the creator to review (nothing is applied). */
  actions?: ActionDraft[];
  /** Short status for the creator, e.g. "Searching your posts". */
  label: string;
  ok: boolean;
}

/* ------------------------------------------------------------------ */
/* Definitions                                                         */
/* ------------------------------------------------------------------ */

const DATA_NOTE = 'Only searches this creator’s own Backlot. Backlot has no views, likes, followers, trends or other platform analytics.';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_posts',
    description: `Search the creator's saved posts (title, tags, caption, notes) by words, with stemming and typo correction, plus meaning-based matches when available (the result's "match" field says which were used). ${DATA_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for, e.g. "tokyo night walk".', minLength: 1, maxLength: 120 },
        channel_id: { type: 'integer', description: 'Only this channel (id from list_channels or the data block).' },
        stage: { type: 'string', enum: [...STAGES], description: 'Only posts in this stage. "idea" means Planned.' },
        platform: { type: 'string', enum: PLATFORMS },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results (default 5).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_ideas',
    description: `Search the creator's saved ideas (title, notes, tags, reference link) by words, with stemming and typo correction, plus meaning-based matches when available. status "open" = not yet turned into a post. ${DATA_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for. Use "*" to list ideas without filtering by keyword.', minLength: 1, maxLength: 120 },
        channel_id: { type: 'integer' },
        status: { type: 'string', enum: ['open', 'converted', 'any'], description: 'Default "any".' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_post_details',
    description: 'Full details of one of the creator’s posts by id: caption, tags, notes, stage and dates.',
    parameters: {
      type: 'object',
      properties: { post_id: { type: 'integer', description: 'A post id from search results or the data block.' } },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_channels',
    description: 'The creator’s channels with ids, handles and how many posts each has.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_upcoming_content',
    description: 'Unposted work (Planned, Scripting, Editing, Ready), soonest target date first, with real stored dates. Undated items come last.',
    parameters: {
      type: 'object',
      properties: {
        channel_id: { type: 'integer' },
        within_days: { type: 'integer', minimum: 1, maximum: 120, description: 'Only items with a target date within this many days from today (overdue items included).' },
        limit: { type: 'integer', minimum: 1, maximum: 15 },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_calendar',
    description:
      'Planning view from real stored dates: unposted posts scheduled per day in a date range, open days, overdue and undated work, and each channel’s recent posting rhythm (from posted dates). Use before suggesting a posting plan.',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD; default today.' },
        days: { type: 'integer', minimum: 1, maximum: 60, description: 'Length of the range (default 14).' },
        channel_id: { type: 'integer' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_creative_continuity',
    description:
      'Facts about the creator’s own body of work: recurring topics (from tags and title words), possible series with real posting gaps, ideas left open for a long time, posts that haven’t changed in weeks, and unfinished work related to things already posted. Use for "what next", series ideas or forgotten work.',
    parameters: {
      type: 'object',
      properties: { channel_id: { type: 'integer' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_creator_preferences',
    description: 'The creative preferences the creator explicitly saved (tone, caption length, emoji use, hashtags, language, audience, things to avoid). Channel values override global ones.',
    parameters: {
      type: 'object',
      properties: { channel_id: { type: 'integer', description: 'Resolve for this channel (otherwise global values).' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_preference',
    description:
      'Use ONLY when the creator explicitly asks you to remember a creative preference. This does NOT save it: the creator sees a card and decides. Never call it for preferences you merely inferred. Keys: ' +
      PREFERENCE_KEYS.map((k) => {
        const s = PREFERENCE_SPECS[k];
        return `${k} (${s.options ? s.options.join('|') : s.integer ? `${s.integer.min}-${s.integer.max}` : `text up to ${s.maxLength}`})`;
      }).join('; '),
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: [...PREFERENCE_KEYS] },
        value: { type: 'string', maxLength: 300 },
        channel_id: { type: 'integer', description: 'Only for this channel; omit for all channels.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
];

const PROPOSAL_NOTE = 'This changes NOTHING: the creator sees a preview card and decides whether to apply, edit or dismiss it. Never say it was applied or saved.';
const POST_FIELD_PROPS = {
  title: { type: 'string', maxLength: 300 },
  caption: { type: 'string', maxLength: 5000 },
  tags: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 30, description: 'Hashtags without "#". Replaces the whole list.' },
  notes: { type: 'string', maxLength: 5000 },
};
const REASON_PROP = { reason: { type: 'string', maxLength: 300, description: 'One short sentence on why, shown to the creator.' } };

export const ACTION_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'propose_post_update',
    description: `Suggest new text for one existing post: title, caption, hashtags and/or notes. Read the post first (get_post_details) and send only the fields that should change, with their full new value. ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: { post_id: { type: 'integer' }, ...POST_FIELD_PROPS, ...REASON_PROP },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_post_creation',
    description: `Suggest a new draft post (stage Planned) from the conversation. ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 300 },
        platform: { type: 'string', enum: PLATFORMS },
        channel_id: { type: 'integer' },
        caption: POST_FIELD_PROPS.caption,
        tags: POST_FIELD_PROPS.tags,
        notes: POST_FIELD_PROPS.notes,
        target_date: { type: 'string', description: 'YYYY-MM-DD, optional.' },
        ...REASON_PROP,
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_idea_conversion',
    description: `Suggest turning one saved, open idea into a post (keeps the link to the idea). ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: { idea_id: { type: 'integer' }, ...REASON_PROP },
      required: ['idea_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_stage_change',
    description: `Suggest moving a post to another stage. "idea" means Planned. Moving to "posted" only changes the label in Backlot; nothing is published. ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: { post_id: { type: 'integer' }, stage: { type: 'string', enum: [...STAGES] }, ...REASON_PROP },
      required: ['post_id', 'stage'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_target_date',
    description: `Suggest a new target date for a post (YYYY-MM-DD), or "" to clear it. ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: { post_id: { type: 'integer' }, target_date: { type: 'string' }, ...REASON_PROP },
      required: ['post_id', 'target_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_batch_updates',
    description: `Suggest changes to up to ${ACTION_LIMITS.perBatch} posts at once (e.g. reschedule a week). Each entry is reviewed and applied separately. ${PROPOSAL_NOTE}`,
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: ACTION_LIMITS.perBatch,
          items: {
            type: 'object',
            properties: { post_id: { type: 'integer' }, ...POST_FIELD_PROPS, stage: { type: 'string', enum: [...STAGES] }, target_date: { type: 'string' } },
            required: ['post_id'],
            additionalProperties: false,
          },
        },
        ...REASON_PROP,
      },
      required: ['updates'],
      additionalProperties: false,
    },
  },
];

/**
 * Platform guidance for repurposing: editable defaults, never rules. Slate weighs, in order:
 * the creator's request, saved channel preferences, the creator's existing style, then these.
 */
export const PLATFORM_GUIDE: Record<string, string> = {
  youtube_long: 'searchable title (YouTube allows up to 100 characters), a description that front-loads what the video delivers; chapters or links only if they help',
  youtube_shorts: 'a hook in the first line, a short title, a one- or two-line description',
  instagram_reel: 'a caption that opens strong; hashtags optional (Instagram allows up to 30)',
  instagram_carousel: 'a slide-by-slide outline in notes and a caption that invites swiping; Instagram captions allow up to 2,200 characters',
  tiktok: 'a conversational hook and a short caption; on-screen text ideas in notes',
  other: 'whatever the destination needs; ask if unsure',
};

const REPURPOSE_TOOL: ToolDefinition = {
  name: 'propose_repurpose',
  description:
    `Adapt one existing post or saved idea into new drafts for other platforms (1–5 drafts, one per destination). Read the source first. ` +
    `Keep the core idea and the creator's voice; change the presentation for each destination. Priorities: (1) what the creator asked for, (2) their saved channel preferences, (3) their existing writing style, (4) these platform defaults, which are suggestions, not rules: ` +
    Object.entries(PLATFORM_GUIDE).map(([k, v]) => `${k}: ${v}`).join('; ') +
    `. Don't make every draft follow the same template. ${PROPOSAL_NOTE}`,
  parameters: {
    type: 'object',
    properties: {
      source_post_id: { type: 'integer', description: 'The post to adapt (or use source_idea_id).' },
      source_idea_id: { type: 'integer', description: 'The saved idea to adapt (or use source_post_id).' },
      drafts: {
        type: 'array',
        minItems: 1,
        maxItems: ACTION_LIMITS.perBatch,
        items: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: PLATFORMS },
            channel_id: { type: 'integer' },
            title: { type: 'string', maxLength: 300 },
            caption: POST_FIELD_PROPS.caption,
            tags: POST_FIELD_PROPS.tags,
            notes: POST_FIELD_PROPS.notes,
            target_date: { type: 'string', description: 'YYYY-MM-DD, optional.' },
          },
          required: ['platform', 'title'],
          additionalProperties: false,
        },
      },
      ...REASON_PROP,
    },
    required: ['drafts'],
    additionalProperties: false,
  },
};
ACTION_TOOL_DEFINITIONS.push(REPURPOSE_TOOL);

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [...TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS];

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export class ToolArgError extends Error {}

const MAX_INT4 = 2_147_483_647;

function obj(args: unknown, allowed: string[]): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ToolArgError('Arguments must be an object.');
  for (const k of Object.keys(args)) if (!allowed.includes(k)) throw new ToolArgError(`Unknown argument "${k}".`);
  return args as Record<string, unknown>;
}

function optInt(v: unknown, name: string, min = 1, max = MAX_INT4): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new ToolArgError(`${name} must be an integer between ${min} and ${max}.`);
  return v;
}

function reqInt(v: unknown, name: string): number {
  const n = optInt(v, name);
  if (n === undefined) throw new ToolArgError(`${name} is required.`);
  return n;
}

function optEnum<T extends string>(v: unknown, name: string, values: readonly T[]): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !values.includes(v as T)) throw new ToolArgError(`${name} must be one of: ${values.join(', ')}.`);
  return v as T;
}

function reqString(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new ToolArgError(`${name} is required.`);
  if (v.length > max) throw new ToolArgError(`${name} is too long.`);
  return v.trim();
}

/** Lower-cased keywords: at most 6, 2+ characters each, de-duplicated. */
export function toTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#@'\- ]+/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[#@'-]+|['-]+$/g, ''))
    .filter((w) => w.length >= 2);
  return [...new Set(words)].slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const clip = (text: string, max: number) => {
  const t = sanitize(text).replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A short window around the first matching term, or the start of the text. */
export function excerpt(text: string, terms: string[], max = 160): string {
  const clean = sanitize(text).replace(/\s+/g, ' ');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 40);
  const piece = clean.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${piece}${start + max < clean.length ? '…' : ''}`;
}

const platformLabel = (p: string) => getPlatformLabel(p as PlatformKey) || p;
const dateOf = (p: PostRecord) => (p.postDate ? { posted: p.postDate } : p.targetDate ? { target: p.targetDate } : { date: 'none' });

function postSummary(p: PostRecord, terms: string[] = []) {
  const text = [p.caption, p.notes].filter(Boolean).join(' · ');
  return {
    ref: `post:${p.id}`,
    title: clip(p.title, 160),
    platform: platformLabel(p.platform),
    channel: p.channelName || null,
    stage: STAGE_LABELS[p.status] ?? p.status,
    ...dateOf(p),
    excerpt: excerpt(text, terms),
  };
}

function ideaSummary(i: IdeaRecord, terms: string[] = []) {
  return {
    ref: `idea:${i.id}`,
    title: clip(i.title, 160),
    platform: platformLabel(i.platform),
    channel: i.channelName || null,
    status: i.convertedItemId ? 'turned into a post' : 'open',
    ...(i.convertedItemId ? { post_ref: `post:${i.convertedItemId}` } : {}),
    target: i.targetDate || null,
    link_domain: i.linkDomain || null,
    excerpt: excerpt(i.notes, terms),
  };
}

/** File names, types and sizes only. Slate sees an image only when the creator picks it in the chat. */
function mediaSummary(m: NonNullable<PostRecord['media']>) {
  const f = (x: { name: string; type: string; sizeKb: number }) => ({ name: clip(x.name, 80), type: x.type, size_kb: x.sizeKb });
  return {
    cover: m.cover ? f(m.cover) : null,
    video: m.video ? { ...f(m.video), note: 'Slate can’t watch videos; only this metadata.' } : null,
    slides: { count: m.slides.length, first: m.slides.slice(0, 10).map(f) },
    references: m.references.slice(0, 10).map((r) => ({ title: clip(r.title, 120), note: clip(r.note, 200), url: clip(r.url, 200) })),
    viewing: 'To look at the cover or a slide, the creator picks it with the image button in the chat.',
  };
}

const postRef = (p: PostRecord): EntityRef => ({ type: 'post', id: p.id, title: p.title });
const ideaRef = (i: IdeaRecord): EntityRef => ({ type: 'idea', id: i.id, title: i.title });

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

const LABELS: Record<string, string> = {
  search_posts: 'Searching your posts',
  search_ideas: 'Searching your ideas',
  get_post_details: 'Reading a post',
  list_channels: 'Checking your channels',
  get_upcoming_content: 'Checking upcoming work',
  get_creator_preferences: 'Checking your preferences',
  get_calendar: 'Checking your calendar',
  get_creative_continuity: 'Looking across your work',
  propose_preference: 'Preparing a preference to save',
  propose_post_update: 'Preparing a change for you to review',
  propose_post_creation: 'Preparing a draft for you to review',
  propose_idea_conversion: 'Preparing a draft for you to review',
  propose_stage_change: 'Preparing a change for you to review',
  propose_target_date: 'Preparing a change for you to review',
  propose_batch_updates: 'Preparing changes for you to review',
  propose_repurpose: 'Preparing drafts for you to review',
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? 'Looking through your Backlot';
}

async function resolveChannel(ctx: ToolContext, id: number | undefined): Promise<ChannelRecord | undefined | null> {
  if (id === undefined) return undefined;
  return ctx.store.getChannel(ctx.uid, id); // null = not the creator's
}

function done(name: string, payload: unknown, refs: EntityRef[], ctx: ToolContext, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  let output = JSON.stringify(payload);
  if (output.length > TOOL_LIMITS.maxResultChars) output = `${output.slice(0, TOOL_LIMITS.maxResultChars)}…(truncated)`;
  if (output.length > ctx.budget.chars) {
    return {
      output: JSON.stringify({ error: 'budget_exhausted', message: 'Enough has been looked up for this request. Answer with what you already have.' }),
      refs: [],
      label: toolLabel(name),
      ok: false,
    };
  }
  ctx.budget.chars -= output.length;
  return { output, refs, label: toolLabel(name), ok: true, ...extra };
}

function failure(name: string, error: string, message: string): ToolOutcome {
  return { output: JSON.stringify({ error, message }), refs: [], label: toolLabel(name), ok: false };
}

const NOT_FOUND_CHANNEL = (name: string) => failure(name, 'not_found', 'No channel with that id in this Backlot. Use list_channels.');

/* ---------------- planning calendar ---------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Pure: turns stored posts into the planning view the model sees. */
export function buildCalendar(posts: PostRecord[], opts: { start: string; days: number; today: string }) {
  const end = shiftDate(opts.start, opts.days - 1);
  const brief = (p: PostRecord) => ({ ref: `post:${p.id}`, title: clip(p.title, 100), stage: STAGE_LABELS[p.status] ?? p.status, channel: p.channelName || null, platform: platformLabel(p.platform) });
  const unposted = posts.filter((p) => p.status !== 'posted');
  const scheduled = unposted.filter((p) => isDate(p.targetDate) && p.targetDate >= opts.start && p.targetDate <= end);
  const byDay = new Map<string, PostRecord[]>();
  for (const p of scheduled) byDay.set(p.targetDate, [...(byDay.get(p.targetDate) ?? []), p]);
  const days = Array.from({ length: opts.days }, (_, i) => shiftDate(opts.start, i));
  const overdue = unposted.filter((p) => isDate(p.targetDate) && p.targetDate < opts.today);
  const undated = unposted.filter((p) => !isDate(p.targetDate));
  const later = unposted.filter((p) => isDate(p.targetDate) && p.targetDate > end);

  // Posting rhythm over the last 8 weeks, from real posted dates.
  const since = shiftDate(opts.today, -56);
  const posted = posts.filter((p) => p.status === 'posted' && isDate(p.postDate) && p.postDate >= since && p.postDate <= opts.today);
  const channels = new Map<string, PostRecord[]>();
  for (const p of posted) channels.set(p.channelName || 'No channel', [...(channels.get(p.channelName || 'No channel') ?? []), p]);
  const rhythm = [...channels.entries()].map(([name, list]) => {
    const counts = new Map<string, number>();
    for (const p of list) counts.set(weekday(p.postDate), (counts.get(weekday(p.postDate)) ?? 0) + 1);
    const usual = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([d]) => d);
    return { channel: name, posted_last_8_weeks: list.length, per_week: Math.round((list.length / 8) * 10) / 10, usual_days: usual, last_posted: list.map((p) => p.postDate).sort().at(-1) };
  });

  const take = <T,>(list: T[], n: number) => list.slice(0, n);
  const payload = {
    today: opts.today,
    range: { from: opts.start, to: end },
    scheduled: days.filter((d) => byDay.has(d)).map((d) => ({ date: d, weekday: weekday(d), posts: byDay.get(d)!.map(brief) })),
    open_days: days.filter((d) => !byDay.has(d) && d >= opts.today).map((d) => `${weekday(d)} ${d}`).slice(0, 31),
    overdue: take(overdue.sort((x, y) => x.targetDate.localeCompare(y.targetDate)), 10).map((p) => ({ ...brief(p), target: p.targetDate })),
    ready_without_date: take(undated.filter((p) => p.status === 'ready'), 10).map(brief),
    in_progress_without_date: take(undated.filter((p) => p.status !== 'ready'), 15).map(brief),
    scheduled_after_range: later.length,
    posting_rhythm: rhythm.length ? rhythm : 'No posts with a posted date in the last 8 weeks.',
    note: 'Only stored dates and stages. Backlot has no analytics, so say nothing about best times or performance.',
  };
  const refs: EntityRef[] = [...scheduled, ...overdue.slice(0, 10), ...undated.slice(0, 25)].map(postRef);
  return { payload, refs };
}

/* ---------------- proposals (nothing is written) ---------------- */

const NOT_FOUND_POST = (name: string) => failure(name, 'not_found', 'No post with that id in this Backlot.');
const PROPOSED_MESSAGE = 'Nothing has changed yet. The creator now sees a preview card with Apply, Edit and Dismiss. Tell them to review it; do not say it was applied.';

/** Reads the model's post field arguments (snake_case) into validated PostChanges. */
function readPostChanges(a: Record<string, unknown>): PostChanges {
  const out: Record<string, unknown> = {};
  const map: [string, ChangeField][] = [['title', 'title'], ['caption', 'caption'], ['tags', 'tags'], ['notes', 'notes'], ['stage', 'status'], ['target_date', 'targetDate']];
  for (const [arg, field] of map) if (a[arg] !== undefined) out[field] = validField(field, a[arg]);
  return out as PostChanges;
}

const currentOf = (p: PostRecord): PostChanges => ({ title: p.title, caption: p.caption, tags: p.tags, notes: p.notes, status: p.status, targetDate: p.targetDate });

/** A draft for one post, or a reason it can't be proposed. */
async function postChangeDraft(ctx: ToolContext, postId: number, proposed: PostChanges, reason: string, batchKey?: string): Promise<ActionDraft | 'not_found' | 'no_change'> {
  const p = await ctx.store.getPost(ctx.uid, postId);
  if (!p) return 'not_found';
  const { changes, before } = diffAgainst(currentOf(p), proposed);
  if (!Object.keys(changes).length) return 'no_change';
  return { kind: kindFor(changes), batchKey, target: { type: 'post', id: p.id, title: p.title }, baseVersion: p.version, changes, before, summary: describeChanges(changes), reason };
}

function proposed(name: string, ctx: ToolContext, drafts: ActionDraft[], extra: Record<string, unknown> = {}): ToolOutcome {
  return done(
    name,
    { proposed: drafts.length, applied: false, status: 'awaiting_creator_approval', suggestions: drafts.map((d) => ({ target: d.target ? `${d.target.type}:${d.target.id}` : 'new post', summary: d.summary })), ...extra, message: PROPOSED_MESSAGE },
    drafts.flatMap((d) => (d.target ? [{ type: d.target.type, id: d.target.id, title: d.target.title }] : [])),
    ctx,
    { actions: drafts }
  );
}

/* ---------------- search (text, with typo fallback) ---------------- */

type SearchMatch = 'keyword' | 'keyword+spelling' | 'keyword+semantic';

/**
 * Text search (stemmed full-text + substrings); if that finds nothing, one retry with typos
 * corrected. When the semantic index is available, its matches are fused in. The result says
 * which methods actually contributed, so Slate never claims meaning-based search it didn't use.
 */
async function findPosts(ctx: ToolContext, query: string, q: Omit<Parameters<SlateStore['searchPosts']>[1], 'terms'>) {
  const pool = ctx.semantic ? Math.max(q.limit, 20) : q.limit;
  let terms = searchTerms(query);
  let corrected: Record<string, string> = {};
  let match: SearchMatch = 'keyword';
  let rows = terms.length ? await ctx.store.searchPosts(ctx.uid, { ...q, terms, limit: pool }) : [];
  if (!rows.length && terms.length) {
    const fix = correctTypos(terms, await ctx.store.vocabulary(ctx.uid));
    if (Object.keys(fix.corrected).length) {
      ({ terms, corrected } = fix);
      match = 'keyword+spelling';
      rows = await ctx.store.searchPosts(ctx.uid, { ...q, terms, limit: pool });
    }
  }
  const hits = ctx.semantic ? await ctx.semantic.searchPosts(ctx.uid, query, { channel: q.channel, status: q.status, platform: q.platform }, 20) : null;
  if (hits?.length) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ids = fuse(rows.map((r) => r.id), hits.map((h) => h.id), q.limit);
    const merged = [];
    for (const id of ids) {
      const row = byId.get(id) ?? (await ctx.store.getPost(ctx.uid, id));
      if (row) merged.push(row);
    }
    return { rows: merged, terms, corrected, match: 'keyword+semantic' as SearchMatch };
  }
  return { rows: rows.slice(0, q.limit), terms, corrected, match };
}

async function findIdeas(ctx: ToolContext, query: string, q: Omit<Parameters<SlateStore['searchIdeas']>[1], 'terms'>) {
  const pool = ctx.semantic ? Math.max(q.limit, 20) : q.limit;
  let terms = searchTerms(query);
  let corrected: Record<string, string> = {};
  let match: SearchMatch = 'keyword';
  let rows = terms.length ? await ctx.store.searchIdeas(ctx.uid, { ...q, terms, limit: pool }) : [];
  if (!rows.length && terms.length) {
    const fix = correctTypos(terms, await ctx.store.vocabulary(ctx.uid));
    if (Object.keys(fix.corrected).length) {
      ({ terms, corrected } = fix);
      match = 'keyword+spelling';
      rows = await ctx.store.searchIdeas(ctx.uid, { ...q, terms, limit: pool });
    }
  }
  const hits = ctx.semantic ? await ctx.semantic.searchIdeas(ctx.uid, query, { channel: q.channel, converted: q.converted }, 20) : null;
  if (hits?.length) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ids = fuse(rows.map((r) => r.id), hits.map((h) => h.id), q.limit);
    const merged = [];
    for (const id of ids) {
      const row = byId.get(id) ?? (await ctx.store.getIdea(ctx.uid, id));
      if (row) merged.push(row);
    }
    return { rows: merged, terms, corrected, match: 'keyword+semantic' as SearchMatch };
  }
  return { rows: rows.slice(0, q.limit), terms, corrected, match };
}

/** Runs one tool call. Never throws for bad input: errors go back to the model as results. */
export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'search_posts': {
        const a = obj(rawArgs, ['query', 'channel_id', 'stage', 'platform', 'limit']);
        const query = reqString(a.query, 'query', 120);
        const channel = await resolveChannel(ctx, optInt(a.channel_id, 'channel_id'));
        if (channel === null) return NOT_FOUND_CHANNEL(name);
        const limit = optInt(a.limit, 'limit', 1, 10) ?? 5;
        const stage = optEnum(a.stage, 'stage', STAGES);
        const platform = optEnum(a.platform, 'platform', PLATFORMS);
        const found = await findPosts(ctx, query, { channel, status: stage, platform, limit });
        const { rows, terms } = found;
        return done(
          name,
          {
            match: found.match,
            query,
            keywords: terms,
            ...(Object.keys(found.corrected).length ? { spelling_corrected: found.corrected } : {}),
            results: rows.map((p) => postSummary(p, terms)),
            ...(rows.length ? {} : { note: 'No saved posts matched these keywords. Say so plainly; do not invent posts.' }),
          },
          rows.map(postRef),
          ctx
        );
      }

      case 'search_ideas': {
        const a = obj(rawArgs, ['query', 'channel_id', 'status', 'limit']);
        const query = reqString(a.query, 'query', 120);
        const channel = await resolveChannel(ctx, optInt(a.channel_id, 'channel_id'));
        if (channel === null) return NOT_FOUND_CHANNEL(name);
        const limit = optInt(a.limit, 'limit', 1, 10) ?? 5;
        const status = optEnum(a.status, 'status', ['open', 'converted', 'any'] as const) ?? 'any';
        const converted = status === 'open' ? false : status === 'converted' ? true : undefined;
        const listAll = query === '*';
        const found = listAll ? null : await findIdeas(ctx, query, { channel, converted, limit });
        const terms = found?.terms ?? [];
        const rows = listAll
          ? (await ctx.store.listIdeas(ctx.uid, { channel, openOnly: converted === false, limit: 10 })).filter((i) => converted !== true || i.convertedItemId !== null).slice(0, limit)
          : found!.rows;
        return done(
          name,
          {
            match: listAll ? 'all' : found!.match,
            ...(found && Object.keys(found.corrected).length ? { spelling_corrected: found.corrected } : {}),
            query,
            results: rows.map((i) => ideaSummary(i, terms)),
            ...(rows.length ? {} : { note: 'No saved ideas matched. Say so plainly; do not invent ideas.' }),
          },
          rows.map(ideaRef),
          ctx
        );
      }

      case 'get_post_details': {
        const a = obj(rawArgs, ['post_id']);
        const p = await ctx.store.getPost(ctx.uid, reqInt(a.post_id, 'post_id'));
        // Same answer whether the id doesn't exist or belongs to someone else.
        if (!p) return failure(name, 'not_found', 'No post with that id in this Backlot.');
        return done(
          name,
          {
            ref: `post:${p.id}`,
            title: clip(p.title, 300),
            platform: platformLabel(p.platform),
            channel: p.channelName || null,
            stage: STAGE_LABELS[p.status] ?? p.status,
            ...dateOf(p),
            caption: clip(p.caption, 2000),
            tags: p.tags.slice(0, 30).map((t) => clip(t, 40)),
            notes: clip(p.notes, 800),
            ...(p.repurposedFromPostId ? { adapted_from: `post:${p.repurposedFromPostId}` } : {}),
            ...(p.media ? { media: mediaSummary(p.media) } : {}),
            ...(p.sourceIdeaId ? { from_idea: `idea:${p.sourceIdeaId}` } : {}),
          },
          [postRef(p)],
          ctx
        );
      }

      case 'list_channels': {
        obj(rawArgs, []);
        const channels = await ctx.store.listChannels(ctx.uid);
        const counts = await ctx.store.channelPostCounts(ctx.uid, channels);
        return done(
          name,
          { channels: channels.map((c) => ({ channel_id: c.id, name: clip(c.name, 80), handle: clip(c.handle, 60) || null, posts: counts.get(c.id) ?? 0 })) },
          [],
          ctx
        );
      }

      case 'get_upcoming_content': {
        const a = obj(rawArgs, ['channel_id', 'within_days', 'limit']);
        const channel = await resolveChannel(ctx, optInt(a.channel_id, 'channel_id'));
        if (channel === null) return NOT_FOUND_CHANNEL(name);
        const within = optInt(a.within_days, 'within_days', 1, 120);
        const limit = optInt(a.limit, 'limit', 1, 15) ?? 10;
        let rows = await ctx.store.listPosts(ctx.uid, { channel, order: 'upcoming', limit: 50 });
        if (within !== undefined) {
          const until = new Date(`${ctx.today}T00:00:00Z`);
          until.setUTCDate(until.getUTCDate() + within);
          const last = until.toISOString().slice(0, 10);
          rows = rows.filter((p) => p.targetDate && p.targetDate <= last);
        }
        const shown = rows.slice(0, limit);
        return done(
          name,
          {
            today: ctx.today,
            results: shown.map((p) => ({ ...postSummary(p), overdue: !!p.targetDate && p.targetDate < ctx.today })),
            ...(rows.length > shown.length ? { more: rows.length - shown.length } : {}),
            ...(shown.length ? {} : { note: 'No unposted work matched. Say so plainly.' }),
          },
          shown.map(postRef),
          ctx
        );
      }

      case 'get_creative_continuity': {
        const a = obj(rawArgs, ['channel_id']);
        const channel = await resolveChannel(ctx, optInt(a.channel_id, 'channel_id'));
        if (channel === null) return NOT_FOUND_CHANNEL(name);
        const snap = await ctx.store.snapshot(ctx.uid, { channel });
        const view = buildContinuity(snap.posts, snap.ideas, { today: ctx.today });
        const refs: EntityRef[] = [];
        for (const r of view.refs) {
          const [type, id] = r.split(':');
          const rec = type === 'post' ? snap.posts.find((p) => p.id === Number(id)) : snap.ideas.find((i) => i.id === Number(id));
          if (rec) refs.push({ type: type as 'post' | 'idea', id: rec.id, title: rec.title });
        }
        return done(name, view.payload, refs, ctx);
      }

      case 'get_calendar': {
        const a = obj(rawArgs, ['start_date', 'days', 'channel_id']);
        const channel = await resolveChannel(ctx, optInt(a.channel_id, 'channel_id'));
        if (channel === null) return NOT_FOUND_CHANNEL(name);
        const start = a.start_date === undefined ? ctx.today : validDate(a.start_date);
        if (!start) throw new ToolArgError('start_date must be YYYY-MM-DD.');
        const days = optInt(a.days, 'days', 1, 60) ?? 14;
        const view = buildCalendar(await ctx.store.calendarPosts(ctx.uid, { channel, postedSince: shiftDate(ctx.today, -56) }), { start, days, today: ctx.today });
        return done(name, view.payload, view.refs, ctx);
      }

      case 'get_creator_preferences': {
        const a = obj(rawArgs, ['channel_id']);
        const channelId = optInt(a.channel_id, 'channel_id');
        if (channelId !== undefined && !(await ctx.store.getChannel(ctx.uid, channelId))) return NOT_FOUND_CHANNEL(name);
        const rows = await ctx.store.listPreferences(ctx.uid);
        const valid = rows.filter((r) => validatePreference(r.key, r.value).ok) as { channelId: number | null; key: PreferenceKey; value: string }[];
        const eff = effectivePreferences(valid, channelId ?? null);
        return done(
          name,
          {
            preferences: eff.map((p) => ({ key: p.key, value: clip(p.value, 300), applies: p.scope === 'channel' ? 'this channel' : 'all channels' })),
            ...(eff.length ? {} : { note: 'The creator has not saved any preferences yet.' }),
          },
          [],
          ctx
        );
      }

      case 'propose_preference': {
        const a = obj(rawArgs, ['key', 'value', 'channel_id']);
        const v = validatePreference(a.key, a.value);
        if (!v.ok) return failure(name, 'invalid', v.error);
        const channelId = optInt(a.channel_id, 'channel_id');
        let channelName: string | null = null;
        if (channelId !== undefined) {
          const c = await ctx.store.getChannel(ctx.uid, channelId);
          if (!c) return NOT_FOUND_CHANNEL(name);
          channelName = c.name;
        }
        const proposal: PreferenceProposal = {
          key: v.key,
          value: v.value,
          channelId: channelId ?? null,
          channelName,
          label: `${describePreference(v.key, v.value)} (${channelName ?? 'all channels'})`,
        };
        return done(
          name,
          { proposed: true, saved: false, message: 'Not saved yet. The creator will see a Save button. Tell them to confirm it if they want it.' },
          [],
          ctx,
          { proposal }
        );
      }

      case 'propose_post_update':
      case 'propose_stage_change':
      case 'propose_target_date': {
        const allowed =
          name === 'propose_post_update' ? ['post_id', 'title', 'caption', 'tags', 'notes', 'reason'] : name === 'propose_stage_change' ? ['post_id', 'stage', 'reason'] : ['post_id', 'target_date', 'reason'];
        const a = obj(rawArgs, allowed);
        const postId = reqInt(a.post_id, 'post_id');
        if (name === 'propose_stage_change') validStage(a.stage);
        if (name === 'propose_target_date' && a.target_date === undefined) throw new ToolArgError('target_date is required.');
        const changes = readPostChanges(a);
        if (!Object.keys(changes).length) throw new ToolArgError('Send at least one field to change.');
        const d = await postChangeDraft(ctx, postId, changes, validReason(a.reason));
        if (d === 'not_found') return NOT_FOUND_POST(name);
        if (d === 'no_change') return failure(name, 'no_change', 'Those values are already what the post has. Nothing to propose.');
        return proposed(name, ctx, [d]);
      }

      case 'propose_batch_updates': {
        const a = obj(rawArgs, ['updates', 'reason']);
        if (!Array.isArray(a.updates) || !a.updates.length) throw new ToolArgError('updates must be a non-empty list.');
        if (a.updates.length > ACTION_LIMITS.perBatch) throw new ToolArgError(`At most ${ACTION_LIMITS.perBatch} posts per batch.`);
        const reason = validReason(a.reason);
        const batchKey = `batch-${Math.random().toString(36).slice(2)}`;
        const seen = new Set<number>();
        const drafts: ActionDraft[] = [];
        const skipped: { post_id: number; why: string }[] = [];
        for (const entry of a.updates) {
          const e = obj(entry, ['post_id', 'title', 'caption', 'tags', 'notes', 'stage', 'target_date']);
          const postId = reqInt(e.post_id, 'post_id');
          if (seen.has(postId)) throw new ToolArgError('Each post can appear only once in a batch.');
          seen.add(postId);
          const changes = readPostChanges(e);
          if (!Object.keys(changes).length) throw new ToolArgError('Each update needs at least one field to change.');
          const d = await postChangeDraft(ctx, postId, changes, reason, batchKey);
          if (d === 'not_found' || d === 'no_change') skipped.push({ post_id: postId, why: d });
          else drafts.push(d);
        }
        if (!drafts.length) return failure(name, 'no_change', 'None of those posts exist or need changing.');
        return proposed(name, ctx, drafts, skipped.length ? { skipped } : {});
      }

      case 'propose_post_creation': {
        const a = obj(rawArgs, ['title', 'platform', 'channel_id', 'caption', 'tags', 'notes', 'target_date', 'reason']);
        const channelId = optInt(a.channel_id, 'channel_id');
        let channel: ChannelRecord | null = null;
        if (channelId !== undefined) {
          channel = await ctx.store.getChannel(ctx.uid, channelId);
          if (!channel) return NOT_FOUND_CHANNEL(name);
        }
        const title = validField('title', a.title) as string;
        const draft = {
          title,
          platform: a.platform === undefined ? ('youtube_long' as PlatformKey) : validPlatform(a.platform),
          channelId: channel?.id ?? null,
          channelName: channel?.name ?? '',
          caption: a.caption === undefined ? '' : (validField('caption', a.caption) as string),
          tags: a.tags === undefined ? [] : validTags(a.tags),
          notes: a.notes === undefined ? '' : (validField('notes', a.notes) as string),
          targetDate: a.target_date === undefined ? '' : validDate(a.target_date),
        };
        return proposed(name, ctx, [{ kind: 'post_create', target: null, baseVersion: null, draft, summary: `New draft: ${clip(title, 80)}`, reason: validReason(a.reason) }]);
      }

      case 'propose_repurpose': {
        const a = obj(rawArgs, ['source_post_id', 'source_idea_id', 'drafts', 'reason']);
        const postId = optInt(a.source_post_id, 'source_post_id');
        const ideaId = optInt(a.source_idea_id, 'source_idea_id');
        if ((postId === undefined) === (ideaId === undefined)) throw new ToolArgError('Send exactly one of source_post_id or source_idea_id.');
        const source = postId !== undefined ? await ctx.store.getPost(ctx.uid, postId) : await ctx.store.getIdea(ctx.uid, ideaId!);
        if (!source) return failure(name, 'not_found', `No ${postId !== undefined ? 'post' : 'idea'} with that id in this Backlot.`);
        if (!Array.isArray(a.drafts) || !a.drafts.length) throw new ToolArgError('drafts must be a non-empty list.');
        if (a.drafts.length > ACTION_LIMITS.perBatch) throw new ToolArgError(`At most ${ACTION_LIMITS.perBatch} drafts.`);
        const reason = validReason(a.reason);
        const batchKey = `repurpose-${Math.random().toString(36).slice(2)}`;
        const drafts: ActionDraft[] = [];
        for (const entry of a.drafts) {
          const d = obj(entry, ['platform', 'channel_id', 'title', 'caption', 'tags', 'notes', 'target_date']);
          const platform = validPlatform(d.platform);
          const channelId = optInt(d.channel_id, 'channel_id');
          let channel: ChannelRecord | null = null;
          if (channelId !== undefined) {
            channel = await ctx.store.getChannel(ctx.uid, channelId);
            if (!channel) return NOT_FOUND_CHANNEL(name);
          }
          const title = validField('title', d.title) as string;
          drafts.push({
            kind: 'post_create',
            batchKey: a.drafts.length > 1 ? batchKey : undefined,
            target: null,
            baseVersion: null,
            draft: {
              title,
              platform,
              channelId: channel?.id ?? null,
              channelName: channel?.name ?? '',
              caption: d.caption === undefined ? '' : (validField('caption', d.caption) as string),
              tags: d.tags === undefined ? [] : validTags(d.tags),
              notes: d.notes === undefined ? '' : (validField('notes', d.notes) as string),
              targetDate: d.target_date === undefined ? '' : validDate(d.target_date),
              ...(postId !== undefined ? { repurposedFromPostId: postId } : { sourceIdeaId: ideaId }),
            },
            summary: `New ${platformLabel(platform)} draft adapted from “${clip(source.title, 60)}”`,
            reason,
          });
        }
        const ref: EntityRef = postId !== undefined ? { type: 'post', id: source.id, title: source.title } : { type: 'idea', id: source.id, title: source.title };
        const outcome = proposed(name, ctx, drafts, { source: `${ref.type}:${ref.id}` });
        return { ...outcome, refs: [ref] };
      }

      case 'propose_idea_conversion': {
        const a = obj(rawArgs, ['idea_id', 'reason']);
        const i = await ctx.store.getIdea(ctx.uid, reqInt(a.idea_id, 'idea_id'));
        if (!i) return failure(name, 'not_found', 'No idea with that id in this Backlot.');
        if (i.convertedItemId) return failure(name, 'already_converted', `That idea is already a post (post:${i.convertedItemId}).`);
        return proposed(name, ctx, [{ kind: 'idea_convert', target: { type: 'idea', id: i.id, title: i.title }, baseVersion: i.version, summary: 'Turn this idea into a post', reason: validReason(a.reason) }]);
      }

      default:
        return failure(name, 'unknown_tool', 'That tool does not exist. Only the listed read tools are available.');
    }
  } catch (err) {
    if (err instanceof ToolArgError || err instanceof ActionInputError) return failure(name, 'invalid_arguments', err.message);
    throw err;
  }
}
