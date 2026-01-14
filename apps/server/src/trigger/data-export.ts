import { task } from "@trigger.dev/sdk";

// Data export processing task - handles GDPR data export requests
export const processDataExportTask = task({
  id: "process-data-export",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  run: async (payload: { requestId: string }) => {
    const { db } = await import("@memorystack/db");
    const { dataExportRequest, user, session, account, auditLog } =
      await import("@memorystack/db/schema");
    const { eq, desc } = await import("drizzle-orm");

    // Get the export request
    const request = await db.query.dataExportRequest.findFirst({
      where: eq(dataExportRequest.id, payload.requestId),
    });

    if (!request) {
      throw new Error(`Export request not found: ${payload.requestId}`);
    }

    // Update status to processing
    await db
      .update(dataExportRequest)
      .set({ status: "processing" })
      .where(eq(dataExportRequest.id, payload.requestId));

    try {
      // Fetch all user data
      const userData = await db.query.user.findFirst({
        where: eq(user.id, request.userId),
      });

      if (!userData) {
        throw new Error(`User not found: ${request.userId}`);
      }

      const sessions = await db.query.session.findMany({
        where: eq(session.userId, request.userId),
      });

      const accounts = await db.query.account.findMany({
        where: eq(account.userId, request.userId),
      });

      const auditLogs = await db.query.auditLog.findMany({
        where: eq(auditLog.userId, request.userId),
        orderBy: [desc(auditLog.createdAt)],
      });

      // Compile the export data
      const exportData = {
        profile: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          emailVerified: userData.emailVerified,
          image: userData.image,
          role: userData.role,
          twoFactorEnabled: userData.twoFactorEnabled,
          createdAt: userData.createdAt,
          updatedAt: userData.updatedAt,
        },
        sessions: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
        })),
        connectedAccounts: accounts.map((a) => ({
          id: a.id,
          provider: a.providerId,
          accountId: a.accountId,
          createdAt: a.createdAt,
        })),
        activityLog: auditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resource: log.resource,
          resourceId: log.resourceId,
          metadata: log.metadata,
          createdAt: log.createdAt,
        })),
        exportedAt: new Date().toISOString(),
      };

      // Convert to JSON string for storage/download
      const jsonData = JSON.stringify(exportData, null, 2);

      // In a production environment, you would:
      // 1. Upload to S3/R2 with a signed URL
      // 2. Set the downloadUrl in the request
      // For now, we'll store a data URI (for small exports) or mark as completed
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days

      // For production: Upload to S3 and get a signed URL
      // const downloadUrl = await uploadToS3(jsonData, `exports/${request.userId}/${payload.requestId}.json`);

      // Update request as completed
      await db
        .update(dataExportRequest)
        .set({
          status: "completed",
          completedAt: new Date(),
          expiresAt,
          // In production, set the actual download URL
          // downloadUrl,
        })
        .where(eq(dataExportRequest.id, payload.requestId));

      // Send notification email
      const { sendEmailTask } = await import("./send-email.js");

      // Simple notification (you could create a dedicated template)
      const html = `
        <h1>Your Data Export is Ready</h1>
        <p>Hi ${userData.name},</p>
        <p>Your data export request has been processed and is ready for download.</p>
        <p>Please log in to your account to download your data. The export will be available for 7 days.</p>
        <p>Best regards,<br>The SaaS Template Team</p>
      `;

      await sendEmailTask.trigger({
        to: userData.email,
        subject: "Your SaaS Template Data Export is Ready",
        html,
        tags: [
          { name: "type", value: "data-export" },
          { name: "requestId", value: payload.requestId },
        ],
      });

      return {
        success: true,
        requestId: payload.requestId,
        userId: request.userId,
        dataSize: jsonData.length,
      };
    } catch (error) {
      // Update request as failed
      await db
        .update(dataExportRequest)
        .set({ status: "failed" })
        .where(eq(dataExportRequest.id, payload.requestId));

      throw error;
    }
  },
});
