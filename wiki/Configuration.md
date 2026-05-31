# Configuration

shipyard is configured by environment variables and a handful of code constants. This page lists every knob, what it does, its default, and how to tune it. The defaults are chosen so the project runs and tests itself with nothing set.

## Environment variables

The template is `.env.example`. Copy it to `.env` and adjust.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SHIPYARD_DB_PATH` | `:memory:` | SQLite file path. Unset means in-memory, which is why the test suite is hermetic. Set to a file (`shipyard.db`) to persist across runs. |
| `BILLING_PROVIDER` | `fake` | `fake` uses the in-memory provider; `stripe` selects `StripeBillingProvider`. |
| `STRIPE_SECRET_KEY` | empty | Stripe secret key, only read when `BILLING_PROVIDER=stripe`. |
| `STRIPE_WEBHOOK_SECRET` | empty | Stripe webhook signing secret, used by `parseWebhook`. |
| `STRIPE_PRICE_PRO` | `price_pro_placeholder` | Stripe Price id for the Pro plan. |
| `STRIPE_PRICE_SCALE` | `price_scale_placeholder` | Stripe Price id for the Scale plan. |
| `NODE_ENV` | unset | Set to `production` so the session cookie is marked `secure`. |

Where each is read:

- `SHIPYARD_DB_PATH`: `getDatabase()` in `src/db/client.ts`, and the seed script.
- `BILLING_PROVIDER`: the `provider()` factory in `src/app/api/protected/billing/route.ts`.
- `STRIPE_*`: the `StripeBillingProvider` constructor and `PRICE_IDS` in `src/lib/billing/provider-stripe.ts`.
- `NODE_ENV`: `setSessionCookie` in `src/lib/http.ts`.

There is no central config object that reads these eagerly at boot. Each is read at the point of use, which keeps the surface small and means an unset variable fails where it is needed, not at startup.

## Session lifetime

The session TTL is a constant in `src/lib/auth.ts`:

```ts
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
```

The cookie `maxAge` in `setSessionCookie` is kept in step at `60 * 60 * 24 * 7` seconds. If you change one, change both, so the cookie and the server-side row expire together. A shorter TTL is safer; a longer one trades safety for fewer logins. The cookie attributes (`httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` in production) are set in the same function.

## Password hashing cost

The scrypt parameters are constants in `src/lib/crypto.ts`:

```ts
const N = 16384; // CPU/memory cost
const r = 8;     // block size
const p = 1;     // parallelisation
const KEY_LEN = 64;
```

Because the stored hash is self-describing (`scrypt$N$r$p$salt$hash`), you can raise `N` later without a data migration: existing hashes verify with their stored parameters, new hashes use the new ones. On this machine, `N = 16384` costs about 25 ms per hash (see [Performance](Performance)). If you raise it, re-measure: you want it slow enough to deter offline cracking but fast enough not to be a login bottleneck or a denial-of-service amplifier.

## Rate-limit budgets

`RATE_LIMITS` in `src/lib/rate-limit.ts` defines the budgets per logical route group:

```ts
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth: { capacity: 5,  refillPerSecond: 0.2 },
  api:  { capacity: 60, refillPerSecond: 10 },
};
```

`capacity` is the burst ceiling; `refillPerSecond` is the sustained rate. The `auth` group is tight on purpose to blunt credential stuffing: five attempts, then one token every five seconds. The `api` group allows a burst of sixty and sustains ten per second. Tune per route group and per deployment; the reasoning and the maths for `retryAfterMs` are in [Rate Limiting](Rate-Limiting).

To add a group, add a key to `RATE_LIMITS` and pass `rateLimitGroup` in the route's `GuardOptions`:

```ts
withGuard({ permission: "usage:write", rateLimitGroup: "api" }, handler, req);
```

## Plans and budgets

The plan catalogue in `src/lib/billing/plans.ts` is the place to change pricing and per-metric budgets:

```ts
free:  { pricePerMonth: 0,     budgets: { api_calls: 1000,   seats: 3 } },
pro:   { pricePerMonth: 4900,  budgets: { api_calls: 100000, seats: 25 } },
scale: { pricePerMonth: 29900, budgets: { api_calls: null,   seats: null } },
```

Prices are in minor units (pence). A `null` budget is unlimited. `budgetFor(plan, metric)` returns the budget, or `0` for a metric the plan does not mention, which means an unknown metric is blocked by default rather than allowed. Add a metric by adding it to each plan's `budgets`.

## Protected path prefixes

The middleware decides what is protected from one constant in `src/middleware.ts`:

```ts
const PROTECTED_PREFIXES = ["/app", "/api/protected"];
```

and its `matcher` config restricts where it even runs. If you add a protected surface, add its prefix here and to the `matcher`. The authoritative check still happens in the route via `resolveContext`; this constant only controls the cheap edge gate.

## Build and runtime configuration

- `next.config.ts` marks `node:sqlite` as `serverExternalPackages` so the bundler does not try to inline a built-in module.
- `tsconfig.json` defines the `@/*` path alias to `./src/*`. Tools that do not read it (plain `node`) cannot resolve `@/` imports; run scripts through the provided `pnpm` commands. See [Troubleshooting](Troubleshooting).
- `vitest.config.ts` mirrors the same alias for tests and restricts coverage to `src/lib/**` and `src/db/**`.

## A minimal production .env

```bash
SHIPYARD_DB_PATH=/var/lib/shipyard/shipyard.db   # or your Postgres wiring
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_SCALE=price_...
NODE_ENV=production
```

The full production checklist, including the Postgres swap and the Redis rate-limit store, is in [Deployment](Deployment).

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
