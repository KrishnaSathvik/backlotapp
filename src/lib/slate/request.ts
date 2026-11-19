import type { SlateFocus } from './types.ts';
import { parseImageRequest, type ImageRequest } from './images.ts';

/** Validation and bounds for one Slate chat request. */

export const REQUEST_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxTurns: 30,
  maxTurnChars: 8000,
  maxTotalChars: 48_000,
} as const;

export class SlateRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ParsedChatRequest {
  /** The saved conversation to continue, or null to start one. */
  conversationId: string | null;
  /** The creator's new message. Earlier turns are loaded from the database. */
  message: string;
  focus: SlateFocus | null;
  channelId: number | null;
  /** One image the creator explicitly picked for this message, if any. */
  image: ImageRequest | null;
}

const MAX_INT4 = 2_147_483_647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function parseId(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_INT4) {
    throw new SlateRequestError(`${field} must be a valid id.`);
  }
  return value;
}

/**
 * The browser sends only the new message plus ids. History comes from the saved
 * conversation on the server, so a client can't rewrite earlier turns (or invent
 * Slate replies) to steer the model.
 */
export function parseChatRequest(body: unknown): ParsedChatRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SlateRequestError('Invalid request.');
  const b = body as Record<string, unknown>;
  if ('context' in b) throw new SlateRequestError('Slate builds its own context. Send focus and channelId instead.');
  if ('messages' in b) throw new SlateRequestError('Backlot was updated. Refresh the page to keep chatting.', 409);
  for (const k of Object.keys(b)) {
    if (!['conversationId', 'message', 'focus', 'channelId', 'image'].includes(k)) throw new SlateRequestError(`Unknown field "${k}".`);
  }

  if (typeof b.message !== 'string' || !b.message.trim()) throw new SlateRequestError('Please enter a message.');
  if (b.message.length > REQUEST_LIMITS.maxTurnChars) throw new SlateRequestError(`Messages can be up to ${REQUEST_LIMITS.maxTurnChars} characters.`);

  let conversationId: string | null = null;
  if (b.conversationId !== undefined && b.conversationId !== null) {
    if (typeof b.conversationId !== 'string' || !UUID.test(b.conversationId)) throw new SlateRequestError('Invalid conversation.');
    conversationId = b.conversationId;
  }

  let focus: SlateFocus | null = null;
  if (b.focus !== undefined && b.focus !== null) {
    if (typeof b.focus !== 'object') throw new SlateRequestError('Invalid focus.');
    const f = b.focus as Record<string, unknown>;
    if (f.type !== 'post' && f.type !== 'idea') throw new SlateRequestError('Focus must be a post or an idea.');
    focus = { type: f.type, id: parseId(f.id, 'Focus id') };
  }

  const channelId = b.channelId === undefined || b.channelId === null ? null : parseId(b.channelId, 'Channel id');

  const image = parseImageRequest(b.image);
  if (image === 'invalid') throw new SlateRequestError('Invalid image selection.');

  return { conversationId, message: b.message.trim(), focus, channelId, image };
}

/**
 * Per-user request rate and concurrency limits, kept in this server process.
 * Cloud Run can run several instances, so this is a floor, not a guarantee:
 * move it to a shared store (e.g. Redis or Postgres) before a wider rollout.
 */
export class UsageLimiter {
  private hits = new Map<string, number[]>();
  private active = new Map<string, number>();
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly maxConcurrent: number;
  private now: () => number;

  constructor(maxRequests: number, windowMs: number, maxConcurrent: number, now: () => number = Date.now) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxConcurrent = maxConcurrent;
    this.now = now;
  }

  /** Returns null when allowed (and records the request), or a reason to refuse. */
  acquire(uid: string): null | { reason: 'rate'; retryAfterSec: number } | { reason: 'busy' } {
    if ((this.active.get(uid) ?? 0) >= this.maxConcurrent) return { reason: 'busy' };
    const t = this.now();
    const recent = (this.hits.get(uid) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.maxRequests) {
      this.hits.set(uid, recent);
      return { reason: 'rate', retryAfterSec: Math.ceil((recent[0] + this.windowMs - t) / 1000) };
    }
    recent.push(t);
    this.hits.set(uid, recent);
    this.active.set(uid, (this.active.get(uid) ?? 0) + 1);
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) if (!v.some((h) => t - h < this.windowMs)) this.hits.delete(k);
    }
    return null;
  }

  release(uid: string) {
    const n = (this.active.get(uid) ?? 1) - 1;
    if (n <= 0) this.active.delete(uid);
    else this.active.set(uid, n);
  }
}
