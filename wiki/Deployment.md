# Deployment

This page covers running shipyard in production: the Postgres swap, environment, sessions at scale, and the billing go-live.

## The data layer swap

In development and tests the data layer is backed by `node:sqlite` through a typed repository. The repository is the seam: nothing above `src/db/` knows what database is underneath.

To move to Postgres:

1. Add a Postgres driver, for example `pg` or `postgres`.
2. Implement the `Repository` method bodies against a connection pool. The method shapes (`insertScoped`, `selectScoped`, `updateScoped` and the global equivalents) stay identical; only the statement execution changes. The SQL the repository builds is already standard parameterised SQL.
3. Translate the schema in `src/db/schema.ts` to Postgres column types (`TEXT`, `BIGINT`, `BOOLEAN`) and run it as a migration. The `TableDef` descriptors already capture primary keys, not-null, unique and foreign keys.
4. Point `getDatabase` at the pool instead of a SQLite file.

Because the repository is the only path to tenant data, this is a contained change.

### Row-level security as defence in depth

On Postgres you can add row-level security as a second layer beneath the application guard:

```sql
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (organisation_id = current_setting('app.current_org')::text);
```

Set `app.current_org` from the resolved context at the start of each request's transaction. Now even a query that bypasses the repository is constrained by the database. The application-level injection remains the primary guard; RLS is the backstop.

## Environment

Set these in production (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `SHIPYARD_DB_PATH` | SQLite file path in dev; replaced by your connection string wiring in production |
| `BILLING_PROVIDER` | `fake` or `stripe` |
| `STRIPE_SECRET_KEY` | Stripe secret key when `BILLING_PROVIDER=stripe` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_SCALE` | Stripe Price ids for the paid plans |
| `NODE_ENV` | set to `production` so the session cookie is marked `secure` |

## Build and run

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The CI workflow in `.github/workflows/ci.yml` runs lint, test and build on Node 24 on every push to `main` and every pull request, so what deploys is what passed.

## Sessions at scale

Sessions are stored server-side, so horizontal scaling needs only a shared session store, which the Postgres `sessions` table provides. Because only a hash of the token is stored, the store can be read by any instance without exposing live tokens. Set a sensible TTL (the default is seven days) and consider a background job to prune expired rows, although `resolveSession` already deletes an expired session when it is encountered.

## Rate limiting at scale

The default in-memory bucket store is per-instance. Behind more than one instance, swap in a Redis-backed `BucketStore` so the budget is shared. See [Rate Limiting](Rate-Limiting).

## Billing go-live

Switch `BILLING_PROVIDER` to `stripe`, install the Stripe SDK and complete the marked calls in `StripeBillingProvider`. Point a Stripe webhook at your `parseWebhook` endpoint; the signature verification is already implemented. See [Billing](Billing).

## A deployment checklist

- [ ] Repository wired to Postgres, schema migrated.
- [ ] Row-level security policies enabled as a backstop.
- [ ] `NODE_ENV=production` so cookies are `secure`.
- [ ] Redis-backed rate-limit store if running more than one instance.
- [ ] Stripe SDK installed, adapter calls completed, webhook endpoint registered.
- [ ] Expired-session pruning scheduled.

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
