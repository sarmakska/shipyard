import type { Repository } from "@/db";
import type { AuditEntry } from "@/db/schema";
import { newId } from "./crypto";

/**
 * Audit log.
 *
 * Every privileged action records an immutable entry scoped to the tenant. The
 * entry captures who (actor), where (tenant), what (action) and a JSON metadata
 * blob for context. Entries are written through the tenant-scoped repository so
 * an audit record can never be attributed to the wrong tenant.
 */

export interface RecordAuditInput {
  organisationId: string;
  actorUserId: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

export function recordAudit(repo: Repository, input: RecordAuditInput): AuditEntry {
  const entry: AuditEntry = {
    id: newId(),
    organisationId: input.organisationId,
    actorUserId: input.actorUserId,
    action: input.action,
    metadata: JSON.stringify(input.metadata ?? {}),
    createdAt: Date.now(),
  };
  repo.insertScoped(input.organisationId, "audit_log", {
    id: entry.id,
    actorUserId: entry.actorUserId,
    action: entry.action,
    metadata: entry.metadata,
    createdAt: entry.createdAt,
  });
  return entry;
}

export function listAudit(
  repo: Repository,
  organisationId: string,
): AuditEntry[] {
  return repo
    .selectScoped<AuditEntry>(organisationId, "audit_log")
    .sort((a, b) => b.createdAt - a.createdAt);
}
