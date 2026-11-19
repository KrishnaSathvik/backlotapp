/**
 * Slate creative preferences: a fixed set of keys with validated, bounded values.
 * Saved only by an explicit creator action (the panel, or confirming a proposal in chat).
 * A channel-scoped value overrides the global (all channels) value for that channel.
 */

export const PREFERENCE_KEYS = ['tone', 'caption_length', 'emoji_usage', 'hashtag_count', 'language', 'audience', 'avoid'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export type PreferenceSource = 'user' | 'slate_confirmed';

interface KeySpec {
  label: string;
  /** Allowed values, when the key is a fixed choice. */
  options?: readonly string[];
  /** Free-text limits otherwise. */
  maxLength?: number;
  integer?: { min: number; max: number };
  hint: string;
}

export const PREFERENCE_SPECS: Record<PreferenceKey, KeySpec> = {
  tone: {
    label: 'Writing tone',
    options: ['casual', 'friendly', 'professional', 'playful', 'bold', 'calm', 'witty', 'inspirational', 'educational'],
    hint: 'How captions and scripts should sound',
  },
  caption_length: { label: 'Caption length', options: ['short', 'medium', 'long'], hint: 'Roughly how long captions should be' },
  emoji_usage: { label: 'Emoji use', options: ['none', 'minimal', 'moderate', 'lots'], hint: 'How many emojis to use' },
  hashtag_count: { label: 'Hashtags', integer: { min: 0, max: 30 }, hint: 'How many hashtags to suggest' },
  language: { label: 'Language', maxLength: 40, hint: 'e.g. English, Spanish, Hinglish' },
  audience: { label: 'Audience', maxLength: 120, hint: 'Who the content is for' },
  avoid: { label: 'Avoid', maxLength: 300, hint: 'Topics, words or phrases to avoid' },
};

export interface PreferenceRecord {
  id: number;
  channelId: number | null;
  key: PreferenceKey;
  value: string;
  source: PreferenceSource;
  updatedAt: string;
}

export function isPreferenceKey(k: unknown): k is PreferenceKey {
  return typeof k === 'string' && (PREFERENCE_KEYS as readonly string[]).includes(k);
}

/** Returns the normalized value, or an error message. */
export function validatePreference(key: unknown, value: unknown): { ok: true; key: PreferenceKey; value: string } | { ok: false; error: string } {
  if (!isPreferenceKey(key)) return { ok: false, error: 'Unknown preference.' };
  const spec = PREFERENCE_SPECS[key];
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  if (raw === null) return { ok: false, error: `${spec.label} must be text.` };
  // Collapse whitespace and drop control characters.
  const v = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) return { ok: false, error: `${spec.label} can’t be empty.` };
  if (spec.options) {
    const lower = v.toLowerCase();
    if (!spec.options.includes(lower)) return { ok: false, error: `${spec.label} must be one of: ${spec.options.join(', ')}.` };
    return { ok: true, key, value: lower };
  }
  if (spec.integer) {
    if (!/^\d{1,3}$/.test(v)) return { ok: false, error: `${spec.label} must be a whole number.` };
    const n = Number(v);
    if (n < spec.integer.min || n > spec.integer.max) return { ok: false, error: `${spec.label} must be between ${spec.integer.min} and ${spec.integer.max}.` };
    return { ok: true, key, value: String(n) };
  }
  if (v.length > (spec.maxLength ?? 100)) return { ok: false, error: `${spec.label} can be up to ${spec.maxLength} characters.` };
  if (/[<>]/.test(v)) return { ok: false, error: `${spec.label} can’t contain < or >.` };
  return { ok: true, key, value: v };
}

export interface EffectivePreference {
  key: PreferenceKey;
  value: string;
  /** Where the value came from: the channel's own setting, or the global one. */
  scope: 'channel' | 'global';
}

/** Global values, overridden per key by the given channel's values. Stable key order. */
export function effectivePreferences(prefs: Pick<PreferenceRecord, 'channelId' | 'key' | 'value'>[], channelId: number | null): EffectivePreference[] {
  const out: EffectivePreference[] = [];
  for (const key of PREFERENCE_KEYS) {
    const channel = channelId !== null ? prefs.find((p) => p.key === key && p.channelId === channelId) : undefined;
    const global = prefs.find((p) => p.key === key && p.channelId === null);
    const pick = channel ?? global;
    if (pick) out.push({ key, value: pick.value, scope: channel ? 'channel' : 'global' });
  }
  return out;
}

export function describePreference(key: PreferenceKey, value: string): string {
  const spec = PREFERENCE_SPECS[key];
  if (key === 'hashtag_count') return `${spec.label}: ${value} per post`;
  return `${spec.label}: ${value}`;
}
