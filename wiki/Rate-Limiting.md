# Rate Limiting

shipyard throttles the API with a token-bucket limiter. This page explains the algorithm, the configuration and how to scale it across instances.

## Why token bucket

A token bucket gives smooth throttling with controlled bursts, which is what an API wants. Each key owns a bucket that refills at a steady rate up to a ceiling. A request costs one token. A client that has been quiet can spend its accumulated allowance in a burst, but a sustained flood is held to the refill rate. Compared with a fixed window, it avoids the double-rate spike at a window boundary; compared with a sliding-window log, it needs only two numbers per key.

## The implementation

`src/lib/rate-limit.ts`. The entire state of a bucket is `(tokens, lastRefill)`. On each request the bucket is refilled based on elapsed time, then a token is taken if one is available:

```ts
private refill(bucket: Bucket): Bucket {
  const now = this.now();
  const elapsedSeconds = (now - bucket.lastRefill) / 1000;
  const refilled = Math.min(
    this.config.capacity,
    bucket.tokens + elapsedSeconds * this.config.refillPerSecond,
  );
  return { tokens: refilled, lastRefill: now };
}
```

`capacity` is the burst ceiling and `refillPerSecond` is the sustained rate. When a request is blocked, the result includes `retryAfterMs`, computed from the token deficit and the refill rate, which the route surfaces as a `Retry-After` header.

### Injectable clock

The limiter takes a `now()` function. In production it defaults to `Date.now`; in tests it is a frozen or hand-advanced clock, which is what makes the refill behaviour deterministic and fast to test without sleeping.

## Configuration

`RATE_LIMITS` defines budgets per logical route group:

```ts
export const RATE_LIMITS = {
  // Authentication is the most abused surface, so it is the tightest.
  auth: { capacity: 5,  refillPerSecond: 0.2 },
  // General read/write API.
  api:  { capacity: 60, refillPerSecond: 10 },
};
```

`auth` allows five attempts then refills one token every five seconds, which blunts credential stuffing. `api` allows a burst of sixty then sustains ten per second.

## How it is applied

`withGuard` in `src/lib/http.ts` consumes a token before the handler runs, keyed by `organisationId:routeGroup`, so each tenant has its own budget on each route group:

```ts
const result = limiter.consume(`${ctx.organisationId}:${group}`);
if (!result.allowed) {
  return NextResponse.json({ error: "rate_limited" }, {
    status: 429,
    headers: {
      "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
      "X-RateLimit-Remaining": String(result.remaining),
    },
  });
}
```

Unauthenticated routes (signup, login) limit by IP instead, because there is no tenant yet.

## Scaling across instances

The default `MemoryBucketStore` is correct for a single instance. Behind several instances each would keep its own buckets, so the effective limit would multiply by the instance count. The store is an interface for exactly this reason:

```ts
export interface BucketStore {
  get(key: string): Bucket | undefined;
  set(key: string, bucket: Bucket): void;
}
```

A Redis-backed store implements the same two methods, ideally with the refill-and-take done atomically in a small Lua script so concurrent requests across instances cannot both spend the last token. The algorithm does not change, because all state is `(tokens, lastRefill)`; only where that pair lives changes.

## Tests

`tests/rate-limit.test.ts` proves the limiter allows up to capacity then blocks, refills at the configured rate over a hand-advanced clock, never refills beyond the ceiling, isolates buckets by key, and rejects invalid configuration.
