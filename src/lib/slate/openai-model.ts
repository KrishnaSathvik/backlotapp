import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';
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
import { partText } from './prompt.ts';

/**
 * OpenAI provider (Slate's primary; GPT-6.1 Sol by default) via the streaming
 * Responses API with function tools. Reasoning effort is set per task from the
 * shared task effort; SLATE_OPENAI_EFFORT_<TASK> overrides it for OpenAI only.
 *
 * Multi-round tool use with store:false: each response's output items (including
 * encrypted reasoning items, requested via `include`) are appended to the input
 * unchanged, followed by our function_call_output items.
 */

type OpenAIEffort = 'low' | 'medium' | 'high';

function effortFor(task: SessionRequest['task'], env: Record<string, string | undefined> = process.env): OpenAIEffort {
  const override = env[`SLATE_OPENAI_EFFORT_${task.toUpperCase()}`]?.toLowerCase();
  if (override === 'low' || override === 'medium' || override === 'high') return override;
  return taskConfig(task, env).effort;
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { __invalid_json: true };
  }
}

export function createOpenAIProvider(apiKey: string, model: string): SlateProvider {
  // Retries are Slate's job (failover), not the SDK's.
  const client = new OpenAI({ apiKey, maxRetries: 0 });

  return {
    id: 'openai',
    model,
    start(req: SessionRequest): ProviderSession {
      const input: ResponseInputItem[] = req.contents.map((c) => {
        const role = c.role === 'model' ? ('assistant' as const) : ('user' as const);
        if (!c.parts.some((p) => 'image' in p)) return { role, content: c.parts.map(partText).join('\n\n') };
        // An explicitly chosen image travels inline as data (never a storage URL).
        return {
          role: 'user' as const,
          content: c.parts.map((p) =>
            'image' in p
              ? { type: 'input_image' as const, image_url: `data:${p.image.mediaType};base64,${p.image.data}`, detail: 'auto' as const }
              : { type: 'input_text' as const, text: p.text }
          ),
        };
      });
      const tools = req.tools.map((t) => ({ type: 'function' as const, name: t.name, description: t.description, parameters: t.parameters, strict: false }));

      return {
        async *round({ signal, allowTools }): AsyncIterable<RoundEvent> {
          const stream = await client.responses.create(
            {
              model,
              instructions: req.systemInstruction,
              input,
              ...(tools.length ? { tools, tool_choice: allowTools ? ('auto' as const) : ('none' as const) } : {}),
              reasoning: { effort: effortFor(req.task) },
              max_output_tokens: req.maxOutputTokens,
              store: false,
              include: ['reasoning.encrypted_content'],
              stream: true,
            },
            { signal }
          );
          for await (const event of stream) {
            if (signal.aborted) return;
            switch (event.type) {
              case 'response.output_text.delta':
                if (event.delta) yield { type: 'text', text: event.delta };
                break;
              case 'response.refusal.delta':
                if (event.delta) yield { type: 'text', text: event.delta };
                break;
              case 'response.completed':
              case 'response.incomplete': {
                const res = event.response;
                // Keep everything the model produced (reasoning, calls, messages) for the next round.
                input.push(...(res.output as unknown as ResponseInputItem[]));
                const calls: ToolCall[] = res.output
                  .filter((o): o is Extract<typeof o, { type: 'function_call' }> => o.type === 'function_call')
                  .map((o) => ({ id: o.call_id, name: o.name, args: parseArgs(o.arguments) }));
                const incomplete = event.type === 'response.incomplete';
                const reason = res.incomplete_details?.reason;
                yield {
                  type: 'end',
                  result: {
                    // A truncated response may carry half-written calls: never run them.
                    toolCalls: incomplete ? [] : calls,
                    finishReason: incomplete
                      ? reason === 'max_output_tokens'
                        ? 'MAX_TOKENS'
                        : reason === 'content_filter'
                        ? 'REFUSAL'
                        : String(reason ?? 'INCOMPLETE')
                      : calls.length
                      ? 'TOOL_CALLS'
                      : 'STOP',
                    usage: res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : undefined,
                  },
                };
                return;
              }
              case 'response.failed':
                throw Object.assign(new Error(event.response.error?.message ?? 'OpenAI response failed'), { code: event.response.error?.code });
              case 'error':
                throw Object.assign(new Error(event.message ?? 'OpenAI stream error'), { code: event.code });
            }
          }
        },
        addToolResults(results) {
          for (const r of results) input.push({ type: 'function_call_output', call_id: r.callId, output: r.output });
        },
      };
    },
    classify(err: unknown): FailureKind {
      if (err instanceof OpenAI.APIUserAbortError) return 'aborted';
      if (err instanceof OpenAI.APIConnectionTimeoutError) return 'timeout';
      if (err instanceof OpenAI.APIConnectionError) return 'transient';
      if (err instanceof OpenAI.APIError) return classifyStatus(err.status) ?? 'unknown';
      const code = String((err as { code?: unknown })?.code ?? '');
      if (/rate_limit|insufficient_quota/.test(code)) return 'rate_limit';
      if (/server_error|overloaded|unavailable/.test(code)) return 'transient';
      return classifyGenericError(err);
    },
  };
}
