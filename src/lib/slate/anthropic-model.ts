import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  classifyGenericError,
  classifyStatus,
  type FailureKind,
  type ProviderSession,
  type RoundEvent,
  type SessionRequest,
  type SlateProvider,
  type ToolCall,
} from './providers.ts';
import { taskConfig } from './tasks.ts';

/**
 * Anthropic provider (Slate's fallback; Claude Opus 5.5 by default) via streaming
 * Messages with client tools.
 *
 * Thinking is always on for claude-opus-5-5 (adaptive); depth is controlled with
 * output_config.effort, whose model default is `medium`, so it's set explicitly
 * per task (SLATE_ANTHROPIC_EFFORT_<TASK> overrides).
 *
 * Tool rounds: the assistant's full content (thinking, text, tool_use and any
 * fallback blocks) is appended unchanged, then one user message with every
 * tool_result. Tool calls are never run when the round stopped at max_tokens or
 * on a refusal. Tool input streaming is left buffered: Slate's tool inputs are
 * a few tokens, and the tool layer validates every input anyway.
 *
 * Refusals (SLATE_ANTHROPIC_REFUSAL_FALLBACK, default on): with Anthropic's
 * server-side fallbacks (`fallbacks: "default"`), a safety-classifier decline is
 * re-run inside the same call on a fallback model Anthropic picks by refusal
 * category. That reply is billed at the fallback model's rates (a mid-stream
 * decline also bills the declined part at normal rates). We surface it as
 * `refusalFallback` plus the model that actually answered, so diagnostics show it
 * and cost isn't estimated at Opus rates. If the whole chain declines, the stop
 * reason is `refusal`, surfaced as REFUSAL. This is separate from Slate's own
 * OpenAI → Claude failover, which never triggers on refusals.
 */

type AnthropicEffort = 'low' | 'medium' | 'high';

const refusalFallbackEnabled = (env: Record<string, string | undefined> = process.env) =>
  (env.SLATE_ANTHROPIC_REFUSAL_FALLBACK ?? 'true').toLowerCase() !== 'false';

function effortFor(task: SessionRequest['task'], env: Record<string, string | undefined> = process.env): AnthropicEffort {
  const override = env[`SLATE_ANTHROPIC_EFFORT_${task.toUpperCase()}`]?.toLowerCase();
  if (override === 'low' || override === 'medium' || override === 'high') return override;
  return taskConfig(task, env).effort;
}

export function createAnthropicProvider(apiKey: string, model: string): SlateProvider {
  // Retries are Slate's job (failover), not the SDK's.
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  return {
    id: 'anthropic',
    model,
    start(req: SessionRequest): ProviderSession {
      const messages: BetaMessageParam[] = req.contents.map((c) => ({
        role: c.role === 'model' ? ('assistant' as const) : ('user' as const),
        content: c.parts.map((p) =>
          'image' in p
            ? { type: 'image' as const, source: { type: 'base64' as const, media_type: p.image.mediaType, data: p.image.data } }
            : { type: 'text' as const, text: p.text }
        ),
      }));
      const tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

      return {
        async *round({ signal, allowTools }): AsyncIterable<RoundEvent> {
          const stream = client.beta.messages.stream(
            {
              model,
              max_tokens: req.maxOutputTokens,
              system: req.systemInstruction,
              messages,
              ...(tools.length ? { tools, tool_choice: allowTools ? { type: 'auto' as const } : { type: 'none' as const } } : {}),
              output_config: { effort: effortFor(req.task) },
              ...(refusalFallbackEnabled() ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
            },
            { signal }
          );
          for await (const event of stream) {
            if (signal.aborted) return;
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
              yield { type: 'text', text: event.delta.text };
            }
          }
          const final = await stream.finalMessage();
          // Keep the assistant turn exactly as returned, for the next round.
          messages.push({ role: 'assistant', content: final.content as unknown as NonNullable<BetaMessageParam['content']> });
          const reason = final.stop_reason;
          const calls: ToolCall[] =
            reason === 'tool_use'
              ? final.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input }))
              : [];
          yield {
            type: 'end',
            result: {
              toolCalls: calls,
              finishReason: reason === 'max_tokens' ? 'MAX_TOKENS' : reason === 'refusal' ? 'REFUSAL' : calls.length ? 'TOOL_CALLS' : 'STOP',
              usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
              servedModel: String(final.model),
              refusalFallback: (final.usage.iterations ?? []).some((i) => i.type === 'fallback_message'),
            },
          };
        },
        addToolResults(results) {
          const content: BetaToolResultBlockParam[] = results.map((r) => ({ type: 'tool_result', tool_use_id: r.callId, content: r.output }));
          messages.push({ role: 'user', content });
        },
      };
    },
    classify(err: unknown): FailureKind {
      if (err instanceof Anthropic.APIUserAbortError) return 'aborted';
      if (err instanceof Anthropic.APIConnectionError) return 'transient';
      if (err instanceof Anthropic.RateLimitError) return 'rate_limit';
      if (err instanceof Anthropic.APIError) {
        if (err.type === 'overloaded_error') return 'transient';
        return classifyStatus(err.status) ?? 'unknown';
      }
      return classifyGenericError(err);
    },
  };
}
