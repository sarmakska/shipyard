# Roadmap and limitations

A starter earns trust by being honest about its edges. This page is what I plan to add, what I have decided against, and the limitations you should know before you build on it.

## What I will add

- **Invitations by email token.** Today a membership is created directly. A proper invite flow issues a single-use token, emails it, and creates the membership on acceptance. The audit action (`members.invite`) and the permission (`members:invite`) already exist; the missing piece is the token table and the acceptance route.
- **A Postgres repository implementation.** The `Repository` interface is the seam. I want a `PostgresRepository` shipped alongside the SQLite one so the production swap is a configuration choice, not a rewrite. The SQL the repository builds is already standard parameterised SQL.
- **A Redis `BucketStore`.** The rate limiter is correct on a single instance. A Redis-backed store with the refill-and-take in a small Lua script makes it correct behind several instances. The algorithm does not change because all state is `(tokens, lastRefill)`.

## What I might add

- **Organisation switching in the session.** The schema already supports a user belonging to many organisations; the session records the active one. A switch route plus a tenant picker in the dashboard would expose it.
- **Per-tenant feature flags.** A small flags table keyed by tenant, read through the same scoped repository.

## What I will not add

- **An ORM.** The isolation guarantee depends on one narrow, readable path to tenant data. An ORM hides the `WHERE` clause the guarantee rests on.
- **A bundled payment SDK.** The Stripe adapter is a seam with real signature verification. Bundling the SDK into a starter forces a dependency and a vendor on every user. You add it when you go live.
- **A UI kit.** The settings dashboard exists to prove the wiring. Your product should choose its own design system.

## Limitations to know now

- **SQLite is for dev and tests, not production.** It exists so the project installs and proves itself with nothing running. Move to Postgres for production; see [Deployment](Deployment).
- **The Stripe adapter needs the SDK for live calls.** Webhook verification is real and tested; `createCustomer`, `createSubscription` and `cancelSubscription` throw until you fill them in. See [Billing](Billing).
- **Rate limiting is single-instance by default.** Behind several instances the effective limit multiplies until you wire the Redis store. See [Rate Limiting](Rate-Limiting).
- **Not for single-tenant apps.** If you are not multi-tenant, the tenancy machinery is pure overhead.

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
