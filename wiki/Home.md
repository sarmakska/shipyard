# shipyard

A production-grade multi-tenant SaaS starter: organisations, RBAC, billing, audit log and rate limiting done properly.

shipyard is the foundation I start a B2B SaaS product on. It gets the parts that are tedious and easy to get wrong right from the first commit: strict tenant isolation, session authentication, permission-based access control, an audit trail, rate limiting and a billing scaffold. It is built on Next.js 16 with TypeScript, and it installs, builds and tests on any machine with no external services because the data layer sits behind a typed repository backed by the built-in `node:sqlite`. The same repository interface swaps onto Postgres in production.

## Start here

- [Architecture](Architecture) is the end-to-end picture: how a request flows through middleware, tenant resolution, authentication, rate limiting and RBAC into the service layer.
- [Multi-Tenancy](Multi-Tenancy) explains the isolation guarantee and the single chokepoint that enforces it.
- [Auth and RBAC](Auth-and-RBAC) covers session handling, password hashing and the permission model.
- [Billing](Billing) describes plans, the subscription state machine, usage budgets and the provider interface.
- [Audit Log](Audit-Log) covers what is recorded and how to query it.
- [Rate Limiting](Rate-Limiting) explains the token-bucket algorithm and how to scale it across instances.
- [Deployment](Deployment) is the production path, including the Postgres swap.
- [Troubleshooting](Troubleshooting) collects the issues you are most likely to hit.

## Quickstart

```bash
pnpm install
SHIPYARD_DB_PATH=shipyard.db pnpm seed
pnpm test
pnpm build
SHIPYARD_DB_PATH=shipyard.db pnpm dev
```

Then open `http://localhost:3000/login` and sign in with `owner@acme.test` / `password-acme-123`.

## Design principles

1. **One chokepoint for tenant data.** Every tenant-scoped read and write goes through a single repository that injects the tenant id. There is no second path to forget.
2. **Fail closed.** A missing permission, an unknown session or a user with no membership in the active tenant all result in a refusal, never a fall-through.
3. **Inject the awkward dependencies.** The rate limiter takes a clock, the billing service takes a provider. That is what makes the hard paths testable.
4. **No service required to run the tests.** The whole suite runs against fresh in-memory SQLite databases, so the guarantees are verified anywhere.
