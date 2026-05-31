import { describe, it, expect } from "vitest";
import {
  RateLimiter,
  MemoryBucketStore,
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
});
