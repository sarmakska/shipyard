# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Typed data layer over `node:sqlite` with a schema-driven migrator, and a
  process singleton that swaps cleanly onto Postgres in production.
- Tenant-scoped repository that forces `organisationId` into every read, write
  and update, plus a separate global path for non-tenant tables.
- Session-based authentication with scrypt password hashing and hashed session
  tokens, with a seam for OAuth providers.
- Permission-based RBAC with a `requirePermission` guard and a `resolveContext`
  helper that resolves tenant and role together and fails closed.
- Append-only audit log recording actor, tenant, action and JSON metadata for
  every privileged action.
- Token-bucket rate limiter with an injectable clock and a pluggable bucket
  store, applied to API routes through `withGuard`.
- Billing scaffold: plan catalogue with usage budgets, a subscription state
  machine, usage counters, a fake provider for tests and a Stripe-shaped adapter
  with real webhook signature verification.
- Next.js 16 App Router surface: auth and protected API routes, edge middleware
  and a minimal admin settings dashboard.
- Vitest suite covering tenant isolation, RBAC enforcement, audit writes, rate
  limiting and billing state transitions.
- README, full wiki, CI workflow, security policy, licence and seed script.

[Unreleased]: https://github.com/sarmakska/shipyard/commits/main
