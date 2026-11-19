/**
 * Per-provider circuit breaker.
 *
 * closed     normal routing
 * open       after `threshold` capacity failures within `windowMs`: skipped for `cooldownMs`
 * half-open  after the cooldown: one probe request is allowed; success closes, failure reopens
 *
 * State lives in this server process for fast routing decisions; SharedBreakerState
 * (shared-limits.ts) shares failures between instances and calls adoptOpen() so an
 * instance skips a provider other instances found failing. The breaker only reorders
 * providers; it never blocks the last available one.
 * Only capacity failures count: bad credentials are not outages.
 */
export class CircuitBreaker {
  private failures = new Map<string, number[]>();
  private openUntil = new Map<string, number>();
  private probing = new Set<string>();
  readonly threshold: number;
  readonly windowMs: number;
  readonly cooldownMs: number;
  private now: () => number;
  private onTransition?: (id: string, to: 'open' | 'closed', why: 'failures' | 'probe_failed' | 'shared' | 'success') => void;

  constructor(
    opts: {
      threshold?: number;
      windowMs?: number;
      cooldownMs?: number;
      now?: () => number;
      /** Observability hook (state changes only; never throws into routing). */
      onTransition?: (id: string, to: 'open' | 'closed', why: 'failures' | 'probe_failed' | 'shared' | 'success') => void;
    } = {}
  ) {
    this.threshold = opts.threshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.onTransition = opts.onTransition;
  }

  private emit(id: string, to: 'open' | 'closed', why: 'failures' | 'probe_failed' | 'shared' | 'success') {
    try {
      this.onTransition?.(id, to, why);
    } catch {
      // Logging must never affect routing.
    }
  }

  state(id: string): 'closed' | 'open' | 'half-open' {
    const until = this.openUntil.get(id);
    if (until === undefined) return 'closed';
    return this.now() < until ? 'open' : 'half-open';
  }

  /** Whether a new request may be routed here (does not reserve the probe). */
  isAvailable(id: string): boolean {
    const s = this.state(id);
    return s === 'closed' || (s === 'half-open' && !this.probing.has(id));
  }

  /** Call right before sending a request. Reserves the single half-open probe. */
  beginAttempt(id: string) {
    if (this.state(id) === 'half-open') this.probing.add(id);
  }

  recordSuccess(id: string) {
    if (this.openUntil.has(id)) this.emit(id, 'closed', 'success');
    this.failures.delete(id);
    this.openUntil.delete(id);
    this.probing.delete(id);
  }

  recordFailure(id: string) {
    const t = this.now();
    if (this.state(id) === 'half-open') {
      this.probing.delete(id);
      this.openUntil.set(id, t + this.cooldownMs);
      this.emit(id, 'open', 'probe_failed');
      return;
    }
    const recent = (this.failures.get(id) ?? []).filter((f) => t - f < this.windowMs);
    recent.push(t);
    this.failures.set(id, recent);
    if (recent.length >= this.threshold) {
      this.openUntil.set(id, t + this.cooldownMs);
      this.failures.delete(id);
      this.emit(id, 'open', 'failures');
    }
  }

  /** Opens the provider until `untilMs` (from shared state), unless already open longer. */
  adoptOpen(id: string, untilMs: number) {
    if (untilMs <= this.now()) return;
    if ((this.openUntil.get(id) ?? 0) >= untilMs) return;
    if (this.state(id) === 'closed') this.emit(id, 'open', 'shared');
    this.openUntil.set(id, untilMs);
    this.failures.delete(id);
  }

  /** Releases a reserved probe that ended without a verdict (e.g. the user cancelled). */
  releaseProbe(id: string) {
    this.probing.delete(id);
  }

  /** Available providers in priority order; if none are available, the full order. */
  order<T extends { id: string }>(providers: T[]): T[] {
    const ready = providers.filter((p) => this.isAvailable(p.id));
    return ready.length ? ready : providers;
  }
}
