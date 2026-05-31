# Audit Log

The audit log is an append-only record of every privileged action. It answers the question an incident review always asks: who did what, in which tenant, and when.

## What is recorded

Each entry captures:

| Field | Meaning |
| --- | --- |
| `actorUserId` | who performed the action, or `null` for a system action such as a webhook |
| `organisationId` | the tenant the action happened in |
| `action` | a dotted action name, for example `members.invite` |
| `metadata` | a JSON blob of context, for example the invited email and role |
| `createdAt` | a millisecond timestamp |

## Writing an entry

`recordAudit` in `src/lib/audit.ts` is the single writer:

```ts
recordAudit(repo, {
  organisationId: ctx.organisationId,
  actorUserId: ctx.user.id,
  action: "members.invite",
  metadata: { email, role },
});
```

It writes through the tenant-scoped repository, so an entry can never be attributed to the wrong tenant. The metadata object is JSON-encoded on the way in and decoded on the way out, so callers work with plain objects.

## Actions recorded out of the box

| Action | Where | Actor |
| --- | --- | --- |
| `auth.signup` | new user and organisation created | the new user |
| `members.invite` | a user invited to a tenant | the inviter |
| `members.set_role` | a member's role changed | the editor |
| `billing.subscribe` | a plan subscribed | the manager |
| `billing.webhook` | a provider event applied | system (`null`) |
| `billing.cancel` | a subscription canceled | the manager |

Adding an action is one call to `recordAudit` inside the privileged operation. The convention is `domain.verb`.

## Reading the log

`listAudit(repo, organisationId)` returns the tenant's entries newest first. The protected route `GET /api/protected/audit` exposes it, gated by the `audit:read` permission, so only owners and admins can read it. The settings dashboard renders the most recent twenty entries.

Because reads go through `selectScoped`, a request for tenant B's audit log can only ever return tenant B's entries. This is verified in `tests/tenant-isolation.test.ts`.

## Why append-only

There is no update or delete path for audit entries in the repository's scoped API; the only scoped mutation exposed is `updateScoped`, and nothing calls it on `audit_log`. Treating the log as immutable is what makes it trustworthy during a review. In production on Postgres you would reinforce this with a database-level constraint or a revoked `UPDATE`/`DELETE` grant on the table.

## Tests

`tests/audit.test.ts` proves that signup and invitations write entries with the correct actor, tenant and metadata, and that entries are returned newest first.
