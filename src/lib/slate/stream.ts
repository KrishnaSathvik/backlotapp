import type { CircuitBreaker } from './breaker.ts';
import { FALLBACK_KINDS, type FailureKind, type ModelUsage, type ProviderId, type RoundResult, type SessionRequest, type SlateProvider } from './providers.ts';
import { TOOL_LIMITS, toolLabel, type EntityRef, type PreferenceProposal, type ToolOutcome } from './tools.ts';
import { ACTION_LIMITS, type ActionDraft, type ActionView } from './actions.ts';

/**
 * Streams one Slate reply to the browser as NDJSON, running read-only tool rounds
 * and failing over between providers when the current one has a capacity problem
 * before any text.
 *
 * Events, one JSON object per line:
 *   {"type":"tool","name":"search_posts","label":"Searching your posts"}
 *   {"type":"delta","text":"…"}
 *   {"type":"refs","refs":[{"type":"post","id":12,"title":"…"}]}      validated references
 *   {"type":"proposal","proposal":{…}}                                 a preference to confirm (not saved)
 *   {"type":"actions","actions":[{…}]}                                 pending changes for the creator to review
 *   {"type":"notice","text":"…"}                                       a short note shown under the reply
 *   {"type":"done","finishReason":"STOP"}
 *   {"type":"error","error":"…"}
 *
 * Rules:
 * - One provider at a time; never parallel calls for the same request.
 * - Fail over only for transient / rate-limit / first-activity-timeout failures,
 *   and only before any text was sent. A fallback starts a fresh session; it never
 *   continues another provider's unfinished tool exchange. Tools are read-only and
 *   suggested actions are only saved (as pending) once a reply succeeds, so a discarded
 *   attempt leaves nothing behind.
 * - Never fail over for user cancellation, invalid requests or bad credentials.
 * - One overall deadline bounds every attempt and tool round.
 * - Tool rounds and calls are capped; results share one character budget.
 * - Refs, proposals and actions are only emitted when a reply completes.
 */

export type { StreamEvent } from './events.ts';
import type { StreamEvent } from './events.ts';

export interface AttemptReport {
  provider: ProviderId;
  model: string;
  outcome: 'success' | 'failed' | 'aborted';
  kind?: FailureKind;
  ms: number;
  ttftMs?: number;
  rounds: number;
  toolCalls: number;
}

export interface ReplyReport {
  status: 'done' | 'error' | 'aborted';
  provider?: ProviderId;
  model?: string;
  /** The model that actually answered, if the provider reported a different one. */
  servedModel?: string;
  /** Anthropic's own refusal fallback ran inside the call. */
  refusalFallback?: boolean;
  /** Providers skipped before any attempt, and why. */
  skipped: { provider: ProviderId; reason: 'circuit_open' }[];
  attempts: AttemptReport[];
  /** Why the first provider was abandoned, when a fallback answered. */
  fallbackReason?: FailureKind;
  chars: number;
  finishReason?: string;
  ttftMs?: number;
  totalMs: number;
  usage?: ModelUsage;
  /** Tool calls in the attempt that answered, by name. */
  tools: string[];
  /** Pending actions saved for the creator to review. */
  actions?: number;
  /** What the browser received: reply text, validated refs, proposals, action ids. */
  text?: string;
  refs?: EntityRef[];
  proposals?: PreferenceProposal[];
  actionIds?: string[];
  /** The reply hit the output cap. */
  cutShort?: boolean;
}

export interface ReplyStreamOptions {
  /** Aborted when the browser disconnects or presses Stop. */
  signal: AbortSignal;
  deadlineMs: number;
  /** A non-final provider must show activity (text or a tool call) by then. */
  firstOutputMs: number;
  fallbackEnabled: boolean;
  /** Fallback providers after the first (Slate: 1, Claude). */
  maxFallbackAttempts: number;
  /** When only one provider is configured: retries of it for capacity failures. */
  sameProviderRetries?: number;
  breaker?: CircuitBreaker;
  /** Runs one tool call for the signed-in creator (validated, read-only). */
  runTool?: (name: string, args: unknown, budget: { chars: number }) => Promise<ToolOutcome>;
  /** References already known safe for this request (e.g. the focused post). */
  knownRefs?: EntityRef[];
  /** Looks up a referenced id the model mentioned but no tool returned (uid-scoped). */
  resolveRef?: (type: 'post' | 'idea', id: number) => Promise<EntityRef | null>;
  /** Sent before anything else (e.g. which conversation this reply belongs to). */
  initialEvents?: StreamEvent[];
  /** Saves suggested actions as pending (uid-scoped) and returns what the browser shows. */
  persistActions?: (drafts: ActionDraft[]) => Promise<ActionView[]>;
  maxRounds?: number;
  describeFailure?: (kind: FailureKind | 'deadline') => string;
  onSettled?: (report: ReplyReport) => void;
  retryDelayMs?: (attempt: number) => number;
  now?: () => number;
}

export function describeFailure(kind: FailureKind | 'deadline'): string {
  switch (kind) {
    case 'deadline':
      return 'Slate took too long to answer. Try again.';
    case 'transient':
    case 'rate_limit':
    case 'timeout':
      return 'Slate is busy right now. Try again in a moment.';
    case 'auth':
    case 'invalid':
      return 'Slate isn’t set up correctly right now. Try again later.';
    default:
      return 'Slate couldn’t answer just now. Try again.';
  }
}

/** The ordered list of attempts for one request. */
export function planAttempts(providers: SlateProvider[], opts: Pick<ReplyStreamOptions, 'fallbackEnabled' | 'maxFallbackAttempts' | 'sameProviderRetries' | 'breaker'>): SlateProvider[] {
  if (!providers.length) return [];
  const ordered = opts.breaker ? opts.breaker.order(providers) : providers;
  const plan = opts.fallbackEnabled ? ordered.slice(0, 1 + Math.max(0, opts.maxFallbackAttempts)) : ordered.slice(0, 1);
  if (plan.length === 1) for (let i = 0; i < (opts.sameProviderRetries ?? 0); i++) plan.push(plan[0]);
  return plan;
}

const REF_MARKER = /\[\[(post|idea):(\d{1,10})\]\]/g;

/** `[[post:12]]` / `[[idea:3]]` markers in a reply, first occurrence order, de-duplicated. */
export function extractRefMarkers(text: string): { type: 'post' | 'idea'; id: number }[] {
  const seen = new Set<string>();
  const out: { type: 'post' | 'idea'; id: number }[] = [];
  for (const m of text.matchAll(REF_MARKER)) {
    const key = `${m[1]}:${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: m[1] as 'post' | 'idea', id: Number(m[2]) });
  }
  return out;
}

const MAX_REFS = 12;

type StreamRequest = Omit<SessionRequest, 'tools'> & { tools?: SessionRequest['tools'] };

export function createReplyStream(providers: SlateProvider[], req: StreamRequest, opts: ReplyStreamOptions): ReadableStream<Uint8Array> {
  const now = opts.now ?? Date.now;
  const encoder = new TextEncoder();
  const cancelled = new AbortController(); // response body cancelled by the consumer
  const deadline = AbortSignal.timeout(opts.deadlineMs);
  const describe = opts.describeFailure ?? describeFailure;
  const maxRounds = Math.max(0, opts.maxRounds ?? TOOL_LIMITS.maxRounds);
  const tools = opts.runTool ? req.tools ?? [] : [];
  const started = now();
  const report: ReplyReport = { status: 'error', attempts: [], chars: 0, totalMs: 0, skipped: [], tools: [] };
  let settled = false;
  const settle = (status: ReplyReport['status']) => {
    if (settled) return;
    settled = true;
    report.status = status;
    report.totalMs = now() - started;
    opts.onSettled?.(report);
  };
  const userStopped = () => opts.signal.aborted || cancelled.signal.aborted;

  return new ReadableStream<Uint8Array>({
    async start(out) {
      const send = (event: StreamEvent) => {
        // Keep what the creator saw, so the server can save the reply exactly.
        if (event.type === 'delta') report.text = (report.text ?? '') + event.text;
        else if (event.type === 'refs') report.refs = event.refs;
        else if (event.type === 'proposal') report.proposals = [...(report.proposals ?? []), event.proposal];
        else if (event.type === 'actions') report.actionIds = event.actions.map((a) => a.id);
        else if (event.type === 'done' && event.finishReason === 'MAX_TOKENS') report.cutShort = true;
        try {
          out.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Consumer already closed the stream.
        }
      };
      for (const event of opts.initialEvents ?? []) send(event);
      const plan = planAttempts(providers, opts);
      for (const p of providers) {
        if (!plan.includes(p) && opts.breaker && !opts.breaker.isAvailable(p.id)) {
          report.skipped.push({ provider: p.id, reason: 'circuit_open' });
          console.warn(`slate skip provider=${p.id} reason=circuit_open state=${opts.breaker.state(p.id)}`);
        }
      }
      if (!plan.length) {
        send({ type: 'error', error: describe('auth') });
        settle('error');
      }

      for (let i = 0; i < plan.length && !settled; i++) {
        const provider = plan[i];
        const isLast = i === plan.length - 1;
        const attemptCtl = new AbortController();
        let firstActivityMissed = false;
        let firstTimer: ReturnType<typeof setTimeout> | null = isLast
          ? null
          : setTimeout(() => {
              firstActivityMissed = true;
              attemptCtl.abort();
            }, opts.firstOutputMs);
        const activity = () => {
          if (firstTimer) {
            clearTimeout(firstTimer);
            firstTimer = null;
          }
        };
        const signal = AbortSignal.any([attemptCtl.signal, cancelled.signal, opts.signal, deadline]);
        const attemptStart = now();
        const attempt: AttemptReport = { provider: provider.id, model: provider.model, outcome: 'failed', ms: 0, rounds: 0, toolCalls: 0 };
        report.attempts.push(attempt);
        opts.breaker?.beginAttempt(provider.id);

        // Per-attempt state: a fallback starts over.
        const knownRefs = new Map<string, EntityRef>((opts.knownRefs ?? []).map((r) => [`${r.type}:${r.id}`, r]));
        const proposals: PreferenceProposal[] = [];
        const drafts: ActionDraft[] = [];
        const budget = { chars: TOOL_LIMITS.totalResultChars };
        const toolNames: string[] = [];
        let replyText = '';
        let usage: ModelUsage | undefined;
        let finishReason = 'STOP';
        let servedModel: string | undefined;
        let refusalFallback = false;

        let failure: FailureKind | 'deadline' | 'user' | null = null;
        try {
          const session = provider.start({ ...req, tools });
          for (let round = 0; ; round++) {
            attempt.rounds = round + 1;
            const allowTools = tools.length > 0 && round < maxRounds;
            let result: RoundResult | null = null;
            for await (const ev of session.round({ signal, allowTools })) {
              if (signal.aborted) break;
              if (ev.type === 'text') {
                if (report.chars === 0) {
                  activity();
                  attempt.ttftMs = now() - attemptStart;
                  report.ttftMs = now() - started;
                }
                report.chars += ev.text.length;
                replyText += ev.text;
                send({ type: 'delta', text: ev.text });
              } else {
                result = ev.result;
              }
            }
            if (signal.aborted || !result) break;

            if (result.usage) {
              usage = { inputTokens: (usage?.inputTokens ?? 0) + result.usage.inputTokens, outputTokens: (usage?.outputTokens ?? 0) + result.usage.outputTokens };
            }
            if (result.servedModel) servedModel = result.servedModel;
            if (result.refusalFallback) refusalFallback = true;
            finishReason = result.finishReason;
            if (!result.toolCalls.length || !allowTools) break;

            // Tool round: the model is active even if it hasn't written text yet.
            activity();
            const outputs: { callId: string; output: string }[] = [];
            for (const [n, call] of result.toolCalls.entries()) {
              if (signal.aborted) break;
              if (n >= TOOL_LIMITS.maxCallsPerRound) {
                outputs.push({ callId: call.id, output: JSON.stringify({ error: 'too_many_calls', message: 'Skipped: too many tool calls in one step.' }) });
                continue;
              }
              attempt.toolCalls += 1;
              toolNames.push(call.name);
              send({ type: 'tool', name: call.name, label: toolLabel(call.name) });
              const outcome = await opts.runTool!(call.name, call.args, budget);
              for (const r of outcome.refs) knownRefs.set(`${r.type}:${r.id}`, r);
              if (outcome.proposal) proposals.push(outcome.proposal);
              for (const d of outcome.actions ?? []) if (drafts.length < ACTION_LIMITS.perReply) drafts.push(d);
              outputs.push({ callId: call.id, output: outcome.output });
            }
            if (signal.aborted) break;
            session.addToolResults(outputs);
            finishReason = 'STOP';
          }
          if (signal.aborted) failure = userStopped() ? 'user' : deadline.aborted ? 'deadline' : firstActivityMissed ? 'timeout' : 'aborted';
        } catch (err) {
          failure = userStopped() ? 'user' : deadline.aborted ? 'deadline' : firstActivityMissed ? 'timeout' : provider.classify(err);
          if (failure === 'aborted') failure = 'user';
          if (failure !== 'user' && failure !== 'timeout' && failure !== 'deadline') {
            console.warn(`slate provider=${provider.id} failed kind=${failure} ${err instanceof Error ? err.message.slice(0, 200) : ''}`);
          }
        } finally {
          if (firstTimer) clearTimeout(firstTimer);
          attempt.ms = now() - attemptStart;
        }

        if (failure === null) {
          attempt.outcome = 'success';
          opts.breaker?.recordSuccess(provider.id);
          report.provider = provider.id;
          report.model = provider.model;
          report.finishReason = finishReason;
          report.usage = usage;
          report.tools = toolNames;
          if (servedModel && servedModel !== provider.model) report.servedModel = servedModel;
          if (refusalFallback) report.refusalFallback = true;
          if (i > 0) report.fallbackReason = report.attempts[0].kind;

          // Only references to the creator's own records survive.
          const refs: EntityRef[] = [];
          for (const m of extractRefMarkers(replyText).slice(0, MAX_REFS)) {
            const known = knownRefs.get(`${m.type}:${m.id}`) ?? (opts.resolveRef ? await opts.resolveRef(m.type, m.id).catch(() => null) : null);
            if (known) refs.push(known);
          }
          if (refs.length) send({ type: 'refs', refs });
          for (const proposal of proposals.slice(0, 3)) send({ type: 'proposal', proposal });
          if (drafts.length && opts.persistActions) {
            try {
              const actions = await opts.persistActions(drafts);
              if (actions.length) send({ type: 'actions', actions });
              report.actions = actions.length;
            } catch (err) {
              console.warn(`slate actions not saved ${err instanceof Error ? err.message.slice(0, 120) : ''}`);
              send({ type: 'notice', text: 'Slate couldn’t prepare its suggested changes. Ask again to see them.' });
            }
          }
          send({ type: 'done', finishReason });
          settle('done');
          break;
        }

        if (failure === 'user' || failure === 'aborted') {
          attempt.outcome = 'aborted';
          opts.breaker?.releaseProbe(provider.id);
          settle('aborted');
          break;
        }

        attempt.kind = failure === 'deadline' ? 'timeout' : failure;
        const capacity = failure === 'deadline' || FALLBACK_KINDS.has(failure);
        if (capacity && report.chars === 0) opts.breaker?.recordFailure(provider.id);
        else opts.breaker?.releaseProbe(provider.id);

        const canFallBack = failure !== 'deadline' && FALLBACK_KINDS.has(failure) && report.chars === 0 && !isLast;
        if (!canFallBack) {
          report.provider = provider.id;
          report.model = provider.model;
          send({ type: 'error', error: describe(failure) });
          settle('error');
          break;
        }
        if (plan[i + 1] === provider) {
          await new Promise((r) => setTimeout(r, opts.retryDelayMs?.(i) ?? 700 * (i + 1)));
        }
      }

      try {
        out.close();
      } catch {
        // Already closed.
      }
    },
    cancel() {
      cancelled.abort();
      settle('aborted');
    },
  });
}

export { readStreamEvents } from './events.ts';
