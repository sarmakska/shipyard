import { describe, it, expect } from "vitest";
import {
  RateLimiter,
  MemoryBucketStore,
  rateLimitHeaders,
} from "@/lib/rate-limit";

describe("token-bucket rate limiter", () => {
  it("allows up to the capacity then blocks", () => {
    const limiter = new RateLimiter(
      { capacity: 5, refillPerSecond: 1 },
      new MemoryBucketStore(),
      () => 1000, // frozen clock
    );
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume("tenant-a").allowed).toBe(true);
    }
    const blocked = limiter.consume("tenant-a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time at the configured rate", () => {
    let now = 0;
    const limiter = new RateLimiter(
      { capacity: 2, refillPerSecond: 1 },
      new MemoryBucketStore(),
      () => now,
    );
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(false);

    // Advance one second: one token refills.
    now = 1000;
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(false);
  });

  it("never refills beyond capacity", () => {
    let now = 0;
    const limiter = new RateLimiter(
      { capacity: 3, refillPerSecond: 10 },
      new MemoryBucketStore(),
      () => now,
    );
    limiter.consume("k");
    now = 1_000_000; // a long quiet period
    // Capacity is the burst ceiling: only three are available.
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(true);
    expect(limiter.consume("k").allowed).toBe(false);
  });

  it("isolates buckets by key", () => {
    const limiter = new RateLimiter(
      { capacity: 1, refillPerSecond: 1 },
      new MemoryBucketStore(),
      () => 0,
    );
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
    // A different key has its own full bucket.
    expect(limiter.consume("b").allowed).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(
      () => new RateLimiter({ capacity: 1, refillPerSecond: 0 }),
    ).toThrow();
  });

  it("reports the limit and a reset that shrinks as the bucket drains", () => {
    const limiter = new RateLimiter(
      { capacity: 4, refillPerSecond: 2 },
      new MemoryBucketStore(),
      () => 0, // frozen clock
    );
    // A full bucket needs no reset.
    const first = limiter.consume("k");
    expect(first.limit).toBe(4);
    expect(first.remaining).toBe(3);
    // One token short of full refills in 0.5s at 2 tokens/s.
    expect(first.resetMs).toBe(500);

    const second = limiter.consume("k");
    expect(second.remaining).toBe(2);
    // Two tokens short now: 1s to refill.
    expect(second.resetMs).toBe(1000);
  });

  it("echoes the limit and a non-zero reset once a token is spent", () => {
    const limiter = new RateLimiter(
      { capacity: 5, refillPerSecond: 1 },
      new MemoryBucketStore(),
      () => 0,
    );
    const result = limiter.consume("fresh");
    // One token spent, so reset is non-zero and the limit is echoed.
    expect(result.limit).toBe(5);
    expect(result.resetMs).toBeGreaterThan(0);
  });
});

describe("rateLimitHeaders", () => {
  it("emits standard headers without Retry-After when allowed", () => {
    const headers = rateLimitHeaders({
      allowed: true,
      limit: 60,
      remaining: 42,
      retryAfterMs: 0,
      resetMs: 1800,
    });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("42");
    expect(headers["X-RateLimit-Reset"]).toBe("2"); // 1800ms rounds up to 2s
    expect(headers["Retry-After"]).toBeUndefined();
  });

  it("adds Retry-After when blocked, rounding up to whole seconds", () => {
    const headers = rateLimitHeaders({
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterMs: 2400,
      resetMs: 5000,
    });
    expect(headers["Retry-After"]).toBe("3");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toBe("5");
  });
});
