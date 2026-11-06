/**
 * Per-host client-side rate limiting so info9 stays inside the usage
 * policies of the free upstreams it relies on (e.g. Nominatim's 1 req/s).
 * Bookkeeping is separated from sleeping so tests are deterministic.
 */

export interface RateLimitRule {
  /** Maximum requests allowed per window for the host. 0 = unlimited. */
  maxPerWindow: number;
  windowMs: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly defaultRule: RateLimitRule = { maxPerWindow: 0, windowMs: 60_000 },
    private readonly rules: Record<string, RateLimitRule> = {}
  ) {}

  private ruleFor(host: string): RateLimitRule {
    return this.rules[host] ?? this.defaultRule;
  }

  /** How long the caller must wait (ms) before a request to `host` may fire. */
  nextAllowedDelayMs(host: string, now: number = Date.now()): number {
    const rule = this.ruleFor(host);
    if (rule.maxPerWindow <= 0) return 0;
    const timestamps = (this.hits.get(host) ?? []).filter(
      (t) => now - t < rule.windowMs
    );
    this.hits.set(host, timestamps);
    if (timestamps.length < rule.maxPerWindow) return 0;
    const oldest = Math.min(...timestamps);
    return Math.max(0, oldest + rule.windowMs - now);
  }

  /** Records a hit and waits (when needed) until the host allows it. */
  async acquire(
    host: string,
    options: { sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
  ): Promise<void> {
    const now = options.now ?? Date.now;
    for (;;) {
      const delay = this.nextAllowedDelayMs(host, now());
      if (delay === 0) break;
      await (options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))(delay));
    }
    const rule = this.ruleFor(host);
    if (rule.maxPerWindow > 0) {
      const t = now();
      const timestamps = (this.hits.get(host) ?? []).filter(
        (x) => t - x < rule.windowMs
      );
      timestamps.push(t);
      this.hits.set(host, timestamps);
    }
  }
}
