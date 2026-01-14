import { randomUUID } from "node:crypto";
import { db } from "@memorystack/db";
import { AuditActions, auditLog } from "@memorystack/db/schema";

export type AuditLogLevel = "info" | "warning" | "error" | "critical";

export interface CreateAuditLogInput {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string;
  level?: AuditLogLevel;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry synchronously.
 * Use this for auth hooks where async background tasks aren't ideal.
 */
export async function createAuditLog(input: CreateAuditLogInput) {
  try {
    const [log] = await db
      .insert(auditLog)
      .values({
        id: randomUUID(),
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        level: input.level ?? "info",
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .returning();
    return log;
  } catch (error) {
    // Log error but don't fail the auth operation
    console.error("Failed to create audit log:", error);
    return null;
  }
}

export { AuditActions };
