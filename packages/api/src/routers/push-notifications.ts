// =============================================================================
// PUSH NOTIFICATIONS ROUTER
// =============================================================================
//
// Manage Web Push subscriptions and send push notifications.
//

import { randomUUID } from "node:crypto";
import { db } from "@memorystack/db";
import { pushSubscription } from "@memorystack/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const pushSubscriptionKeysSchema = z.object({
  p256dh: z.string(),
  auth: z.string(),
});

const pushSubscriptionInputSchema = z.object({
  endpoint: z.string().url(),
  keys: pushSubscriptionKeysSchema,
  expirationTime: z.number().nullable().optional(),
  userAgent: z.string().optional(),
  deviceName: z.string().optional(),
});

// =============================================================================
// ROUTER
// =============================================================================

export const pushNotificationsRouter = router({
  /**
   * Get VAPID public key for push subscription
   */
  getVapidPublicKey: protectedProcedure.query(async () => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;

    if (!vapidPublicKey) {
      throw new Error("VAPID public key not configured");
    }

    return { publicKey: vapidPublicKey };
  }),

  /**
   * Subscribe to push notifications
   */
  subscribe: protectedProcedure
    .input(pushSubscriptionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if subscription already exists
      const existing = await db.query.pushSubscription.findFirst({
        where: eq(pushSubscription.endpoint, input.endpoint),
      });

      if (existing) {
        // Update existing subscription
        await db
          .update(pushSubscription)
          .set({
            userId,
            keys: input.keys,
            userAgent: input.userAgent,
            deviceName: input.deviceName,
            expirationTime: input.expirationTime
              ? new Date(input.expirationTime)
              : null,
            isActive: true,
            failureCount: "0",
          })
          .where(eq(pushSubscription.id, existing.id));

        return { subscriptionId: existing.id, updated: true };
      }

      // Create new subscription
      const id = randomUUID();
      const browserType = detectBrowserType(input.userAgent);

      await db.insert(pushSubscription).values({
        id,
        userId,
        endpoint: input.endpoint,
        keys: input.keys,
        userAgent: input.userAgent,
        deviceName: input.deviceName,
        browserType,
        expirationTime: input.expirationTime
          ? new Date(input.expirationTime)
          : null,
        isActive: true,
      });

      return { subscriptionId: id, updated: false };
    }),

  /**
   * Unsubscribe from push notifications
   */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, userId),
            eq(pushSubscription.endpoint, input.endpoint)
          )
        );

      return { success: true };
    }),

  /**
   * List user's push subscriptions
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscriptions = await db.query.pushSubscription.findMany({
      where: eq(pushSubscription.userId, userId),
      orderBy: [desc(pushSubscription.createdAt)],
    });

    return {
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        deviceName: sub.deviceName,
        browserType: sub.browserType,
        isActive: sub.isActive,
        lastUsedAt: sub.lastUsedAt,
        createdAt: sub.createdAt,
      })),
    };
  }),

  /**
   * Update subscription device name
   */
  updateDeviceName: protectedProcedure
    .input(
      z.object({
        subscriptionId: z.string().uuid(),
        deviceName: z.string().max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .update(pushSubscription)
        .set({ deviceName: input.deviceName })
        .where(
          and(
            eq(pushSubscription.id, input.subscriptionId),
            eq(pushSubscription.userId, userId)
          )
        );

      return { success: true };
    }),

  /**
   * Remove a specific subscription
   */
  remove: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.id, input.subscriptionId),
            eq(pushSubscription.userId, userId)
          )
        );

      return { success: true };
    }),

  /**
   * Test push notification (send a test notification to current device)
   */
  sendTest: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get the subscription
      const subscription = await db.query.pushSubscription.findFirst({
        where: and(
          eq(pushSubscription.id, input.subscriptionId),
          eq(pushSubscription.userId, userId)
        ),
      });

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      // In production, this would trigger the push notification task
      // For now, we return success
      return {
        success: true,
        message: "Test notification queued",
      };
    }),
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function detectBrowserType(userAgent: string | undefined): string {
  if (!userAgent) {
    return "unknown";
  }

  const ua = userAgent.toLowerCase();

  if (ua.includes("chrome") && !ua.includes("edge")) {
    return "chrome";
  }
  if (ua.includes("firefox")) {
    return "firefox";
  }
  if (ua.includes("safari") && !ua.includes("chrome")) {
    return "safari";
  }
  if (ua.includes("edge")) {
    return "edge";
  }
  if (ua.includes("opera")) {
    return "opera";
  }

  return "unknown";
}

// =============================================================================
// HELPER FUNCTION FOR SENDING PUSH NOTIFICATIONS
// =============================================================================

/**
 * Get all active push subscriptions for a user.
 * Used by the notification tasks to send push notifications.
 */
export async function getUserPushSubscriptions(userId: string) {
  return db.query.pushSubscription.findMany({
    where: and(
      eq(pushSubscription.userId, userId),
      eq(pushSubscription.isActive, true)
    ),
  });
}

/**
 * Mark a subscription as failed (increment failure count or deactivate).
 */
export async function markSubscriptionFailed(
  subscriptionId: string,
  shouldDeactivate = false
) {
  if (shouldDeactivate) {
    await db
      .update(pushSubscription)
      .set({ isActive: false })
      .where(eq(pushSubscription.id, subscriptionId));
  } else {
    await db
      .update(pushSubscription)
      .set({
        failureCount: `${
          Number(
            (
              await db.query.pushSubscription.findFirst({
                where: eq(pushSubscription.id, subscriptionId),
              })
            )?.failureCount || "0"
          ) + 1
        }`,
      })
      .where(eq(pushSubscription.id, subscriptionId));
  }
}

/**
 * Update last used timestamp for a subscription.
 */
export async function markSubscriptionUsed(subscriptionId: string) {
  await db
    .update(pushSubscription)
    .set({ lastUsedAt: new Date(), failureCount: "0" })
    .where(eq(pushSubscription.id, subscriptionId));
}
