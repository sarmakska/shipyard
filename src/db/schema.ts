/**
 * Typed table definitions for shipyard.
 *
 * I describe each table as a plain TypeScript type plus a small column
 * descriptor. The descriptor drives migrations (see migrate.ts) and gives the
 * query layer enough metadata to build statements without an ORM. In production
 * the same shapes map cleanly onto Postgres columns; see the Deployment wiki
 * page for the swap.
 */

export type ColumnType = "text" | "integer" | "boolean";

export interface ColumnDef {
  type: ColumnType;
  primaryKey?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: string | number;
  references?: { table: string; column: string };
}

export interface TableDef {
  name: string;
  columns: Record<string, ColumnDef>;
  // Composite indexes, written verbatim into CREATE INDEX statements.
  indexes?: { name: string; columns: string[]; unique?: boolean }[];
}

/** Roles are fixed at the application level and ordered by privilege. */
export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Billing plans. Usage budgets are defined per plan in billing/plans.ts. */
export const PLANS = ["free", "pro", "scale"] as const;
export type Plan = (typeof PLANS)[number];

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface Membership {
  id: string;
  organisationId: string;
  userId: string;
  role: Role;
  createdAt: number;
}

export interface Session {
  id: string;
  userId: string;
  // The active organisation for this session. Tenant scoping reads from here.
  organisationId: string | null;
  expiresAt: number;
  createdAt: number;
}

export interface AuditEntry {
  id: string;
  organisationId: string;
  actorUserId: string | null;
  action: string;
  metadata: string; // JSON encoded
  createdAt: number;
}

export interface Subscription {
  id: string;
  organisationId: string;
  plan: Plan;
  status: SubscriptionStatus;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface UsageCounter {
  id: string;
  organisationId: string;
  metric: string;
  period: string; // e.g. 2026-05
  count: number;
  updatedAt: number;
}

/**
 * Any tenant-scoped row carries organisationId. The query layer refuses to read
 * or write such tables without a tenant id, which is the spine of the isolation
 * guarantee.
 */
export const TENANT_SCOPED_TABLES = new Set([
  "memberships",
  "audit_log",
  "subscriptions",
  "usage_counters",
]);

export const TABLES: TableDef[] = [
  {
    name: "organisations",
    columns: {
      id: { type: "text", primaryKey: true },
      name: { type: "text", notNull: true },
      slug: { type: "text", notNull: true, unique: true },
      createdAt: { type: "integer", notNull: true },
    },
  },
  {
    name: "users",
    columns: {
      id: { type: "text", primaryKey: true },
      email: { type: "text", notNull: true, unique: true },
      passwordHash: { type: "text", notNull: true },
      createdAt: { type: "integer", notNull: true },
    },
  },
  {
    name: "memberships",
    columns: {
      id: { type: "text", primaryKey: true },
      organisationId: {
        type: "text",
        notNull: true,
        references: { table: "organisations", column: "id" },
      },
      userId: {
        type: "text",
        notNull: true,
        references: { table: "users", column: "id" },
      },
      role: { type: "text", notNull: true },
      createdAt: { type: "integer", notNull: true },
    },
    indexes: [
      {
        name: "memberships_org_user_unique",
        columns: ["organisationId", "userId"],
        unique: true,
      },
    ],
  },
  {
    name: "sessions",
    columns: {
      id: { type: "text", primaryKey: true },
      userId: {
        type: "text",
        notNull: true,
        references: { table: "users", column: "id" },
      },
      organisationId: { type: "text" },
      expiresAt: { type: "integer", notNull: true },
      createdAt: { type: "integer", notNull: true },
    },
  },
  {
    name: "audit_log",
    columns: {
      id: { type: "text", primaryKey: true },
      organisationId: {
        type: "text",
        notNull: true,
        references: { table: "organisations", column: "id" },
      },
      actorUserId: { type: "text" },
      action: { type: "text", notNull: true },
      metadata: { type: "text", notNull: true, default: "{}" },
      createdAt: { type: "integer", notNull: true },
    },
    indexes: [
      { name: "audit_org_created", columns: ["organisationId", "createdAt"] },
    ],
  },
  {
    name: "subscriptions",
    columns: {
      id: { type: "text", primaryKey: true },
      organisationId: {
        type: "text",
        notNull: true,
        unique: true,
        references: { table: "organisations", column: "id" },
      },
      plan: { type: "text", notNull: true },
      status: { type: "text", notNull: true },
      providerCustomerId: { type: "text" },
      providerSubscriptionId: { type: "text" },
      currentPeriodEnd: { type: "integer" },
      createdAt: { type: "integer", notNull: true },
      updatedAt: { type: "integer", notNull: true },
    },
  },
  {
    name: "usage_counters",
    columns: {
      id: { type: "text", primaryKey: true },
      organisationId: {
        type: "text",
        notNull: true,
        references: { table: "organisations", column: "id" },
      },
      metric: { type: "text", notNull: true },
      period: { type: "text", notNull: true },
      count: { type: "integer", notNull: true, default: 0 },
      updatedAt: { type: "integer", notNull: true },
    },
    indexes: [
      {
        name: "usage_org_metric_period_unique",
        columns: ["organisationId", "metric", "period"],
        unique: true,
      },
    ],
  },
];
