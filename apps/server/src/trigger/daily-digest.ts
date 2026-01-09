// =============================================================================
// DAILY DIGEST TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for generating and sending daily commitment digests.
// Summarizes overdue items, due today, and upcoming commitments.
//

import { createCommitmentAgent } from "@saas-template/ai/agents";
import { db } from "@saas-template/db";
import { commitment, emailAccount } from "@saas-template/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { log } from "../lib/logger";
import { sendEmailTask } from "./send-email";

// =============================================================================
// TYPES
// =============================================================================

interface DigestGenerationResult {
  success: boolean;
  organizationId: string;
  userId?: string;
  totalOpen: number;
  overdueCount: number;
  dueTodayCount: number;
  upcomingCount: number;
  emailSent: boolean;
  error?: string;
}

interface BatchDigestResult {
  success: boolean;
  total: number;
  processed: number;
  emailsSent: number;
  errors: string[];
}

// =============================================================================
// SINGLE USER/ORGANIZATION DIGEST
// =============================================================================

/**
 * Generate daily digest for a specific organization and user.
 */
export const generateDigestTask = task({
  id: "daily-digest-generate",
  queue: {
    name: "daily-digest",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: {
    organizationId: string;
    userId: string;
    userEmail: string;
    sendEmail?: boolean;
  }): Promise<DigestGenerationResult> => {
    const { organizationId, userId, userEmail, sendEmail = true } = payload;

    log.info("Generating daily digest", { organizationId, userId });

    try {
      // Get all active commitments for the organization
      const commitments = await db.query.commitment.findMany({
        where: and(
          eq(commitment.organizationId, organizationId),
          eq(commitment.isUserDismissed, false),
          inArray(commitment.status, ["pending", "in_progress", "waiting"])
        ),
      });

      if (commitments.length === 0) {
        log.info("No active commitments for digest", { organizationId });
        return {
          success: true,
          organizationId,
          userId,
          totalOpen: 0,
          overdueCount: 0,
          dueTodayCount: 0,
          upcomingCount: 0,
          emailSent: false,
        };
      }

      // Use CommitmentAgent to generate the digest
      const agent = createCommitmentAgent();
      const digest = agent.generateDailyDigest(
        userId,
        organizationId,
        commitments.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status as
            | "pending"
            | "in_progress"
            | "completed"
            | "cancelled"
            | "overdue"
            | "waiting"
            | "snoozed",
          dueDate: c.dueDate,
          direction: c.direction,
          debtorEmail: null, // We don't have email directly on commitment
          creditorEmail: null,
          sourceThreadId: c.sourceThreadId,
          lastReminderAt: c.lastReminderAt,
          reminderCount: c.reminderCount,
        }))
      );

      const overdueCount =
        digest.owedByMe.overdue.length + digest.owedToMe.overdue.length;
      const dueTodayCount =
        digest.owedByMe.dueToday.length + digest.owedToMe.dueToday.length;
      const upcomingCount =
        digest.owedByMe.upcoming.length + digest.owedToMe.upcoming.length;

      // Only send email if there are items to report and sendEmail is enabled
      let emailSent = false;
      if (sendEmail && digest.totalOpen > 0) {
        const html = generateDigestEmailHtml(digest, userEmail);

        await sendEmailTask.trigger({
          to: userEmail,
          subject: buildDigestSubject(overdueCount, dueTodayCount),
          html,
          tags: [
            { name: "type", value: "daily-digest" },
            { name: "organizationId", value: organizationId },
            { name: "userId", value: userId },
          ],
        });
        emailSent = true;
      }

      log.info("Daily digest generated", {
        organizationId,
        userId,
        totalOpen: digest.totalOpen,
        overdueCount,
        dueTodayCount,
        upcomingCount,
        emailSent,
      });

      return {
        success: true,
        organizationId,
        userId,
        totalOpen: digest.totalOpen,
        overdueCount,
        dueTodayCount,
        upcomingCount,
        emailSent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Daily digest generation failed", error, {
        organizationId,
        userId,
      });

      return {
        success: false,
        organizationId,
        userId,
        totalOpen: 0,
        overdueCount: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        emailSent: false,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH DIGEST GENERATION (FOR ALL USERS)
// =============================================================================

/**
 * Generate daily digests for all active email accounts.
 * This is the task that runs on the daily schedule.
 */
export const batchGenerateDigestsTask = task({
  id: "daily-digest-batch",
  queue: {
    name: "daily-digest-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (payload: {
    organizationIds?: string[];
    sendEmails?: boolean;
  }): Promise<BatchDigestResult> => {
    const { organizationIds, sendEmails = true } = payload;

    log.info("Starting batch daily digest generation", {
      specificOrgs: organizationIds?.length,
    });

    // Get all active email accounts
    const accountsQuery = db.query.emailAccount.findMany({
      where: and(
        eq(emailAccount.status, "active"),
        isNotNull(emailAccount.organizationId)
      ),
      columns: {
        id: true,
        organizationId: true,
        addedByUserId: true,
        email: true,
      },
    });

    const accounts = await accountsQuery;

    // Filter by organization if specified
    const filteredAccounts = organizationIds
      ? accounts.filter((a) => organizationIds.includes(a.organizationId))
      : accounts;

    if (filteredAccounts.length === 0) {
      return {
        success: true,
        total: 0,
        processed: 0,
        emailsSent: 0,
        errors: [],
      };
    }

    // Group by organization (one digest per org)
    const orgMap = new Map<string, { userId: string; email: string }>();
    for (const account of filteredAccounts) {
      // Use the first account's user as the recipient
      if (!orgMap.has(account.organizationId)) {
        orgMap.set(account.organizationId, {
          userId: account.addedByUserId,
          email: account.email,
        });
      }
    }

    log.info("Found organizations for digest", { count: orgMap.size });

    // Trigger digest generation for each organization
    const errors: string[] = [];
    let processed = 0;
    let emailsSent = 0;

    // Process in chunks
    const chunkSize = 10;
    const orgs = Array.from(orgMap.entries());

    for (let i = 0; i < orgs.length; i += chunkSize) {
      const chunk = orgs.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map(async ([organizationId, { userId, email }]) => {
          try {
            const handle = await generateDigestTask.triggerAndWait({
              organizationId,
              userId,
              userEmail: email,
              sendEmail: sendEmails,
            });
            return handle;
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: errorMsg, emailSent: false };
          }
        })
      );

      for (const result of results) {
        processed++;
        if (result && typeof result === "object" && "success" in result) {
          if (!result.success && "error" in result && result.error) {
            errors.push(result.error);
          }
          if ("emailSent" in result && result.emailSent) {
            emailsSent++;
          }
        }
      }
    }

    log.info("Batch daily digest generation completed", {
      total: orgs.length,
      processed,
      emailsSent,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: orgs.length,
      processed,
      emailsSent,
      errors,
    };
  },
});

// =============================================================================
// SCHEDULED DIGEST (RUNS DAILY AT 8 AM UTC)
// =============================================================================

/**
 * Scheduled task that triggers batch digest generation daily.
 */
export const dailyDigestSchedule = schedules.task({
  id: "daily-digest-scheduled",
  cron: "0 8 * * *", // 8:00 AM UTC daily
  run: async () => {
    log.info("Running scheduled daily digest");

    const result = await batchGenerateDigestsTask.triggerAndWait({
      sendEmails: true,
    });

    log.info("Scheduled daily digest completed", result);

    return result;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build email subject line based on digest content.
 */
function buildDigestSubject(
  overdueCount: number,
  dueTodayCount: number
): string {
  if (overdueCount > 0 && dueTodayCount > 0) {
    return `Daily Digest: ${overdueCount} overdue, ${dueTodayCount} due today`;
  }
  if (overdueCount > 0) {
    return `Daily Digest: ${overdueCount} overdue commitment${overdueCount > 1 ? "s" : ""}`;
  }
  if (dueTodayCount > 0) {
    return `Daily Digest: ${dueTodayCount} commitment${dueTodayCount > 1 ? "s" : ""} due today`;
  }
  return "Daily Commitment Digest";
}

/**
 * Generate HTML email content for the digest.
 */
function generateDigestEmailHtml(
  digest: ReturnType<
    ReturnType<typeof createCommitmentAgent>["generateDailyDigest"]
  >,
  _userEmail: string
): string {
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  const renderCommitmentItem = (
    item: { title: string; dueDate: Date; daysOverdue: number },
    type: "overdue" | "today" | "upcoming"
  ) => {
    const colors = {
      overdue: { bg: "#FEE2E2", border: "#EF4444", text: "#991B1B" },
      today: { bg: "#FEF3C7", border: "#F59E0B", text: "#92400E" },
      upcoming: { bg: "#DBEAFE", border: "#3B82F6", text: "#1E40AF" },
    };
    const color = colors[type];

    const dueText =
      type === "overdue"
        ? `${item.daysOverdue} day${item.daysOverdue > 1 ? "s" : ""} overdue`
        : type === "today"
          ? "Due today"
          : `Due ${formatDate(item.dueDate)}`;

    return `
      <div style="
        background: ${color.bg};
        border-left: 4px solid ${color.border};
        padding: 12px 16px;
        margin-bottom: 8px;
        border-radius: 4px;
      ">
        <div style="font-weight: 600; color: ${color.text};">${escapeHtml(item.title)}</div>
        <div style="font-size: 12px; color: ${color.text}; margin-top: 4px;">${dueText}</div>
      </div>
    `;
  };

  const renderSection = (
    title: string,
    items: Array<{ title: string; dueDate: Date; daysOverdue: number }>,
    type: "overdue" | "today" | "upcoming",
    direction: "Owed by you" | "Owed to you"
  ) => {
    if (items.length === 0) return "";

    return `
      <div style="margin-bottom: 24px;">
        <h3 style="color: #374151; font-size: 16px; margin-bottom: 12px;">
          ${title} (${direction})
        </h3>
        ${items.map((item) => renderCommitmentItem(item, type)).join("")}
      </div>
    `;
  };

  const hasOwedByMe =
    digest.owedByMe.overdue.length > 0 ||
    digest.owedByMe.dueToday.length > 0 ||
    digest.owedByMe.upcoming.length > 0;

  const hasOwedToMe =
    digest.owedToMe.overdue.length > 0 ||
    digest.owedToMe.dueToday.length > 0 ||
    digest.owedToMe.upcoming.length > 0;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #F3F4F6;
      margin: 0;
      padding: 20px;
    ">
      <div style="
        max-width: 600px;
        margin: 0 auto;
        background: white;
        border-radius: 8px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        overflow: hidden;
      ">
        <!-- Header -->
        <div style="
          background: linear-gradient(135deg, #3B82F6, #1D4ED8);
          color: white;
          padding: 24px;
        ">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">
            Daily Commitment Digest
          </h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">
            ${formatDate(digest.generatedAt)}
          </p>
        </div>

        <!-- Summary -->
        <div style="padding: 24px; border-bottom: 1px solid #E5E7EB;">
          <div style="display: flex; gap: 16px; text-align: center;">
            <div style="flex: 1; padding: 12px; background: #FEE2E2; border-radius: 8px;">
              <div style="font-size: 28px; font-weight: 700; color: #991B1B;">
                ${digest.owedByMe.overdue.length + digest.owedToMe.overdue.length}
              </div>
              <div style="font-size: 12px; color: #991B1B;">Overdue</div>
            </div>
            <div style="flex: 1; padding: 12px; background: #FEF3C7; border-radius: 8px;">
              <div style="font-size: 28px; font-weight: 700; color: #92400E;">
                ${digest.owedByMe.dueToday.length + digest.owedToMe.dueToday.length}
              </div>
              <div style="font-size: 12px; color: #92400E;">Due Today</div>
            </div>
            <div style="flex: 1; padding: 12px; background: #DBEAFE; border-radius: 8px;">
              <div style="font-size: 28px; font-weight: 700; color: #1E40AF;">
                ${digest.owedByMe.upcoming.length + digest.owedToMe.upcoming.length}
              </div>
              <div style="font-size: 12px; color: #1E40AF;">Upcoming</div>
            </div>
          </div>
        </div>

        <!-- Content -->
        <div style="padding: 24px;">
          ${
            hasOwedByMe
              ? `
            <h2 style="color: #111827; font-size: 18px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid #3B82F6;">
              Your Commitments
            </h2>
            ${renderSection("Overdue", digest.owedByMe.overdue, "overdue", "Owed by you")}
            ${renderSection("Due Today", digest.owedByMe.dueToday, "today", "Owed by you")}
            ${renderSection("Upcoming This Week", digest.owedByMe.upcoming, "upcoming", "Owed by you")}
          `
              : ""
          }

          ${
            hasOwedToMe
              ? `
            <h2 style="color: #111827; font-size: 18px; margin: 24px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #10B981;">
              Waiting On Others
            </h2>
            ${renderSection("Overdue", digest.owedToMe.overdue, "overdue", "Owed to you")}
            ${renderSection("Due Today", digest.owedToMe.dueToday, "today", "Owed to you")}
            ${renderSection("Upcoming This Week", digest.owedToMe.upcoming, "upcoming", "Owed to you")}
          `
              : ""
          }

          ${
            hasOwedByMe || hasOwedToMe
              ? ""
              : `
            <div style="text-align: center; padding: 40px; color: #6B7280;">
              <p>No active commitments this week. You're all caught up!</p>
            </div>
          `
          }
        </div>

        <!-- Footer -->
        <div style="
          background: #F9FAFB;
          padding: 16px 24px;
          text-align: center;
          font-size: 12px;
          color: #6B7280;
        ">
          <p style="margin: 0;">
            You're receiving this because you have active email accounts connected.
          </p>
          <p style="margin: 8px 0 0;">
            <a href="${process.env.APP_URL ?? "https://app.memorystack.io"}/settings/notifications" style="color: #3B82F6; text-decoration: none;">
              Manage notification preferences
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
