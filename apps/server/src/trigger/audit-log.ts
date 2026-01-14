import { randomUUID } from "node:crypto";
import { task } from "@trigger.dev/sdk";

// Async audit logging - offloads audit log writes to background
export const createAuditLogTask = task({
  id: "create-audit-log",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 500,
    maxTimeoutInMs: 5000,
    factor: 2,
  },
  run: async (payload: {
    organizationId?: string;
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    level?: "info" | "warning" | "error" | "critical";
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) => {
    const { db } = await import("@memorystack/db");
    const { auditLog } = await import("@memorystack/db/schema");

    const [log] = await db
      .insert(auditLog)
      .values({
        id: randomUUID(),
        organizationId: payload.organizationId ?? null,
        userId: payload.userId ?? null,
        action: payload.action,
        resource: payload.resource,
        resourceId: payload.resourceId,
        level: payload.level ?? "info",
        metadata: payload.metadata ?? {},
        ipAddress: payload.ipAddress,
        userAgent: payload.userAgent,
      })
      .returning();

    if (!log) {
      throw new Error("Failed to create audit log");
    }
    return { auditLogId: log.id };
  },
});

// Batch audit log processing - for high-volume logging
export const batchAuditLogTask = task({
  id: "batch-audit-log",
  run: async (payload: {
    logs: Array<{
      organizationId?: string;
      userId?: string;
      action: string;
      resource: string;
      resourceId?: string;
      level?: "info" | "warning" | "error" | "critical";
      metadata?: Record<string, unknown>;
      ipAddress?: string;
      userAgent?: string;
    }>;
  }) => {
    const { db } = await import("@memorystack/db");
    const { auditLog } = await import("@memorystack/db/schema");

    const insertValues = payload.logs.map((log) => ({
      id: randomUUID(),
      organizationId: log.organizationId ?? null,
      userId: log.userId ?? null,
      action: log.action,
      resource: log.resource,
      resourceId: log.resourceId,
      level: log.level ?? "info",
      metadata: log.metadata ?? {},
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
    }));

    const results = await db.insert(auditLog).values(insertValues).returning();

    return { count: results.length, ids: results.map((r) => r.id) };
  },
});
