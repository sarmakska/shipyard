# Performance

Real numbers from my machine, an **Apple M3 Pro running Node v25.9.0**. Every figure here came from running the code on that machine; none is estimated. Where you can reproduce a number, the command is given.

shipyard is a spine, not a hot path, so the honest framing is this: the parts that do real work (scrypt, HMAC) are deliberately costed, and everything else (the repository, the rate limiter, context resolution) is cheap enough that it will never be your bottleneck. The numbers below back that up.

## Test suite

The whole suite runs against fresh in-memory SQLite databases, one per file, so there is no shared state and no service to wait on.

```text
$ pnpm test
 Test Files  6 passed (6)
      Tests  29 passed (29)
   Duration  460ms

$ /usr/bin/time -p pnpm test   # whole command, three runs
real 1.04
real 1.04
real 1.05
```

The ~460 ms vitest duration is the in-process figure (transform, import and the tests themselves); the ~1.04 s wall-clock includes pnpm and Node process spin-up. Six suites, 29 tests, no flakiness across runs.

## Password hashing (scrypt)

This is the most expensive operation in the project, and that is the point: a password hash should be slow. Measured over 20 hashes with the shipped parameters (`N=16384, r=8, p=1, keylen=64`):

```text
scrypt hashPassword avg ms: 24.94
```

So a login or signup spends roughly **25 ms** in the hash. That is a deliberate cost: fast enough that a real login is imperceptible, slow enough that offline cracking of a leaked hash is expensive. It is also why the `auth` rate limit is tight, so the hash cannot be used as a CPU-amplification lever. If you raise `N`, re-measure; the cost roughly doubles with each doubling of `N`. The parameters live in `src/lib/crypto.ts` and travel with the hash, so a change needs no data migration (see [Configuration](Configuration)).

## Webhook signature verification (HMAC-SHA256)

The Stripe webhook check computes one HMAC-SHA256 over `timestamp.payload` and compares in constant time. Measured over 100,000 iterations on a representative payload:

```text
hmac verify ops/sec: 840006
```

About **840,000 verifications per second**, roughly 1.2 microseconds each. Signature verification is never going to be the limit on a webhook endpoint; the network and the downstream `applyEvent` write dominate by orders of magnitude. The constant-time comparison (`timingSafeEqual`) is what matters here for correctness, not throughput; see [Security Model](Security-Model).

## Rate limiter

The limiter's whole state is `(tokens, lastRefill)` and `consume` is a map lookup, an arithmetic refill and a map set. Measured over 1,000,000 `consume` calls across 1,024 keys with an in-memory store:

```text
rate-limiter consume ops/sec: 14841493
```

Just under **15 million consume calls per second**. The limiter will not be a bottleneck on a single instance. The cost of correctness at scale is not CPU but coordination: a Redis-backed store adds a network round trip per call, which is why the algorithm is kept to two numbers so the round trip can be a single atomic Lua script. See [Rate Limiting](Rate-Limiting).

## Where the time actually goes

Putting the three together for a single authenticated request:

| Stage | Order of cost | Notes |
| --- | --- | --- |
| scrypt (login/signup only) | ~25 ms | the one expensive operation, by design |
| HMAC (webhook only) | ~1.2 us | negligible against the network |
| rate-limiter consume | ~67 ns | negligible |
| repository read/write | sub-millisecond on SQLite | one prepared statement, parameterised |
| context resolution | sub-millisecond | a session lookup and a membership lookup |

The single design conclusion: cost lives where it should (the password hash) and nowhere else. The isolation and authorisation machinery is essentially free per request.

## Reproducing the microbenchmarks

The scrypt, HMAC and limiter figures came from a short script using `node:crypto` and `process.hrtime.bigint()`, run with the same Node version as the project. The test figures came from `pnpm test` and `/usr/bin/time -p pnpm test`. Your numbers will differ with CPU and Node version; the shape (scrypt dominant, everything else cheap) will not.

## A note on SQLite versus Postgres

These numbers are on `node:sqlite`, which is the dev and test path. Production runs on Postgres behind the same repository, where per-statement latency includes a network hop to the database and the figures change accordingly. The repository builds one prepared, parameterised statement per call either way, so the query shape does not change; only where it executes does. See [Deployment](Deployment).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
