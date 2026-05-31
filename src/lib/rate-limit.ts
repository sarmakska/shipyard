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
  remaining: number;
  /** Milliseconds until the next token is available, when blocked. */
  retryAfterMs: number;
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

  /** Consume one token for `key`. Returns whether the request is allowed. */
  consume(key: string, cost = 1): RateLimitResult {
    const existing =
      this.store.get(key) ??
      ({ tokens: this.config.capacity, lastRefill: this.now() } as Bucket);
    const bucket = this.refill(existing);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      this.store.set(key, bucket);
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
      };
    }

    this.store.set(key, bucket);
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(
      (deficit / this.config.refillPerSecond) * 1000,
    );
    return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs };
  }
}

/** Default budgets keyed by a logical route group. Tune per deployment. */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Authentication is the most abused surface, so it is the tightest.
  auth: { capacity: 5, refillPerSecond: 0.2 },
  // General read/write API.
  api: { capacity: 60, refillPerSecond: 10 },
};
