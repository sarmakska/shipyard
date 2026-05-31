# Comparisons

How shipyard relates to the obvious alternatives, and when each is the better choice. I am not trying to win every comparison; a starter that claims to beat everything is not telling you the truth. The honest framing is that shipyard occupies a specific niche: the testable multi-tenant spine you own, not a hosted platform and not a batteries-included SaaS kit.

## Versus a hosted auth/SaaS platform (Clerk, Auth0, WorkOS, and similar)

A hosted platform gives you auth, organisations and often billing as a managed service with a polished dashboard. That is genuinely less to run. The trade is that the tenant model, the session semantics and the authorisation rules live in someone else's system, behind their API, on their pricing.

shipyard keeps all of that in your codebase and your database. You can read the exact query that enforces isolation (`updateScoped` in `src/db/repository.ts`), step through it, and prove it in a unit test on commit one. There is no per-MAU pricing and no vendor in the request path for identity. Pick the platform when you want to outsource identity and move fast; pick shipyard when the isolation and authorisation logic is something you want to own, test and audit yourself.

## Versus an ORM-based starter (Prisma, Drizzle, TypeORM)

The common pattern is a starter built on an ORM with a `where: { organisationId }` added at each call site, sometimes behind a middleware or a Prisma extension. ORMs are excellent tools. The risk for multi-tenancy specifically is that the tenant predicate is one clause among many that a developer has to remember at every call site, and the place it lives is generated or abstracted away.

shipyard inverts that: the tenant predicate is injected by the one repository, from the first argument, and cannot be removed by the caller. There is no call site that can forget it, because there is no call site that writes the `WHERE` clause. The cost is that the repository is hand-written and narrow rather than a full query builder. For a project whose headline property is isolation, I judged the narrow path worth more than the ergonomics of an ORM. The reasoning is in [Design Decisions](Design-Decisions).

If your priority is rich querying and relations, an ORM starter will be more comfortable. If your priority is a guarantee you can point at and test, the repository chokepoint is the stronger shape.

## Versus Postgres row-level security as the primary mechanism

RLS is the textbook answer to multi-tenant isolation, and it is good. I use it, but as a backstop, not the primary guard. Two reasons, both about feedback. First, the project has to run and prove itself with zero services, and an in-memory test cannot exercise an RLS policy. Second, an application-level guard fails loudly in a unit test on any database, whereas a misconfigured RLS policy fails silently until it reaches production.

So shipyard's primary guard is the repository (testable on commit one) and RLS is documented as defence in depth on Postgres (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). The recommendation is both, with the loud one first. See [Deployment](Deployment) and [Security Model](Security-Model).

## Versus rolling it all yourself from scratch

This is the real alternative for most people, and it is what shipyard is reacting to. Every part here (sessions, scrypt, a role model, an audit trail, a token bucket, a billing state machine) is straightforward in isolation. The danger is the subtle errors: a query that forgot its tenant predicate, a role check that lived in the client, a webhook that reactivated a cancelled plan because nobody validated the transition. Those are the bugs you find in production.

shipyard is the same spine you would write, with the failure modes already closed and pinned by tests. The trade is that you accept its opinions (no ORM, no bundled payment SDK, no UI kit). If those opinions match yours, it saves you the fortnight of rebuilding the spine; if they do not, you should start elsewhere rather than fight them.

## Versus a full SaaS boilerplate (with UI kit, marketing pages, etc.)

A full boilerplate ships a design system, marketing pages, dashboards and integrations. It gets you a running app faster. The trade is surface area: a lot of code you did not write, opinions about UI and structure you may not share, and more to understand before you can trust the security-sensitive core.

shipyard deliberately ships almost no UI (one settings page to prove the wiring) and no marketing scaffold. It is the core, not the shell. Bring it a design system and a frontend; it brings you the isolation, authorisation, audit and billing spine. See the [Roadmap](Roadmap) for what is explicitly a non-goal.

## A quick decision table

| If you want... | Reach for... |
| --- | --- |
| To outsource identity and move fastest | a hosted auth/SaaS platform |
| Rich querying and relations, comfortable DX | an ORM-based starter |
| Database-enforced isolation as the only mechanism | Postgres RLS (and consider shipyard's repository on top) |
| A testable isolation guarantee you own, with no service to run the tests | shipyard |
| A running app with UI and marketing out of the box | a full SaaS boilerplate |
| To learn how the spine is built, by reading it | shipyard |

---
SarmaLinux . sarmalinux.com . [shipyard on GitHub](https://github.com/sarmakska/shipyard)
