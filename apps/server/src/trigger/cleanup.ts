import { schedules } from "@trigger.dev/sdk";
import { eq, lt } from "drizzle-orm";

// Daily cleanup of expired invitations
export const cleanupExpiredInvitations = schedules.task({
  id: "cleanup-expired-invitations",
  cron: "0 3 * * *", // Run at 3 AM every day
  run: async () => {
    const { db } = await import("@memorystack/db");
    const { invitation } = await import("@memorystack/db/schema");

    const now = new Date();

    // Delete expired invitations
    const result = await db
      .delete(invitation)
      .where(lt(invitation.expiresAt, now))
      .returning({ id: invitation.id });

    return {
      deletedCount: result.length,
      deletedIds: result.map((r) => r.id),
      timestamp: now.toISOString(),
    };
  },
});

// Weekly cleanup of old audit logs (keep 90 days)
export const cleanupOldAuditLogs = schedules.task({
  id: "cleanup-old-audit-logs",
  cron: "0 4 * * 0", // Run at 4 AM every Sunday
  run: async () => {
    const { db } = await import("@memorystack/db");
    const { auditLog } = await import("@memorystack/db/schema");

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    // Only delete info-level logs older than 90 days
    // Keep warn and error logs longer
    const result = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoffDate))
      .returning({ id: auditLog.id });

    return {
      deletedCount: result.length,
      cutoffDate: cutoffDate.toISOString(),
    };
  },
});

// Daily task to update expired invitation status
export const updateExpiredInvitationStatus = schedules.task({
  id: "update-expired-invitation-status",
  cron: "0 0 * * *", // Run at midnight every day
  run: async () => {
    const { db } = await import("@memorystack/db");
    const { invitation } = await import("@memorystack/db/schema");
    const { and, lt } = await import("drizzle-orm");

    const now = new Date();

    // Update status of expired pending invitations
    const result = await db
      .update(invitation)
      .set({ status: "expired" })
      .where(
        and(eq(invitation.status, "pending"), lt(invitation.expiresAt, now))
      )
      .returning({ id: invitation.id });

    return {
      updatedCount: result.length,
      timestamp: now.toISOString(),
    };
  },
});
