import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './breaker.ts';
import {
  checkPrimary,
  classifyStatus,
  estimateCostUsd,
  readProviderConfig,
  type FailureKind,
  type ModelUsage,
  type ProviderId,
  type RoundEvent,
  type SlateProvider,
  type ToolCall,
} from './providers.ts';
import { createReplyStream, extractRefMarkers, planAttempts, readStreamEvents, type ReplyReport, type StreamEvent } from './stream.ts';
import { TOOL_DEFINITIONS, type ToolOutcome } from './tools.ts';

/** Slate's chain: OpenAI (primary) → Claude (fallback). Providers here are fakes. */

const REQ = { systemInstruction: 's', contents: [], task: 'create' as const, maxOutputTokens: 100 };

class Fail extends Error {
  kind: FailureKind;
  constructor(kind: FailureKind) {
    super(kind);
    this.kind = kind;
  }
}

type Chunk = { text?: string; finishReason?: string; usage?: ModelUsage; servedModel?: string; refusalFallback?: boolean };
/** `{ tools }` ends the current round with those tool calls; later steps belong to the next round. */
type Step = Chunk | Fail | { wait: number } | { tools: ToolCall[] };

/** A fake provider: one script per attempt, played across rounds. Records signals and tool results. */
function fake(id: ProviderId, ...scripts: Step[][]): SlateProvider & { calls: number; signals: AbortSignal[]; toolResults: string[][]; allowTools: boolean[] } {
  const p = {
    id,
    model: `${id}-model`,
    calls: 0,
    signals: [] as AbortSignal[],
    toolResults: [] as string[][],
    allowTools: [] as boolean[],
    start() {
      const script = scripts[Math.min(p.calls, scripts.length - 1)] ?? [];
      p.calls += 1;
      let at = 0;
      return {
        async *round({ signal, allowTools }: { signal: AbortSignal; allowTools: boolean }): AsyncIterable<RoundEvent> {
          p.signals.push(signal);
          p.allowTools.push(allowTools);
          const end: Chunk = {};
          while (at < script.length) {
            const step = script[at++];
            if ('wait' in step) {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, step.wait);
                signal.addEventListener('abort', () => {
                  clearTimeout(t);
                  reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
              });
              continue;
            }
            await new Promise((r) => setTimeout(r, 1));
            if (step instanceof Fail) throw step;
            if ('tools' in step) {
              yield { type: 'end', result: { toolCalls: allowTools ? step.tools : [], finishReason: 'TOOL_CALLS' } };
              return;
            }
            if (step.text) yield { type: 'text', text: step.text };
            Object.assign(end, { ...step, text: undefined });
          }
          yield { type: 'end', result: { toolCalls: [], finishReason: end.finishReason ?? 'STOP', usage: end.usage, servedModel: end.servedModel, refusalFallback: end.refusalFallback } };
        },
        addToolResults(results: { callId: string; output: string }[]) {
          p.toolResults.push(results.map((r) => r.output));
        },
      };
    },
    classify: (err: unknown) => (err instanceof Fail ? err.kind : (err as Error)?.name === 'AbortError' ? ('aborted' as const) : ('unknown' as const)),
  };
  return p;
}

const call = (name: string, args: unknown = {}, id = `c-${name}`): ToolCall => ({ id, name, args });

/** A fake tool runner: records calls, returns refs for search_posts. */
function tools(log: string[] = []) {
  return async (name: string, args: unknown): Promise<ToolOutcome> => {
    log.push(name);
    if (name === 'search_posts') {
      return { output: '{"results":[{"ref":"post:10"}]}', refs: [{ type: 'post', id: 10, title: 'Tokyo After Dark' }], label: 'Searching your posts', ok: true };
    }
    if (name === 'propose_preference') {
      return { output: '{"saved":false}', refs: [], label: 'x', ok: true, proposal: { key: 'emoji_usage', value: 'none', channelId: null, channelName: null, label: 'Emoji use: none (all channels)' } };
    }
    return { output: JSON.stringify({ ok: true, args }), refs: [], label: 'Looking', ok: true };
  };
}

function run(providers: SlateProvider[], over: Partial<Parameters<typeof createReplyStream>[2]> = {}) {
  let report: ReplyReport | null = null;
  const stream = createReplyStream(providers, { ...REQ, tools: over.runTool ? TOOL_DEFINITIONS : [] }, {
    signal: new AbortController().signal,
    deadlineMs: 5000,
    firstOutputMs: 2000,
    fallbackEnabled: true,
    maxFallbackAttempts: 1,
    retryDelayMs: () => 1,
    onSettled: (r) => (report = r),
    ...over,
  });
  return { stream, report: () => report as ReplyReport | null };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of readStreamEvents(stream)) out.push(e);
  return out;
}

const text = (events: StreamEvent[]) => events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('');

test('OpenAI succeeds: Claude is never called', async () => {
  const o = fake('openai', [{ text: 'Hel' }, { text: 'lo' }, { finishReason: 'STOP', usage: { inputTokens: 10, outputTokens: 2 } }]);
  const c = fake('anthropic', [{ text: 'never' }]);
  const r = run([o, c]);
  const events = await collect(r.stream);
  assert.equal(text(events), 'Hello');
  assert.deepEqual(events.at(-1), { type: 'done', finishReason: 'STOP' });
  assert.equal(c.calls, 0);
  assert.equal(r.report()?.provider, 'openai');
  assert.equal(r.report()?.fallbackReason, undefined);
  assert.deepEqual(r.report()?.usage, { inputTokens: 10, outputTokens: 2 });
});

for (const kind of ['transient', 'rate_limit'] as const) {
  test(`OpenAI ${kind === 'transient' ? '503 / connection failure' : '429'}: Claude answers`, async () => {
    const o = fake('openai', [new Fail(kind)]);
    const c = fake('anthropic', [{ text: 'From Claude' }]);
    const r = run([o, c]);
    const events = await collect(r.stream);
    assert.equal(text(events), 'From Claude');
    assert.equal(r.report()?.provider, 'anthropic');
    assert.equal(r.report()?.fallbackReason, kind);
    assert.deepEqual(r.report()?.attempts.map((a) => `${a.provider}:${a.outcome}`), ['openai:failed', 'anthropic:success']);
  });
}

test('OpenAI silent past the first-output deadline: Claude answers', async () => {
  const o = fake('openai', [{ wait: 10_000 }]);
  const c = fake('anthropic', [{ text: 'quick' }]);
  const r = run([o, c], { firstOutputMs: 30 });
  assert.equal(text(await collect(r.stream)), 'quick');
  assert.equal(r.report()?.fallbackReason, 'timeout');
  assert.equal(o.signals[0].aborted, true, 'the OpenAI call is cancelled before Claude starts');
});

test('both fail: one clear retry message, nothing else tried', async () => {
  const o = fake('openai', [new Fail('transient')]);
  const c = fake('anthropic', [new Fail('transient')]);
  const r = run([o, c]);
  assert.deepEqual(await collect(r.stream), [{ type: 'error', error: 'Slate is busy right now. Try again in a moment.' }]);
  assert.equal(o.calls + c.calls, 2);
});

test('Stop: Claude is never started, OpenAI call is aborted', async () => {
  const user = new AbortController();
  const o = fake('openai', [{ wait: 1000 }, { text: 'late' }]);
  const c = fake('anthropic', [{ text: 'should not run' }]);
  const r = run([o, c], { signal: user.signal });
  setTimeout(() => user.abort(), 20);
  const events = await collect(r.stream);
  assert.equal(events.length, 0);
  assert.equal(c.calls, 0);
  assert.equal(o.signals[0].aborted, true);
  assert.equal(r.report()?.status, 'aborted');
});

test('Stop mid-stream keeps what was sent and never falls back', async () => {
  const user = new AbortController();
  const o = fake('openai', [{ text: 'First words' }, { wait: 1000 }, { text: ' more' }]);
  const c = fake('anthropic', [{ text: 'no' }]);
  const r = run([o, c], { signal: user.signal });
  setTimeout(() => user.abort(), 30);
  assert.equal(text(await collect(r.stream)), 'First words');
  assert.equal(c.calls, 0);
  assert.equal(r.report()?.status, 'aborted');
});

test('OpenAI fails after streaming text: no fallback, partial kept, error reported', async () => {
  const o = fake('openai', [{ text: 'Part' }, new Fail('transient')]);
  const c = fake('anthropic', [{ text: 'replay' }]);
  const r = run([o, c]);
  const events = await collect(r.stream);
  assert.equal(text(events), 'Part');
  assert.equal(events.at(-1)?.type, 'error');
  assert.equal(c.calls, 0);
});

test('invalid request or authorization error: no fallback, no retry', async () => {
  for (const kind of ['invalid', 'auth'] as const) {
    const o = fake('openai', [new Fail(kind)]);
    const c = fake('anthropic', [{ text: 'nope' }]);
    const r = run([o, c]);
    const events = await collect(r.stream);
    assert.equal(c.calls, 0, kind);
    assert.equal(o.calls, 1, kind);
    assert.deepEqual(events, [{ type: 'error', error: 'Slate isn’t set up correctly right now. Try again later.' }]);
  }
});

test('overall deadline stops OpenAI and Claude', async () => {
  const o = fake('openai', [{ wait: 10_000 }]);
  const c = fake('anthropic', [{ wait: 10_000 }]);
  const r = run([o, c], { deadlineMs: 80, firstOutputMs: 40 });
  const t = Date.now();
  const events = await collect(r.stream);
  assert.ok(Date.now() - t < 1000);
  assert.deepEqual(events, [{ type: 'error', error: 'Slate took too long to answer. Try again.' }]);
  assert.ok(o.signals[0].aborted && c.signals[0].aborted);
});

test('Claude (last in line) is not cut off by the first-output deadline', async () => {
  const o = fake('openai', [new Fail('transient')]);
  const c = fake('anthropic', [{ wait: 60 }, { text: 'slow but fine' }]);
  const r = run([o, c], { firstOutputMs: 20, deadlineMs: 2000 });
  assert.equal(text(await collect(r.stream)), 'slow but fine');
});

test('without a Claude key, OpenAI gets one bounded retry for capacity failures', async () => {
  const o = fake('openai', [new Fail('transient')], [{ text: 'second try' }]);
  const r = run([o], { sameProviderRetries: 1 });
  assert.equal(text(await collect(r.stream)), 'second try');
  assert.equal(o.calls, 2);
});

test('fallback can be switched off', async () => {
  const o = fake('openai', [new Fail('transient')]);
  const c = fake('anthropic', [{ text: 'x' }]);
  await collect(run([o, c], { fallbackEnabled: false }).stream);
  assert.equal(c.calls, 0);
});

test('cancelling the response body aborts the provider call', async () => {
  const o = fake('openai', Array.from({ length: 200 }, () => ({ text: 'y' })));
  const reader = run([o]).stream.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(o.signals[0].aborted, true);
});

test('configuration: OpenAI primary, Claude fallback, missing keys left out', () => {
  const both = readProviderConfig({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' });
  assert.deepEqual(both.chain, ['openai', 'anthropic']);
  assert.deepEqual(both.models, { openai: 'gpt-6.1-sol', anthropic: 'claude-opus-5-5' });
  assert.deepEqual(readProviderConfig({ OPENAI_API_KEY: 'o' }).chain, ['openai']);
  assert.deepEqual(readProviderConfig({ ANTHROPIC_API_KEY: 'a' }).chain, ['anthropic']);
  assert.deepEqual(readProviderConfig({ OPENAI_API_KEY: 'o' }).skipped, ['anthropic']);
  assert.deepEqual(readProviderConfig({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', SLATE_ENABLE_FALLBACK: 'false' }).chain, ['openai']);
  const custom = readProviderConfig({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', OPENAI_MODEL: 'x', ANTHROPIC_MODEL: 'y' });
  assert.deepEqual(custom.models, { openai: 'x', anthropic: 'y' });
  // A leftover Gemini key does nothing.
  assert.deepEqual(readProviderConfig({ GEMINI_API_KEY: 'g' }).chain, []);
});

test('circuit breaker opens on repeated OpenAI failures, routes to Claude, recovers via one probe', async () => {
  let now = 0;
  const b = new CircuitBreaker({ threshold: 2, windowMs: 1000, cooldownMs: 500, now: () => now });
  const providers = [{ id: 'openai' }, { id: 'anthropic' }];
  b.recordFailure('openai');
  assert.equal(b.state('openai'), 'closed');
  b.recordFailure('openai');
  assert.equal(b.state('openai'), 'open');
  assert.deepEqual(b.order(providers).map((p) => p.id), ['anthropic']);

  now = 600; // cooldown over: one probe allowed
  assert.equal(b.state('openai'), 'half-open');
  assert.deepEqual(b.order(providers).map((p) => p.id), ['openai', 'anthropic']);
  b.beginAttempt('openai');
  assert.deepEqual(b.order(providers).map((p) => p.id), ['anthropic'], 'only one probe at a time');
  b.recordFailure('openai'); // probe failed: open again
  assert.equal(b.state('openai'), 'open');

  now = 1200;
  b.beginAttempt('openai');
  b.recordSuccess('openai');
  assert.equal(b.state('openai'), 'closed');
  assert.deepEqual(b.order(providers).map((p) => p.id), ['openai', 'anthropic']);

  // Both open: keep trying in priority order rather than refusing.
  b.recordFailure('openai');
  b.recordFailure('openai');
  b.recordFailure('anthropic');
  b.recordFailure('anthropic');
  assert.deepEqual(b.order(providers).map((p) => p.id), ['openai', 'anthropic']);
});

test('an open OpenAI breaker sends requests straight to Claude', async () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  breaker.recordFailure('openai');
  const o = fake('openai', [{ text: 'should be skipped' }]);
  const c = fake('anthropic', [{ text: 'healthy fallback' }]);
  assert.equal(text(await collect(run([o, c], { breaker }).stream)), 'healthy fallback');
  assert.equal(o.calls, 0);
});

test('bad credentials never open the breaker', async () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  await collect(run([fake('openai', [new Fail('auth')])], { breaker }).stream);
  assert.equal(breaker.state('openai'), 'closed');
});

test('planAttempts: OpenAI then Claude, at most one fallback', () => {
  const ps = [fake('openai'), fake('anthropic')];
  assert.deepEqual(planAttempts(ps, { fallbackEnabled: true, maxFallbackAttempts: 1 }).map((p) => p.id), ['openai', 'anthropic']);
  assert.deepEqual(planAttempts(ps, { fallbackEnabled: false, maxFallbackAttempts: 1 }).map((p) => p.id), ['openai']);
  assert.deepEqual(planAttempts([ps[0]], { fallbackEnabled: true, maxFallbackAttempts: 1, sameProviderRetries: 1 }).map((p) => p.id), ['openai', 'openai']);
});

test('status classification and cost estimates', () => {
  assert.equal(classifyStatus(503), 'transient');
  assert.equal(classifyStatus(529), 'transient');
  assert.equal(classifyStatus(429), 'rate_limit');
  assert.equal(classifyStatus(401), 'auth');
  assert.equal(classifyStatus(400), 'invalid');
  assert.equal(estimateCostUsd('anthropic', { inputTokens: 1_000_000, outputTokens: 100_000 }, {}), 6);
  assert.equal(estimateCostUsd('openai', { inputTokens: 1000, outputTokens: 1000 }, {}), null, 'unverified price is not guessed');
  assert.equal(estimateCostUsd('openai', { inputTokens: 1_000_000, outputTokens: 0 }, { SLATE_PRICE_OPENAI: '1.5,6' }), 1.5);
});

test('an OpenAI skip due to an open circuit is reported, not just the provider that ran', async () => {
  const breaker = new CircuitBreaker({ threshold: 1 });
  breaker.recordFailure('openai');
  const r = run([fake('openai', [{ text: 'x' }]), fake('anthropic', [{ text: 'from claude' }])], { breaker });
  await collect(r.stream);
  assert.deepEqual(r.report()?.skipped, [{ provider: 'openai', reason: 'circuit_open' }]);
  assert.equal(r.report()?.provider, 'anthropic');
});

test('no skip is reported when OpenAI is healthy', async () => {
  const r = run([fake('openai', [{ text: 'x' }]), fake('anthropic', [{ text: 'y' }])], { breaker: new CircuitBreaker() });
  await collect(r.stream);
  assert.deepEqual(r.report()?.skipped, []);
});

test("Claude's own refusal fallback and served model are surfaced in the report", async () => {
  const c = fake('anthropic', [{ text: 'answer' }, { finishReason: 'STOP', servedModel: 'claude-opus-4-8', refusalFallback: true }]);
  const r = run([c]);
  await collect(r.stream);
  assert.equal(r.report()?.refusalFallback, true);
  assert.equal(r.report()?.servedModel, 'claude-opus-4-8');
  assert.equal(r.report()?.model, 'anthropic-model');
});

test('missing OpenAI key: refused in production unless explicitly allowed; warns elsewhere', () => {
  const claudeOnly = readProviderConfig({ ANTHROPIC_API_KEY: 'a' });
  assert.equal(claudeOnly.primaryMissing, true);
  assert.equal(checkPrimary(claudeOnly, 'production').ok, false);
  const allowed = checkPrimary(readProviderConfig({ ANTHROPIC_API_KEY: 'a', SLATE_ALLOW_FALLBACK_ONLY: 'true' }), 'production');
  assert.equal(allowed.ok, true);
  assert.match((allowed as { warning?: string }).warning ?? '', /OPENAI_API_KEY is missing/);
  const dev = checkPrimary(claudeOnly, 'development');
  assert.ok(dev.ok && dev.warning);
  assert.deepEqual(checkPrimary(readProviderConfig({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' }), 'production'), { ok: true });
  assert.equal(checkPrimary(readProviderConfig({}), 'development').ok, false);
});

/* ------------------------------------------------------------------ */
/* Milestone 2: tool rounds                                            */
/* ------------------------------------------------------------------ */

test('a tool round runs the tool, feeds the result back, then streams the answer with validated refs', async () => {
  const log: string[] = [];
  const o = fake('openai', [{ tools: [call('search_posts', { query: 'tokyo' })] }, { text: 'Found it: Tokyo After Dark [[post:10]]' }]);
  const r = run([o], { runTool: tools(log) });
  const events = await collect(r.stream);
  assert.deepEqual(log, ['search_posts']);
  assert.equal(o.toolResults.length, 1);
  assert.deepEqual(events[0], { type: 'tool', name: 'search_posts', label: 'Searching your posts' });
  assert.deepEqual(events.find((e) => e.type === 'refs'), { type: 'refs', refs: [{ type: 'post', id: 10, title: 'Tokyo After Dark' }] });
  assert.deepEqual(r.report()?.tools, ['search_posts']);
});

test('refs the model invents are dropped unless the uid-scoped lookup finds them', async () => {
  const o = fake('openai', [{ text: 'See [[post:10]] and [[post:777]] and [[idea:3]]' }]);
  const lookups: string[] = [];
  const r = run([o], {
    runTool: tools(),
    knownRefs: [{ type: 'post', id: 10, title: 'Focused' }],
    resolveRef: async (type, id) => {
      lookups.push(`${type}:${id}`);
      return type === 'idea' && id === 3 ? { type, id, title: 'Own idea' } : null;
    },
  });
  const refs = (await collect(r.stream)).find((e) => e.type === 'refs') as { refs: unknown[] };
  assert.deepEqual(refs.refs, [{ type: 'post', id: 10, title: 'Focused' }, { type: 'idea', id: 3, title: 'Own idea' }]);
  assert.deepEqual(lookups, ['post:777', 'idea:3']);
});

test('12. tool rounds are capped: the last round is forced to answer without tools', async () => {
  const loop = Array.from({ length: 10 }, (_, i) => ({ tools: [call('list_channels', {}, `c${i}`)] }));
  const o = fake('openai', [...loop, { text: 'done' }]);
  const log: string[] = [];
  const r = run([o], { runTool: tools(log), maxRounds: 3 });
  await collect(r.stream);
  assert.equal(log.length, 3);
  assert.deepEqual(o.allowTools, [true, true, true, false]);
});

test('per-round tool calls are capped; extra calls get a skipped result', async () => {
  const many = Array.from({ length: 9 }, (_, i) => call('list_channels', {}, `c${i}`));
  const o = fake('openai', [{ tools: many }, { text: 'ok' }]);
  const log: string[] = [];
  await collect(run([o], { runTool: tools(log) }).stream);
  assert.equal(log.length, 6);
  assert.equal(o.toolResults[0].length, 9);
  assert.match(o.toolResults[0][8], /too_many_calls/);
});

test('13. OpenAI fails after a tool round but before text: Claude starts fresh and answers with tools', async () => {
  const log: string[] = [];
  const o = fake('openai', [{ tools: [call('search_posts', { query: 'tokyo' })] }, new Fail('transient')]);
  const c = fake('anthropic', [{ tools: [call('search_posts', { query: 'tokyo' })] }, { text: 'Claude found [[post:10]]' }]);
  const r = run([o, c], { runTool: tools(log) });
  const events = await collect(r.stream);
  assert.equal(r.report()?.provider, 'anthropic');
  assert.equal(r.report()?.fallbackReason, 'transient');
  assert.deepEqual(log, ['search_posts', 'search_posts'], 'Claude re-ran its own lookup; nothing carried over');
  assert.equal(events.filter((e) => e.type === 'refs').length, 1, 'refs only from the answering attempt');
});

test('no fallback once text streamed, even mid tool use', async () => {
  const o = fake('openai', [{ text: 'Let me check… ' }, { tools: [call('search_posts', { query: 'x' })] }, new Fail('transient')]);
  const c = fake('anthropic', [{ text: 'no' }]);
  const events = await collect(run([o, c], { runTool: tools() }).stream);
  assert.equal(c.calls, 0);
  assert.equal(events.at(-1)?.type, 'error');
});

test('14. Stop during a tool round cancels everything; no fallback, no proposal', async () => {
  const user = new AbortController();
  const slowTool = async (): Promise<ToolOutcome> => {
    user.abort();
    return { output: '{}', refs: [], label: 'x', ok: true, proposal: { key: 'tone', value: 'calm', channelId: null, channelName: null, label: 'x' } };
  };
  const o = fake('openai', [{ tools: [call('propose_preference', { key: 'tone', value: 'calm' })] }, { text: 'never' }]);
  const c = fake('anthropic', [{ text: 'never' }]);
  const r = run([o, c], { signal: user.signal, runTool: slowTool });
  const events = await collect(r.stream);
  assert.equal(c.calls, 0);
  assert.equal(r.report()?.status, 'aborted');
  assert.ok(!events.some((e) => e.type === 'proposal' || e.type === 'delta'));
});

test('preference proposals reach the browser only when the reply completes', async () => {
  const o = fake('openai', [{ tools: [call('propose_preference', { key: 'emoji_usage', value: 'none' })] }, { text: 'Ready to save.' }]);
  const events = await collect(run([o], { runTool: tools() }).stream);
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('proposal') > types.lastIndexOf('delta'));
  assert.deepEqual(types.at(-1), 'done');
});

test('tool activity counts as first output for the deadline', async () => {
  const o = fake('openai', [{ tools: [call('list_channels')] }, { wait: 80 }, { text: 'slow answer after tools' }]);
  const c = fake('anthropic', [{ text: 'should not be needed' }]);
  const r = run([o, c], { runTool: tools(), firstOutputMs: 40 });
  assert.equal(text(await collect(r.stream)), 'slow answer after tools');
  assert.equal(c.calls, 0);
});

test('reference markers are parsed once each', () => {
  assert.deepEqual(extractRefMarkers('a [[post:1]] b [[idea:2]] c [[post:1]] [[post:x]]'), [
    { type: 'post', id: 1 },
    { type: 'idea', id: 2 },
  ]);
});
