/**
 * Token-bucket rate limiter.
 *
 * Each key (typically tenant + route, or IP for unauthenticated routes) owns a
 * bucket that refills at a steady rate up to a ceiling. A request costs one
 * token. The bucket model gives smooth throttling with controlled bursts, which
 * is what an API wants: a client that has been quiet can spend its accumulated
 * allowance, but a sustained flood is held to the refill rate.
 *
 * The store is pluggable. The in-memory store below is correct for a single
 * instance and is what the tests exercise. For multi-instance deployments swap
 * in the Redis store sketched in the Rate-Limiting wiki page; the algorithm is
 * identical because all state is (tokens, lastRefill).
 */

export interface RateLimitConfig {
  /** Maximum tokens the bucket can hold. This is the burst ceiling. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** The burst ceiling, echoed so callers can build standard headers. */
  limit: number;
  remaining: number;
  /** Milliseconds until the next token is available, when blocked. */
  retryAfterMs: number;
  /** Milliseconds until the bucket is back at full capacity. */
  resetMs: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface BucketStore {
  get(key: string): Bucket | undefined;
  set(key: string, bucket: Bucket): void;
}

export class MemoryBucketStore implements BucketStore {
  private readonly buckets = new Map<string, Bucket>();
  get(key: string): Bucket | undefined {
    return this.buckets.get(key);
  }
  set(key: string, bucket: Bucket): void {
    this.buckets.set(key, bucket);
  }
  clear(): void {
    this.buckets.clear();
  }
}

export class RateLimiter {
  constructor(
    private readonly config: RateLimitConfig,
    private readonly store: BucketStore = new MemoryBucketStore(),
    // Injected clock keeps the limiter deterministic under test.
    private readonly now: () => number = () => Date.now(),
  ) {
    if (config.capacity <= 0) throw new Error("capacity must be positive");
    if (config.refillPerSecond <= 0) {
      throw new Error("refillPerSecond must be positive");
    }
  }

  private refill(bucket: Bucket): Bucket {
    const now = this.now();
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    const refilled = Math.min(
      this.config.capacity,
      bucket.tokens + elapsedSeconds * this.config.refillPerSecond,
    );
    return { tokens: refilled, lastRefill: now };
  }

  /**
   * Milliseconds until a bucket holding `tokens` refills to full capacity.
   * Zero when the bucket is already full. Used for the X-RateLimit-Reset header.
   */
  private resetMs(tokens: number): number {
    const missing = this.config.capacity - tokens;
    if (missing <= 0) return 0;
    return Math.ceil((missing / this.config.refillPerSecond) * 1000);
  }

  /** Consume one token for `key`. Returns whether the request is allowed. */
  consume(key: string, cost = 1): RateLimitResult {
    const existing =
      this.store.get(key) ??
      ({ tokens: this.config.capacity, lastRefill: this.now() } as Bucket);
    const bucket = this.refill(existing);
    const limit = this.config.capacity;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.store.set(key, bucket);
      return {
        allowed: true,
        limit,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
        resetMs: this.resetMs(bucket.tokens),
      };
    }

    this.store.set(key, bucket);
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(
      (deficit / this.config.refillPerSecond) * 1000,
    );
    return {
      allowed: false,
      limit,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs,
      resetMs: this.resetMs(bucket.tokens),
    };
  }
}

/**
 * Build the standard rate-limit response headers from a limiter result. These
 * follow the widely-adopted X-RateLimit-* convention so any HTTP client can
 * self-throttle ahead of a 429 rather than discovering the limit by hitting it.
 * Reset is expressed in whole seconds, matching the Retry-After unit.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetMs / 1000)),
  };
  if (!result.allowed) {
    headers["Retry-After"] = String(Math.ceil(result.retryAfterMs / 1000));
  }
  return headers;
}

/** Default budgets keyed by a logical route group. Tune per deployment. */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Authentication is the most abused surface, so it is the tightest.
  auth: { capacity: 5, refillPerSecond: 0.2 },
  // General read/write API.
  api: { capacity: 60, refillPerSecond: 10 },
};
