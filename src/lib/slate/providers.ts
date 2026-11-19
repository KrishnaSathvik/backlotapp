import type { ModelContent } from './prompt.ts';
import type { SlateTask } from './tasks.ts';
import type { ToolDefinition } from './tools.ts';

/**
 * Provider-neutral model layer. Slate runs on exactly two providers:
 * OpenAI (primary) and Anthropic (fallback for recoverable OpenAI failures).
 * Both get the same system rules and the same authorized context; adapters only
 * translate formats, reasoning settings, streaming protocols, token usage and errors.
 */

export type ProviderId = 'openai' | 'anthropic';
export const PROVIDER_IDS: readonly ProviderId[] = ['openai', 'anthropic'];

/** One Slate request as handed to a provider. */
export interface SessionRequest {
  systemInstruction: string;
  contents: ModelContent[];
  task: SlateTask;
  /** Output cap per model round (reasoning tokens count against it). */
  maxOutputTokens: number;
  tools: ToolDefinition[];
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolCall {
  /** Provider call id, echoed back with the result. */
  id: string;
  name: string;
  /** Parsed arguments (validated later by the tool layer). */
  args: unknown;
}

export interface RoundResult {
  toolCalls: ToolCall[];
  /** Normalized: STOP, MAX_TOKENS, REFUSAL, TOOL_CALLS, or the provider's own value. */
  finishReason: string;
  usage?: ModelUsage;
  /** The model that actually produced the round, when the provider reports it. */
  servedModel?: string;
  /** Anthropic only: its server-side refusal fallback re-ran the request on another model. */
  refusalFallback?: boolean;
}

export type RoundEvent = { type: 'text'; text: string } | { type: 'end'; result: RoundResult };

/**
 * A provider-native conversation. Each round streams text and ends with any tool
 * calls; the orchestrator runs them and hands results back for the next round.
 * The session keeps whatever the provider needs between rounds (OpenAI reasoning
 * items, Anthropic thinking blocks) unchanged.
 */
export interface ProviderSession {
  round(opts: { signal: AbortSignal; allowTools: boolean }): AsyncIterable<RoundEvent>;
  addToolResults(results: { callId: string; output: string }[]): void;
}

/**
 * How a failure should be handled.
 * transient/rate_limit/timeout: provider-side capacity problems, eligible for fallback.
 * auth/invalid: configuration or request problems; never retried or failed over.
 */
export type FailureKind = 'transient' | 'rate_limit' | 'timeout' | 'auth' | 'invalid' | 'aborted' | 'unknown';

export const FALLBACK_KINDS: ReadonlySet<FailureKind> = new Set(['transient', 'rate_limit', 'timeout']);

export interface SlateProvider {
  id: ProviderId;
  model: string;
  start(req: SessionRequest): ProviderSession;
  classify(err: unknown): FailureKind;
}

/** Shared HTTP-status classification used by the adapters. */
export function classifyStatus(status: number | undefined): FailureKind | null {
  if (status === undefined) return null;
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 404 || status === 409 || status === 413 || status === 422) return 'invalid';
  if (status === 408 || status >= 500) return 'transient';
  return null;
}

export function classifyGenericError(err: unknown): FailureKind {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (name === 'AbortError' || /aborted|abort/i.test(name)) return 'aborted';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network/i.test(msg)) return 'transient';
  return 'unknown';
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface ProviderChainConfig {
  /** openai → anthropic, minus any provider without credentials. */
  chain: ProviderId[];
  /** Providers left out for missing credentials, for diagnostics. */
  skipped: ProviderId[];
  /** SLATE_ENABLE_FALLBACK=false keeps Slate on OpenAI only. */
  fallbackEnabled: boolean;
  /** OPENAI_API_KEY is missing: Claude would silently become the primary. */
  primaryMissing: boolean;
  /** SLATE_ALLOW_FALLBACK_ONLY=true accepts running on Claude alone. */
  allowFallbackOnly: boolean;
  models: Record<ProviderId, string>;
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: 'gpt-6.1-sol',
  anthropic: 'claude-opus-5-5',
};

const KEY_VARS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** Reads OPENAI_API_KEY / ANTHROPIC_API_KEY, OPENAI_MODEL / ANTHROPIC_MODEL, SLATE_ENABLE_FALLBACK and SLATE_ALLOW_FALLBACK_ONLY. */
export function readProviderConfig(env: Record<string, string | undefined> = process.env): ProviderChainConfig {
  const fallbackEnabled = (env.SLATE_ENABLE_FALLBACK ?? 'true').toLowerCase() !== 'false';
  const wanted: ProviderId[] = fallbackEnabled ? ['openai', 'anthropic'] : ['openai'];
  const hasKey = (p: ProviderId) => !!env[KEY_VARS[p]]?.trim();
  return {
    chain: wanted.filter(hasKey),
    skipped: wanted.filter((p) => !hasKey(p)),
    fallbackEnabled,
    primaryMissing: !hasKey('openai'),
    allowFallbackOnly: (env.SLATE_ALLOW_FALLBACK_ONLY ?? '').toLowerCase() === 'true',
    models: {
      openai: env.OPENAI_MODEL?.trim() || DEFAULT_MODELS.openai,
      anthropic: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODELS.anthropic,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cost estimates                                                      */
/* ------------------------------------------------------------------ */

/**
 * USD per 1M tokens [input, output]. Only prices verified from the provider are
 * defaulted; set SLATE_PRICE_<PROVIDER>="in,out" for the others.
 */
const DEFAULT_PRICES: Partial<Record<ProviderId, [number, number]>> = {
  anthropic: [4, 20], // claude-opus-5-5 list price
};

export function estimateCostUsd(provider: ProviderId, usage: ModelUsage | undefined, env: Record<string, string | undefined> = process.env): number | null {
  if (!usage) return null;
  const raw = env[`SLATE_PRICE_${provider.toUpperCase()}`];
  let price = DEFAULT_PRICES[provider] ?? null;
  if (raw) {
    const [a, b] = raw.split(',').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) price = [a, b];
  }
  if (!price) return null;
  return (usage.inputTokens * price[0] + usage.outputTokens * price[1]) / 1_000_000;
}

export type PrimaryCheck = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * OpenAI is Slate's primary. Without its key, production refuses to run Slate
 * rather than silently making Claude the primary, unless SLATE_ALLOW_FALLBACK_ONLY=true.
 * Outside production it warns and continues on Claude.
 */
export function checkPrimary(config: ProviderChainConfig, nodeEnv: string | undefined = process.env.NODE_ENV): PrimaryCheck {
  if (!config.primaryMissing) return { ok: true };
  if (!config.chain.length) return { ok: false, error: 'No Slate provider keys are configured (OPENAI_API_KEY, ANTHROPIC_API_KEY).' };
  const msg = 'OPENAI_API_KEY is missing: Slate is running on its Claude fallback only.';
  if (nodeEnv === 'production' && !config.allowFallbackOnly) {
    return { ok: false, error: `${msg} Set OPENAI_API_KEY, or SLATE_ALLOW_FALLBACK_ONLY=true to accept this.` };
  }
  return { ok: true, warning: msg };
}
