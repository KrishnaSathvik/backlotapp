import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/src/db/index.ts';
import { requireUser } from '@/src/lib/auth-server.ts';
import { createAnthropicProvider } from '@/src/lib/slate/anthropic-model.ts';
import { CircuitBreaker } from '@/src/lib/slate/breaker.ts';
import { dailyLimitFromEnv, FailClosedUsageLimiter, SharedBreakerState, SharedUsageLimiter } from '@/src/lib/slate/shared-limits.ts';
import { createOpenAIProvider } from '@/src/lib/slate/openai-model.ts';
import { checkPrimary, estimateCostUsd, FALLBACK_KINDS, readProviderConfig, type FailureKind, type ProviderId, type SlateProvider } from '@/src/lib/slate/providers.ts';
import { buildContents, SLATE_SYSTEM_INSTRUCTION } from '@/src/lib/slate/prompt.ts';
import { parseChatRequest, REQUEST_LIMITS, SlateRequestError } from '@/src/lib/slate/request.ts';
import { gatherContext } from '@/src/lib/slate/retrieval.ts';
import { createDbSlateStore } from '@/src/lib/slate/store-db.ts';
import { createReplyStream } from '@/src/lib/slate/stream.ts';
import { taskConfig } from '@/src/lib/slate/tasks.ts';
import { ALL_TOOL_DEFINITIONS, executeTool } from '@/src/lib/slate/tools.ts';
import { persistDrafts } from '@/src/lib/slate/actions-db.ts';
import { prepareTurn, saveReply } from '@/src/lib/slate/conversation-turn.ts';
import { createSemanticIndex } from '@/src/lib/slate/semantic.ts';
import { loadSlateImage } from '@/src/lib/slate/images.ts';
import { readUploadedFile } from '@/src/lib/file-storage.ts';
import { errorKind, opsEvent } from '@/src/lib/ops-log.ts';
import { isAccountLockedError } from '@/src/db/account-guard.ts';

export const runtime = 'nodejs';
// Vercel: the stream may run up to the longest Slate deadline (90 s by default, at most 300 s via
// SLATE_DEADLINE_MS_*), within the plan's function limit. Every attempt is bounded by that
// deadline, and Stop aborts the provider call (see stream.ts).
export const maxDuration = 300;

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_CONCURRENT = 2;

// Limits are shared across server instances through Postgres and fail closed if that
// store is unreachable. Breaker outcomes are shared the same way.
const limiter = new FailClosedUsageLimiter(
  new SharedUsageLimiter(db, { maxRequests: RATE_LIMIT, windowMs: RATE_WINDOW_MS, maxConcurrent: MAX_CONCURRENT, maxRequestsPerDay: dailyLimitFromEnv() })
);
const breaker = new CircuitBreaker({
  onTransition: (provider, to, why) => opsEvent(`slate.breaker_${to}`, { provider, why }, to === 'open' ? 'WARNING' : 'NOTICE'),
});
const sharedBreaker = new SharedBreakerState(db);
const store = createDbSlateStore(db);
// Meaning-based search uses OpenAI embeddings (the primary provider) when its key is set;
// SLATE_SEMANTIC_SEARCH=off turns it off. Search falls back to text on any problem.
const semantic =
  process.env.OPENAI_API_KEY && process.env.SLATE_SEMANTIC_SEARCH !== 'off'
    ? createSemanticIndex(db, { apiKey: process.env.OPENAI_API_KEY, model: process.env.SLATE_EMBEDDING_MODEL || undefined })
    : undefined;

/** OpenAI, then Claude as fallback; a provider without credentials is left out. */
let warnedPrimary = false;

function buildProviders(): { providers: SlateProvider[]; fallbackEnabled: boolean; skipped: ProviderId[]; configError?: string } {
  const config = readProviderConfig();
  const primary = checkPrimary(config);
  if (!primary.ok) return { providers: [], fallbackEnabled: false, skipped: config.skipped, configError: primary.error };
  if (primary.warning && !warnedPrimary) {
    warnedPrimary = true;
    opsEvent('config.warning', { area: 'slate', detail: primary.warning }, 'WARNING');
  }
  const make: Record<ProviderId, () => SlateProvider> = {
    openai: () => createOpenAIProvider(process.env.OPENAI_API_KEY ?? '', config.models.openai),
    anthropic: () => createAnthropicProvider(process.env.ANTHROPIC_API_KEY ?? '', config.models.anthropic),
  };
  return {
    providers: config.chain.map((id) => make[id]()),
    fallbackEnabled: config.fallbackEnabled,
    skipped: config.skipped,
  };
}

const json = (body: unknown, status: number, headers?: Record<string, string>) => NextResponse.json(body, { status, headers });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const { user, response } = await requireUser(request);
  if (!user) return response;

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > REQUEST_LIMITS.maxBodyBytes) return json({ error: 'Request is too large.' }, 413);

  let parsed: ReturnType<typeof parseChatRequest>;
  try {
    const raw = await request.text();
    if (raw.length > REQUEST_LIMITS.maxBodyBytes) return json({ error: 'Request is too large.' }, 413);
    parsed = parseChatRequest(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SlateRequestError) return json({ error: error.message }, error.status);
    return json({ error: 'Invalid request.' }, 400);
  }

  // Image analysis can be switched off without a deploy (SLATE_IMAGE_ANALYSIS=off).
  if (parsed.image && process.env.SLATE_IMAGE_ANALYSIS === 'off') {
    return json({ error: 'Slate can’t look at images right now.' }, 403);
  }

  const lease = await limiter.acquire(user.uid, parsed.image ? 'image' : 'chat');
  // Quota refusals (counts only; the uid isn't logged). 'unavailable' is logged by the limiter.
  if (!lease.ok && lease.reason !== 'unavailable') opsEvent('slate.limit_reached', { reason: lease.reason }, 'NOTICE');
  if (!lease.ok && lease.reason === 'busy') return json({ error: 'Slate is still answering your last message.' }, 429);
  if (!lease.ok && lease.reason === 'image_quota') {
    return json({ error: 'You’ve reached today’s limit for asking Slate about images. Try again tomorrow.' }, 429, { 'Retry-After': String(lease.retryAfterSec) });
  }
  if (!lease.ok && lease.reason === 'daily_quota') {
    return json({ error: 'You’ve reached today’s Slate limit. Try again tomorrow.' }, 429, { 'Retry-After': String(lease.retryAfterSec) });
  }
  if (!lease.ok && lease.reason === 'unavailable') {
    return json({ error: 'Slate is temporarily unavailable. Try again in a minute.' }, 503, { 'Retry-After': '30' });
  }
  if (!lease.ok) {
    return json(
      { error: `You've reached Slate's limit (${RATE_LIMIT} messages per 10 minutes). Try again in ${Math.ceil(lease.retryAfterSec / 60)} min.` },
      429,
      { 'Retry-After': String(lease.retryAfterSec) }
    );
  }

  // Releases the slot once. If this instance dies first, the lease expires on its own.
  const release = () => {
    lease.release().catch(() => {});
  };

  try {
    const today = todayIso();
    const ctx = await gatherContext(store, {
      uid: user.uid,
      question: parsed.message,
      focus: parsed.focus,
      channelId: parsed.channelId,
      today,
    });
    if (!ctx.ok) {
      release();
      return json({ error: ctx.error, code: 'not_found' }, ctx.status);
    }

    const config = taskConfig(ctx.task);
    const chain = buildProviders();
    if (!chain.providers.length) {
      release();
      opsEvent('config.error', { area: 'slate', detail: chain.configError ?? `no configured providers (missing: ${chain.skipped.join(',') || 'all'})` }, 'ERROR');
      return json({ error: 'Slate isn’t configured on this server yet.' }, 500);
    }

    // An image only goes to the model when the creator picked it for this message.
    let image: Awaited<ReturnType<typeof loadSlateImage>> | null = null;
    if (parsed.image) {
      image = await loadSlateImage(db, user.uid, parsed.image, readUploadedFile);
      if (!image.ok) {
        release();
        return json({ error: image.error }, image.status);
      }
    }

    // The saved conversation is the history; the browser only sends the new message.
    const turn = await prepareTurn(db, user.uid, { ...parsed, attachments: image?.ok ? [{ kind: 'image', label: image.label }] : [] }, chain.providers, {
      signal: request.signal,
      exists: async (type, id) => !!(type === 'post' ? await store.getPost(user.uid, id) : await store.getIdea(user.uid, id)),
    });
    if (!turn.ok) {
      release();
      return json({ error: turn.error, code: 'not_found' }, turn.status);
    }

    await sharedBreaker.syncInto(breaker, chain.providers.map((p) => p.id));
    const stream = createReplyStream(
      chain.providers,
      {
        systemInstruction: SLATE_SYSTEM_INSTRUCTION,
        contents: buildContents(turn.history, image?.ok ? `[Image attached by the creator: ${image.label}]\n${parsed.message}` : parsed.message, ctx.context, turn.notes, image?.ok ? image.part : undefined),
        task: ctx.task,
        maxOutputTokens: config.maxOutputTokens,
        tools: ALL_TOOL_DEFINITIONS,
      },
      {
        signal: request.signal,
        initialEvents: [{ type: 'conversation', id: turn.conversation.publicId, title: turn.conversation.title }],
        deadlineMs: config.deadlineMs,
        firstOutputMs: config.firstOutputMs,
        fallbackEnabled: chain.fallbackEnabled,
        maxFallbackAttempts: 1,
        sameProviderRetries: 1,
        breaker,
        // Tools run for the authenticated user only; the model never supplies the uid.
        runTool: (name, args, budget) => executeTool(name, args, { uid: user.uid, store, today, budget, semantic }),
        // Suggested changes are stored as pending for this creator only; nothing is applied.
        persistActions: (drafts) => persistDrafts(db, user.uid, drafts),
        knownRefs: ctx.knownRefs,
        resolveRef: async (type, id) => {
          const row = type === 'post' ? await store.getPost(user.uid, id) : await store.getIdea(user.uid, id);
          return row ? { type, id: row.id, title: row.title } : null;
        },
        onSettled: (r) => {
          release();
          // Refused by the account write guard if deletion started meanwhile (expected, not an error).
          saveReply(db, user.uid, turn.conversation, r).catch((err) =>
            opsEvent('slate.reply_not_saved', { error: errorKind(err) }, isAccountLockedError(err) ? 'NOTICE' : 'ERROR')
          );
          // Share provider health with other instances (capacity failures before any text only).
          for (const a of r.attempts) {
            if (a.outcome === 'failed' && a.kind && FALLBACK_KINDS.has(a.kind as FailureKind) && !a.ttftMs) void sharedBreaker.recordFailure(a.provider);
          }
          if (r.status === 'done' && r.provider) void sharedBreaker.recordSuccess(r.provider);
          // Internal diagnostics only: no creator content, no keys. Model names never reach the browser.
          // A refusal-fallback reply is billed at the fallback model's rates, so don't price it as Opus.
          const cost = r.provider && !r.refusalFallback ? estimateCostUsd(r.provider, r.usage) : null;
          for (const a of r.attempts) {
            if (a.outcome === 'failed') opsEvent('slate.provider_failed', { provider: a.provider, kind: a.kind ?? 'unknown', ms: a.ms, before_output: !a.ttftMs }, 'WARNING');
          }
          if (r.fallbackReason) opsEvent('slate.fallback', { reason: r.fallbackReason, provider: r.provider ?? null }, 'WARNING');
          opsEvent(
            'slate.reply',
            {
              status: r.status,
              task: ctx.task,
              provider: r.provider ?? null,
              model: r.model ?? null,
              served_model: r.servedModel ?? null,
              skipped: r.skipped.map((s) => `${s.provider}(${s.reason})`).join(',') || null,
              refusal_fallback: !!r.refusalFallback,
              attempts: r.attempts.map((a) => `${a.provider}:${a.outcome}${a.kind ? `(${a.kind})` : ''}:${a.ms}ms:r${a.rounds}`).join(','),
              tools: r.tools.join(',') || null,
              actions: r.actions ?? 0,
              image: image?.ok ? `${image.width}x${image.height}/${Math.round(image.bytes / 1024)}KB` : null,
              ttft_ms: r.ttftMs ?? null,
              total_ms: r.totalMs,
              chars: r.chars,
              input_tokens: r.usage?.inputTokens ?? null,
              output_tokens: r.usage?.outputTokens ?? null,
              // An estimate from list prices in providers.ts, not a billed amount.
              est_cost_usd: cost === null ? null : Number(cost.toFixed(5)),
              finish: r.finishReason ?? null,
            },
            r.status === 'done' ? 'INFO' : 'WARNING'
          );
        },
      }
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    release();
    const message = error instanceof Error ? error.message : '';
    opsEvent('slate.request_failed', { error: errorKind(error) }, 'ERROR');
    if (/API_KEY/.test(message)) return json({ error: 'Slate isn’t configured on this server yet.' }, 500);
    return json({ error: 'Slate couldn’t load your workspace. Try again.' }, 503);
  }
}
