// =============================================================================
// MENTION & ACTIVITY NOTIFICATION TASKS
// =============================================================================
//
// Background tasks for sending notifications when users are mentioned
// or when activity occurs on items they're involved in.
//

import {
  broadcastNotification,
  createNotification,
} from "@memorystack/api/routers/notifications";
import { db } from "@memorystack/db";
import {
  activity,
  member,
  mention,
  notificationPreferences,
  user,
} from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { log } from "../lib/logger";
import { sendEmailTask } from "./send-email";

// =============================================================================
// TYPES
// =============================================================================

interface MentionNotificationPayload {
  mentionId: string;
  mentionedUserId: string;
  mentionedByUserId: string;
  organizationId: string;
  contextType: string;
  contextId: string;
  contextPreview?: string;
  mentionText: string;
}

interface ActivityNotificationPayload {
  activityId: string;
  organizationId: string;
  activityType: string;
  targetType: string;
  targetId: string;
  targetTitle?: string;
  actorUserId?: string;
}

// =============================================================================
// MENTION NOTIFICATION TASK
// =============================================================================

/**
 * Send notification when someone is @mentioned.
 */
export const sendMentionNotificationTask = task({
  id: "mention-notification-send",
  queue: {
    name: "notifications",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: MentionNotificationPayload) => {
    const {
      mentionId,
      mentionedUserId,
      mentionedByUserId,
      contextType,
      contextId,
      contextPreview,
      mentionText,
    } = payload;

    log.info("Processing mention notification", {
      mentionId,
      mentionedUserId,
      contextType,
    });

    // Get the mentioning user's info
    const mentioningUser = await db.query.user.findFirst({
      where: eq(user.id, mentionedByUserId),
    });

    if (!mentioningUser) {
      log.warn("Mentioning user not found", { mentionedByUserId });
      return { success: false, error: "Mentioning user not found" };
    }

    // Get the mentioned user's preferences
    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, mentionedUserId),
    });

    // Create in-app notification
    const link = buildContextLink(contextType, contextId);
    await createNotification(
      mentionedUserId,
      {
        type: "info",
        category: "system",
        title: `${mentioningUser.name || "Someone"} mentioned you`,
        message:
          contextPreview ||
          `You were mentioned in a ${contextType}: "${mentionText}"`,
        link,
        priority: "high",
        entityId: contextId,
        entityType: contextType,
        metadata: {
          mentionId,
          mentionedByUserId,
          mentionText,
        },
      },
      "mention"
    );

    // Mark mention as notified
    await db
      .update(mention)
      .set({ notifiedAt: new Date() })
      .where(eq(mention.id, mentionId));

    // Send email if realtime notifications are enabled
    if (prefs?.emailDigestFrequency === "realtime") {
      const mentionedUser = await db.query.user.findFirst({
        where: eq(user.id, mentionedUserId),
      });

      if (mentionedUser?.email) {
        const html = generateMentionEmailHtml({
          mentionedUserName: mentionedUser.name || "there",
          mentionerName: mentioningUser.name || "Someone",
          contextType,
          contextPreview: contextPreview || mentionText,
          link: `${process.env.APP_URL ?? "https://app.drovi.io"}${link}`,
        });

        await sendEmailTask.trigger({
          to: mentionedUser.email,
          subject: `${mentioningUser.name || "Someone"} mentioned you in Drovi`,
          html,
          tags: [
            { name: "type", value: "mention" },
            { name: "mentionId", value: mentionId },
            { name: "userId", value: mentionedUserId },
          ],
        });
      }
    }

    log.info("Mention notification sent", { mentionId, mentionedUserId });

    return { success: true, mentionId };
  },
});

// =============================================================================
// ACTIVITY NOTIFICATION TASK
// =============================================================================

/**
 * Send notification for activity on items user is involved in.
 */
export const sendActivityNotificationTask = task({
  id: "activity-notification-send",
  queue: {
    name: "notifications",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: ActivityNotificationPayload) => {
    const {
      activityId,
      organizationId,
      activityType,
      targetType,
      targetId,
      targetTitle,
      actorUserId,
    } = payload;

    log.info("Processing activity notification", {
      activityId,
      activityType,
      targetType,
    });

    // Get actor info
    let actorName = "Someone";
    if (actorUserId) {
      const actor = await db.query.user.findFirst({
        where: eq(user.id, actorUserId),
      });
      actorName = actor?.name || "Someone";
    }

    // Get users who should be notified (org members excluding actor)
    const orgMembers = await db.query.member.findMany({
      where: eq(member.organizationId, organizationId),
    });

    const usersToNotify = orgMembers
      .filter((m) => m.userId !== actorUserId)
      .map((m) => m.userId);

    if (usersToNotify.length === 0) {
      return { success: true, notified: 0 };
    }

    // Create notification message based on activity type
    const { title, message } = buildActivityMessage(
      activityType,
      actorName,
      targetTitle,
      targetType
    );

    const link = buildContextLink(targetType, targetId);

    // Broadcast to all relevant users
    await broadcastNotification(usersToNotify, {
      type: getActivityNotificationType(activityType),
      category: getActivityCategory(activityType),
      title,
      message,
      link,
      priority: getActivityPriority(activityType),
      entityId: targetId,
      entityType: targetType,
      metadata: {
        activityId,
        activityType,
        actorUserId,
      },
    });

    log.info("Activity notification sent", {
      activityId,
      notifiedCount: usersToNotify.length,
    });

    return { success: true, notified: usersToNotify.length };
  },
});

// =============================================================================
// ACTIVITY DIGEST TASK (DAILY SUMMARY)
// =============================================================================

/**
 * Generate activity digest for a user.
 */
export const generateActivityDigestTask = task({
  id: "activity-digest-generate",
  queue: {
    name: "activity-digest",
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
    userId: string;
    userEmail: string;
    organizationId: string;
  }) => {
    const { userId, userEmail, organizationId } = payload;

    log.info("Generating activity digest", { userId, organizationId });

    // Get user's unread mentions
    const unreadMentions = await db.query.mention.findMany({
      where: and(
        eq(mention.mentionedUserId, userId),
        eq(mention.organizationId, organizationId),
        isNull(mention.readAt)
      ),
      orderBy: [desc(mention.createdAt)],
      limit: 20,
      with: {
        mentionedByUser: true,
      },
    });

    // Get recent activity in the org
    const recentActivity = await db.query.activity.findMany({
      where: and(
        eq(activity.organizationId, organizationId),
        lt(activity.createdAt, new Date())
      ),
      orderBy: [desc(activity.createdAt)],
      limit: 20,
      with: {
        user: true,
      },
    });

    // Filter activity to exclude user's own actions
    const relevantActivity = recentActivity.filter((a) => a.userId !== userId);

    if (unreadMentions.length === 0 && relevantActivity.length === 0) {
      log.info("No activity for digest", { userId });
      return { success: true, emailSent: false };
    }

    // Generate email
    const html = generateActivityDigestEmailHtml({
      mentions: unreadMentions.map((m) => ({
        id: m.id,
        mentionerName: m.mentionedByUser?.name || "Someone",
        contextType: m.contextType,
        contextPreview: m.contextPreview || m.mentionText,
        createdAt: m.createdAt,
      })),
      activities: relevantActivity.map((a) => ({
        id: a.id,
        type: a.activityType,
        actorName: a.user?.name || "Someone",
        targetTitle: a.targetTitle || "an item",
        targetType: a.targetType,
        createdAt: a.createdAt,
      })),
    });

    await sendEmailTask.trigger({
      to: userEmail,
      subject: buildActivityDigestSubject(
        unreadMentions.length,
        relevantActivity.length
      ),
      html,
      tags: [
        { name: "type", value: "activity-digest" },
        { name: "userId", value: userId },
        { name: "organizationId", value: organizationId },
      ],
    });

    log.info("Activity digest sent", {
      userId,
      mentionCount: unreadMentions.length,
      activityCount: relevantActivity.length,
    });

    return {
      success: true,
      emailSent: true,
      mentionCount: unreadMentions.length,
      activityCount: relevantActivity.length,
    };
  },
});

// =============================================================================
// SCHEDULED ACTIVITY DIGEST
// =============================================================================

/**
 * Scheduled task for daily activity digest.
 */
export const activityDigestSchedule = schedules.task({
  id: "activity-digest-scheduled",
  cron: "0 9 * * *", // 9:00 AM UTC daily
  run: async () => {
    log.info("Running scheduled activity digest");

    // Get all users with daily digest enabled
    const usersWithDigest = await db.query.notificationPreferences.findMany({
      where: and(
        eq(notificationPreferences.emailDigestEnabled, true),
        eq(notificationPreferences.emailDigestFrequency, "daily")
      ),
    });

    if (usersWithDigest.length === 0) {
      return { success: true, total: 0, processed: 0 };
    }

    // Get user details and their organizations
    const userIds = usersWithDigest.map((p) => p.userId);
    const users = await db.query.user.findMany({
      where: inArray(user.id, userIds),
    });

    const memberList = await db.query.member.findMany({
      where: inArray(member.userId, userIds),
    });

    // Build user -> organization map
    const userOrgMap = new Map<string, string>();
    for (const m of memberList) {
      if (!userOrgMap.has(m.userId)) {
        userOrgMap.set(m.userId, m.organizationId);
      }
    }

    // Trigger digest for each user
    let processed = 0;
    const errors: string[] = [];

    for (const u of users) {
      const orgId = userOrgMap.get(u.id);
      if (!(orgId && u.email)) {
        continue;
      }

      try {
        await generateActivityDigestTask.trigger({
          userId: u.id,
          userEmail: u.email,
          organizationId: orgId,
        });
        processed++;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`${u.id}: ${errorMsg}`);
      }
    }

    log.info("Scheduled activity digest completed", {
      total: users.length,
      processed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: users.length,
      processed,
      errors,
    };
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function buildContextLink(contextType: string, contextId: string): string {
  switch (contextType) {
    case "conversation":
      return `/dashboard/email/thread/${contextId}`;
    case "commitment":
      return `/dashboard/commitments?id=${contextId}`;
    case "decision":
      return `/dashboard/decisions?id=${contextId}`;
    case "task":
      return `/dashboard/tasks?id=${contextId}`;
    case "uio":
      return `/dashboard/uio/${contextId}`;
    case "contact":
      return `/dashboard/contacts/${contextId}`;
    case "comment":
      return `/dashboard/activity?comment=${contextId}`;
    default:
      return "/dashboard";
  }
}

function buildActivityMessage(
  activityType: string,
  actorName: string,
  targetTitle: string | undefined,
  targetType: string
): { title: string; message: string } {
  const target = targetTitle || `a ${targetType}`;

  switch (activityType) {
    case "commitment_created":
      return {
        title: "New commitment created",
        message: `${actorName} created a commitment: ${target}`,
      };
    case "commitment_completed":
      return {
        title: "Commitment completed",
        message: `${actorName} completed: ${target}`,
      };
    case "decision_made":
      return {
        title: "Decision made",
        message: `${actorName} made a decision: ${target}`,
      };
    case "task_assigned":
      return {
        title: "Task assigned",
        message: `${actorName} assigned you a task: ${target}`,
      };
    case "comment_added":
      return {
        title: "New comment",
        message: `${actorName} commented on ${target}`,
      };
    case "conversation_assigned":
      return {
        title: "Conversation assigned",
        message: `${actorName} assigned a conversation to you`,
      };
    case "risk_detected":
      return {
        title: "Risk detected",
        message: `A risk was detected: ${target}`,
      };
    default:
      return {
        title: "Activity",
        message: `${actorName} performed an action on ${target}`,
      };
  }
}

function getActivityNotificationType(
  activityType: string
): "info" | "success" | "warning" | "error" {
  if (activityType.includes("completed")) {
    return "success";
  }
  if (activityType.includes("risk") || activityType.includes("overdue")) {
    return "error";
  }
  if (activityType.includes("deadline") || activityType.includes("escalated")) {
    return "warning";
  }
  return "info";
}

function getActivityCategory(
  activityType: string
): "commitment" | "decision" | "system" {
  if (activityType.includes("commitment")) {
    return "commitment";
  }
  if (activityType.includes("decision")) {
    return "decision";
  }
  return "system";
}

function getActivityPriority(
  activityType: string
): "low" | "normal" | "high" | "urgent" {
  if (activityType.includes("risk") || activityType.includes("escalated")) {
    return "urgent";
  }
  if (activityType.includes("assigned") || activityType.includes("deadline")) {
    return "high";
  }
  if (activityType.includes("completed")) {
    return "low";
  }
  return "normal";
}

function buildActivityDigestSubject(
  mentionCount: number,
  activityCount: number
): string {
  if (mentionCount > 0 && activityCount > 0) {
    return `${mentionCount} mention${mentionCount > 1 ? "s" : ""} and ${activityCount} activities`;
  }
  if (mentionCount > 0) {
    return `${mentionCount} new mention${mentionCount > 1 ? "s" : ""} in Drovi`;
  }
  return `${activityCount} new activities in your team`;
}

// =============================================================================
// EMAIL TEMPLATES
// =============================================================================

function generateMentionEmailHtml(data: {
  mentionedUserName: string;
  mentionerName: string;
  contextType: string;
  contextPreview: string;
  link: string;
}): string {
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
        <div style="
          background: linear-gradient(135deg, #8B5CF6, #6366F1);
          color: white;
          padding: 24px;
        ">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">
            You were mentioned
          </h1>
        </div>

        <div style="padding: 24px;">
          <p style="margin: 0 0 16px; color: #374151; font-size: 16px;">
            Hi ${escapeHtml(data.mentionedUserName)},
          </p>

          <p style="margin: 0 0 24px; color: #374151;">
            <strong>${escapeHtml(data.mentionerName)}</strong> mentioned you in a ${data.contextType}:
          </p>

          <div style="
            background: #F9FAFB;
            border-left: 4px solid #8B5CF6;
            padding: 16px;
            margin-bottom: 24px;
            border-radius: 4px;
          ">
            <p style="margin: 0; color: #4B5563; font-style: italic;">
              "${escapeHtml(data.contextPreview)}"
            </p>
          </div>

          <a href="${data.link}" style="
            display: inline-block;
            background: #8B5CF6;
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
          ">
            View in Drovi
          </a>
        </div>

        <div style="
          background: #F9FAFB;
          padding: 16px 24px;
          text-align: center;
          font-size: 12px;
          color: #6B7280;
        ">
          <p style="margin: 0;">
            <a href="${process.env.APP_URL ?? "https://app.drovi.io"}/settings/notifications" style="color: #8B5CF6; text-decoration: none;">
              Manage notification preferences
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function generateActivityDigestEmailHtml(data: {
  mentions: Array<{
    id: string;
    mentionerName: string;
    contextType: string;
    contextPreview: string;
    createdAt: Date;
  }>;
  activities: Array<{
    id: string;
    type: string;
    actorName: string;
    targetTitle: string;
    targetType: string;
    createdAt: Date;
  }>;
}): string {
  const formatTime = (date: Date) =>
    new Date(date).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

  const mentionsHtml =
    data.mentions.length > 0
      ? `
    <h2 style="color: #111827; font-size: 18px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 2px solid #8B5CF6;">
      Mentions (${data.mentions.length})
    </h2>
    ${data.mentions
      .map(
        (m) => `
      <div style="
        background: #F9FAFB;
        border-left: 4px solid #8B5CF6;
        padding: 12px 16px;
        margin-bottom: 8px;
        border-radius: 4px;
      ">
        <div style="color: #374151; font-weight: 600; margin-bottom: 4px;">
          ${escapeHtml(m.mentionerName)} mentioned you
        </div>
        <div style="color: #6B7280; font-size: 14px;">
          "${escapeHtml(m.contextPreview)}"
        </div>
        <div style="color: #9CA3AF; font-size: 12px; margin-top: 4px;">
          ${formatTime(m.createdAt)} · ${m.contextType}
        </div>
      </div>
    `
      )
      .join("")}
  `
      : "";

  const activitiesHtml =
    data.activities.length > 0
      ? `
    <h2 style="color: #111827; font-size: 18px; margin: 24px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #3B82F6;">
      Team Activity (${data.activities.length})
    </h2>
    ${data.activities
      .map(
        (a) => `
      <div style="
        padding: 12px 0;
        border-bottom: 1px solid #E5E7EB;
      ">
        <div style="color: #374151;">
          <strong>${escapeHtml(a.actorName)}</strong>
          ${getActivityVerb(a.type)}
          <strong>${escapeHtml(a.targetTitle)}</strong>
        </div>
        <div style="color: #9CA3AF; font-size: 12px; margin-top: 4px;">
          ${formatTime(a.createdAt)} · ${a.targetType}
        </div>
      </div>
    `
      )
      .join("")}
  `
      : "";

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
        <div style="
          background: linear-gradient(135deg, #3B82F6, #1D4ED8);
          color: white;
          padding: 24px;
        ">
          <h1 style="margin: 0; font-size: 24px; font-weight: 600;">
            Your Daily Activity Digest
          </h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">
            ${new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>

        <div style="padding: 24px;">
          ${mentionsHtml}
          ${activitiesHtml}

          ${
            data.mentions.length === 0 && data.activities.length === 0
              ? `
            <div style="text-align: center; padding: 40px; color: #6B7280;">
              <p>No new activity to report. Have a great day!</p>
            </div>
          `
              : `
            <div style="text-align: center; margin-top: 24px;">
              <a href="${process.env.APP_URL ?? "https://app.drovi.io"}/dashboard" style="
                display: inline-block;
                background: #3B82F6;
                color: white;
                padding: 12px 24px;
                border-radius: 6px;
                text-decoration: none;
                font-weight: 500;
              ">
                View in Drovi
              </a>
            </div>
          `
          }
        </div>

        <div style="
          background: #F9FAFB;
          padding: 16px 24px;
          text-align: center;
          font-size: 12px;
          color: #6B7280;
        ">
          <p style="margin: 0;">
            <a href="${process.env.APP_URL ?? "https://app.drovi.io"}/settings/notifications" style="color: #3B82F6; text-decoration: none;">
              Manage notification preferences
            </a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

function getActivityVerb(activityType: string): string {
  switch (activityType) {
    case "commitment_created":
      return "created commitment";
    case "commitment_completed":
      return "completed";
    case "decision_made":
      return "made a decision on";
    case "task_assigned":
      return "assigned task";
    case "task_completed":
      return "completed task";
    case "comment_added":
      return "commented on";
    default:
      return "updated";
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
