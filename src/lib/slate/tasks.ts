/**
 * Classifies a request so Slate retrieves only what it needs and uses an
 * appropriate thinking level and output budget.
 */

export type SlateTask = 'create' | 'plan' | 'general';

export type SlateEffort = 'low' | 'medium' | 'high';
const EFFORTS: readonly SlateEffort[] = ['low', 'medium', 'high'];

export interface TaskConfig {
  /** Provider-neutral reasoning depth; each adapter maps it to its own setting. */
  effort: SlateEffort;
  /** Cap on generated tokens for one reply. Reasoning tokens count against it on both providers. */
  maxOutputTokens: number;
  /** A provider that hasn't produced any text by then is abandoned for the next one. */
  firstOutputMs: number;
  /** Hard deadline for the whole request, across every provider attempt. */
  deadlineMs: number;
}

const DEFAULTS: Record<SlateTask, TaskConfig> = {
  create: { effort: 'low', maxOutputTokens: 4096, firstOutputMs: 15_000, deadlineMs: 60_000 },
  general: { effort: 'low', maxOutputTokens: 4096, firstOutputMs: 15_000, deadlineMs: 60_000 },
  plan: { effort: 'medium', maxOutputTokens: 8192, firstOutputMs: 30_000, deadlineMs: 90_000 },
};

/** Clearly about planning, whatever else the message says. */
const PLAN_STRONG = /\b(plan|planning|schedule|calendar|prioriti[sz]e|work on|what should i (make|post|create|do)|backlog|roadmap|this week|next week|this month|next month)\b/i;
/** Planning only if the message isn't asking for writing. */
const PLAN_WEAK = /\b(upcoming|today|tomorrow|due|deadline|next)\b/i;
const CREATE_WORDS =
  /\b(hook|hooks|caption|captions|title|titles|hashtag|hashtags|tags|rewrite|shorten|improve|write|draft|script|outline|description|thumbnail text|cta|intro|opening)\b/i;
const IDEA_WORDS = /\b(idea|ideas|inspiration|saved)\b/i;

export function classifyTask(text: string): SlateTask {
  if (PLAN_STRONG.test(text)) return 'plan';
  if (CREATE_WORDS.test(text)) return 'create';
  if (PLAN_WEAK.test(text)) return 'plan';
  return 'general';
}

export function mentionsIdeas(text: string): boolean {
  return IDEA_WORDS.test(text);
}

const intIn = (raw: string | undefined, min: number, max: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * Task config, overridable per task: SLATE_EFFORT_<TASK>, SLATE_MAX_TOKENS_<TASK>,
 * SLATE_FIRST_OUTPUT_MS_<TASK>, SLATE_DEADLINE_MS_<TASK>. Per-provider effort:
 * SLATE_OPENAI_EFFORT_<TASK>, SLATE_ANTHROPIC_EFFORT_<TASK>.
 */
export function taskConfig(task: SlateTask, env: Record<string, string | undefined> = process.env): TaskConfig {
  const base = DEFAULTS[task];
  const key = task.toUpperCase();
  const effort = env[`SLATE_EFFORT_${key}`]?.toLowerCase();
  const deadlineMs = intIn(env[`SLATE_DEADLINE_MS_${key}`], 5_000, 300_000) ?? base.deadlineMs;
  return {
    effort: (EFFORTS as readonly string[]).includes(effort ?? '') ? (effort as SlateEffort) : base.effort,
    maxOutputTokens: intIn(env[`SLATE_MAX_TOKENS_${key}`], 256, 32768) ?? base.maxOutputTokens,
    firstOutputMs: Math.min(intIn(env[`SLATE_FIRST_OUTPUT_MS_${key}`], 2_000, 300_000) ?? base.firstOutputMs, deadlineMs),
    deadlineMs,
  };
}
