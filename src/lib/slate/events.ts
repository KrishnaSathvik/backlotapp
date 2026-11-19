import type { EntityRef, PreferenceProposal } from './tools.ts';
import type { ActionView } from './actions.ts';

/** Slate's NDJSON stream events (shared by the server stream and the browser reader). */
export type StreamEvent =
  | { type: 'conversation'; id: string; title: string }
  | { type: 'tool'; name: string; label: string }
  | { type: 'delta'; text: string }
  | { type: 'refs'; refs: EntityRef[] }
  | { type: 'proposal'; proposal: PreferenceProposal }
  | { type: 'actions'; actions: ActionView[] }
  | { type: 'notice'; text: string }
  | { type: 'done'; finishReason: string }
  | { type: 'error'; error: string };

/** Parses NDJSON events from a streamed response body (used by the browser). */
export async function* readStreamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as StreamEvent;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Removes `[[post:ID]]` / `[[idea:ID]]` reference markers (and a trailing partial
 * marker mid-stream) from text shown or copied in the browser. Validated references
 * arrive separately as a `refs` event.
 */
export function stripRefMarkers(text: string): string {
  return text
    .replace(/[ \t]?\[\[(post|idea):\d{1,10}\]\]/g, '')
    .replace(/[ \t]?\[\[[a-z]*:?\d*\]?$/, '');
}
