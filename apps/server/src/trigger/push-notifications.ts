// =============================================================================
// PUSH NOTIFICATION TRIGGER TASKS
// =============================================================================
//
// Background tasks for sending Web Push notifications.
//

import { db } from "@memorystack/db";
import { pushSubscription } from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  silent?: boolean;
}

interface SendResult {
  subscriptionId: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// SEND PUSH NOTIFICATION TASK
// =============================================================================

/**
 * Send a push notification to all active subscriptions for a user.
 */
export const sendPushNotificationTask = task({
  id: "push-notification-send",
  queue: {
    name: "push-notifications",
    concurrencyLimit: 50,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: PushNotificationPayload): Promise<{
    success: boolean;
    sentCount: number;
    failedCount: number;
    results: SendResult[];
  }> => {
    const { userId, title, body, icon, badge, tag, data, requireInteraction, silent } =
      payload;

    log.info("Sending push notification", { userId, title });

    // Get all active subscriptions for the user
    const subscriptions = await db.query.pushSubscription.findMany({
      where: and(
        eq(pushSubscription.userId, userId),
        eq(pushSubscription.isActive, true)
      ),
    });

    if (subscriptions.length === 0) {
      log.info("No active push subscriptions for user", { userId });
      return { success: true, sentCount: 0, failedCount: 0, results: [] };
    }

    // Check for VAPID keys
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const vapidSubject = process.env.VAPID_SUBJECT || "mailto:support@drovi.io";

    if (!vapidPublicKey || !vapidPrivateKey) {
      log.error("VAPID keys not configured");
      return {
        success: false,
        sentCount: 0,
        failedCount: subscriptions.length,
        results: subscriptions.map((s) => ({
          subscriptionId: s.id,
          success: false,
          error: "VAPID keys not configured",
        })),
      };
    }

    // Import web-push dynamically
    const webpush = await import("web-push");
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    // Build notification payload
    const notificationPayload = JSON.stringify({
      title,
      body,
      icon: icon || "/icons/notification-icon.png",
      badge: badge || "/icons/badge-icon.png",
      tag,
      data: {
        ...data,
        timestamp: Date.now(),
      },
      requireInteraction: requireInteraction ?? false,
      silent: silent ?? false,
    });

    // Send to all subscriptions
    const results: SendResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
            },
          },
          notificationPayload
        );

        // Update last used timestamp
        await db
          .update(pushSubscription)
          .set({ lastUsedAt: new Date(), failureCount: "0" })
          .where(eq(pushSubscription.id, subscription.id));

        results.push({ subscriptionId: subscription.id, success: true });
        sentCount++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const statusCode =
          error instanceof Error && "statusCode" in error
            ? (error as { statusCode: number }).statusCode
            : 0;

        log.error("Failed to send push notification", error, {
          subscriptionId: subscription.id,
          statusCode,
        });

        // Handle subscription expiration (410 Gone) or invalid (404)
        if (statusCode === 410 || statusCode === 404) {
          // Subscription is no longer valid, deactivate it
          await db
            .update(pushSubscription)
            .set({ isActive: false })
            .where(eq(pushSubscription.id, subscription.id));
        } else {
          // Increment failure count
          const currentFailures = Number(subscription.failureCount || "0");
          if (currentFailures >= 5) {
            // Too many failures, deactivate
            await db
              .update(pushSubscription)
              .set({ isActive: false })
              .where(eq(pushSubscription.id, subscription.id));
          } else {
            await db
              .update(pushSubscription)
              .set({ failureCount: `${currentFailures + 1}` })
              .where(eq(pushSubscription.id, subscription.id));
          }
        }

        results.push({
          subscriptionId: subscription.id,
          success: false,
          error: errorMessage,
        });
        failedCount++;
      }
    }

    log.info("Push notification task completed", {
      userId,
      sentCount,
      failedCount,
    });

    return {
      success: failedCount === 0,
      sentCount,
      failedCount,
      results,
    };
  },
});

// =============================================================================
// BROADCAST PUSH NOTIFICATION TASK
// =============================================================================

/**
 * Send a push notification to multiple users.
 */
export const broadcastPushNotificationTask = task({
  id: "push-notification-broadcast",
  queue: {
    name: "push-notifications-broadcast",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 300,
  run: async (payload: {
    userIds: string[];
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    data?: Record<string, unknown>;
  }) => {
    const { userIds, title, body, icon, tag, data } = payload;

    log.info("Broadcasting push notification", {
      userCount: userIds.length,
      title,
    });

    let totalSent = 0;
    let totalFailed = 0;

    // Process in chunks
    const chunkSize = 50;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map((userId) =>
          sendPushNotificationTask.triggerAndWait({
            userId,
            title,
            body,
            icon,
            tag,
            data,
          })
        )
      );

      for (const result of results) {
        if (result.ok) {
          totalSent += result.output.sentCount;
          totalFailed += result.output.failedCount;
        }
      }
    }

    log.info("Broadcast push notification completed", {
      userCount: userIds.length,
      totalSent,
      totalFailed,
    });

    return {
      success: true,
      userCount: userIds.length,
      totalSent,
      totalFailed,
    };
  },
});

// =============================================================================
// HELPER: SEND NOTIFICATION FOR MENTION
// =============================================================================

/**
 * Helper to send a push notification for a mention.
 */
export async function sendMentionPushNotification(
  userId: string,
  mentionerName: string,
  contextType: string,
  contextPreview: string,
  link: string
) {
  return sendPushNotificationTask.trigger({
    userId,
    title: `${mentionerName} mentioned you`,
    body: contextPreview,
    icon: "/icons/mention-icon.png",
    tag: `mention-${Date.now()}`,
    data: {
      type: "mention",
      contextType,
      link,
    },
    requireInteraction: true,
  });
}

// =============================================================================
// HELPER: SEND NOTIFICATION FOR ACTIVITY
// =============================================================================

/**
 * Helper to send a push notification for activity.
 */
export async function sendActivityPushNotification(
  userId: string,
  title: string,
  body: string,
  activityType: string,
  link: string
) {
  return sendPushNotificationTask.trigger({
    userId,
    title,
    body,
    icon: "/icons/activity-icon.png",
    tag: `activity-${activityType}-${Date.now()}`,
    data: {
      type: "activity",
      activityType,
      link,
    },
  });
}

// =============================================================================
// HELPER: SEND NOTIFICATION FOR DEADLINE
// =============================================================================

/**
 * Helper to send a push notification for approaching deadline.
 */
export async function sendDeadlinePushNotification(
  userId: string,
  commitmentTitle: string,
  dueDate: Date,
  link: string
) {
  const now = new Date();
  const hoursUntilDue = Math.round(
    (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60)
  );

  let timeText: string;
  if (hoursUntilDue < 0) {
    timeText = "is overdue";
  } else if (hoursUntilDue === 0) {
    timeText = "is due now";
  } else if (hoursUntilDue < 24) {
    timeText = `is due in ${hoursUntilDue} hour${hoursUntilDue > 1 ? "s" : ""}`;
  } else {
    const days = Math.round(hoursUntilDue / 24);
    timeText = `is due in ${days} day${days > 1 ? "s" : ""}`;
  }

  return sendPushNotificationTask.trigger({
    userId,
    title: "Commitment Reminder",
    body: `"${commitmentTitle}" ${timeText}`,
    icon: "/icons/deadline-icon.png",
    tag: `deadline-${commitmentTitle.slice(0, 20)}`,
    data: {
      type: "deadline",
      link,
    },
    requireInteraction: hoursUntilDue < 0,
  });
}
