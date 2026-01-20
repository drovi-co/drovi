import { randomUUID } from "node:crypto";
import { db } from "@memorystack/db";
import { notification, notificationPreferences } from "@memorystack/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// TYPES
// =============================================================================

export type NotificationCategory =
  | "commitment"
  | "decision"
  | "calendar"
  | "email"
  | "system";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface NotificationInput {
  type: "info" | "success" | "warning" | "error" | "system";
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
  priority?: NotificationPriority;
  groupKey?: string;
  entityId?: string;
  entityType?: string;
  actionRequired?: boolean;
  actionType?: string;
}

// =============================================================================
// DEFAULT PREFERENCES
// =============================================================================

const DEFAULT_PREFERENCES = {
  inAppEnabled: true,
  emailDigestEnabled: true,
  emailDigestFrequency: "daily",
  commitmentsNewEnabled: true,
  commitmentsDueEnabled: true,
  commitmentsOverdueEnabled: true,
  decisionsNewEnabled: true,
  decisionsSupersededEnabled: true,
  calendarRemindersEnabled: true,
  emailUrgentEnabled: true,
  emailImportantEnabled: true,
  syncStatusEnabled: false,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  quietHoursTimezone: null,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

type QuietHoursPrefs = {
  quietHoursEnabled?: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
};

function isInQuietHours(prefs: QuietHoursPrefs): boolean {
  if (
    !(prefs?.quietHoursEnabled && prefs.quietHoursStart && prefs.quietHoursEnd)
  ) {
    return false;
  }

  const now = new Date();
  const timezone = prefs.quietHoursTimezone || "UTC";

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTime = formatter.format(now);
    const [currentHour, currentMinute] = currentTime.split(":").map(Number);
    const currentMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = prefs.quietHoursStart
      .split(":")
      .map(Number);
    const [endHour, endMinute] = prefs.quietHoursEnd.split(":").map(Number);
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } catch {
    return false;
  }
}

type NotificationPrefs = {
  inAppEnabled?: boolean;
  commitmentsNewEnabled?: boolean;
  commitmentsDueEnabled?: boolean;
  commitmentsOverdueEnabled?: boolean;
  decisionsNewEnabled?: boolean;
  decisionsSupersededEnabled?: boolean;
  calendarRemindersEnabled?: boolean;
  emailUrgentEnabled?: boolean;
  emailImportantEnabled?: boolean;
  syncStatusEnabled?: boolean;
};

function isCategoryEnabled(
  category: NotificationCategory,
  prefs: NotificationPrefs | null,
  subcategory?: string
): boolean {
  if (!prefs?.inAppEnabled) return false;

  switch (category) {
    case "commitment":
      if (subcategory === "new") return prefs.commitmentsNewEnabled ?? false;
      if (subcategory === "due") return prefs.commitmentsDueEnabled ?? false;
      if (subcategory === "overdue")
        return prefs.commitmentsOverdueEnabled ?? false;
      return (
        (prefs.commitmentsNewEnabled ?? false) ||
        (prefs.commitmentsDueEnabled ?? false) ||
        (prefs.commitmentsOverdueEnabled ?? false)
      );
    case "decision":
      if (subcategory === "new") return prefs.decisionsNewEnabled ?? false;
      if (subcategory === "superseded")
        return prefs.decisionsSupersededEnabled ?? false;
      return (
        (prefs.decisionsNewEnabled ?? false) ||
        (prefs.decisionsSupersededEnabled ?? false)
      );
    case "calendar":
      return prefs.calendarRemindersEnabled ?? false;
    case "email":
      if (subcategory === "urgent") return prefs.emailUrgentEnabled ?? false;
      if (subcategory === "important")
        return prefs.emailImportantEnabled ?? false;
      return (
        (prefs.emailUrgentEnabled ?? false) ||
        (prefs.emailImportantEnabled ?? false)
      );
    case "system":
      return prefs.syncStatusEnabled ?? false;
    default:
      return true;
  }
}

// =============================================================================
// ROUTER
// =============================================================================

export const notificationsRouter = router({
  /**
   * Get user's notifications
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
        unreadOnly: z.boolean().default(false),
        category: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { limit, unreadOnly, category } = input;

      const conditions = [eq(notification.userId, userId)];
      if (unreadOnly) {
        conditions.push(eq(notification.read, false));
      }
      if (category) {
        conditions.push(eq(notification.category, category));
      }

      const notifications = await db.query.notification.findMany({
        where: and(...conditions),
        orderBy: [desc(notification.createdAt)],
        limit: limit + 1,
      });

      let nextCursor: string | undefined;
      if (notifications.length > limit) {
        const nextItem = notifications.pop();
        nextCursor = nextItem?.id;
      }

      return {
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          category: n.category,
          title: n.title,
          message: n.message,
          link: n.link,
          read: n.read,
          priority: n.priority,
          entityId: n.entityId,
          entityType: n.entityType,
          actionRequired: n.actionRequired,
          actionType: n.actionType,
          metadata: n.metadata ? JSON.parse(n.metadata) : null,
          createdAt: n.createdAt,
        })),
        nextCursor,
      };
    }),

  /**
   * Get grouped notifications (for premium UI)
   */
  listGrouped: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { category } = input;

      const conditions = [eq(notification.userId, userId)];
      if (category && category !== "all") {
        conditions.push(eq(notification.category, category));
      }

      const notifications = await db.query.notification.findMany({
        where: and(...conditions),
        orderBy: [desc(notification.createdAt)],
        limit: 100,
      });

      // Group by time periods
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const yesterdayStart = new Date(
        todayStart.getTime() - 24 * 60 * 60 * 1000
      );
      const weekStart = new Date(
        todayStart.getTime() - 7 * 24 * 60 * 60 * 1000
      );

      const grouped = {
        today: [] as typeof notifications,
        yesterday: [] as typeof notifications,
        thisWeek: [] as typeof notifications,
        older: [] as typeof notifications,
      };

      for (const n of notifications) {
        const createdAt = new Date(n.createdAt);
        if (createdAt >= todayStart) {
          grouped.today.push(n);
        } else if (createdAt >= yesterdayStart) {
          grouped.yesterday.push(n);
        } else if (createdAt >= weekStart) {
          grouped.thisWeek.push(n);
        } else {
          grouped.older.push(n);
        }
      }

      const formatNotification = (n: (typeof notifications)[0]) => ({
        id: n.id,
        type: n.type,
        category: n.category,
        title: n.title,
        message: n.message,
        link: n.link,
        read: n.read,
        priority: n.priority,
        entityId: n.entityId,
        entityType: n.entityType,
        actionRequired: n.actionRequired,
        actionType: n.actionType,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
        createdAt: n.createdAt,
      });

      return {
        today: grouped.today.map(formatNotification),
        yesterday: grouped.yesterday.map(formatNotification),
        thisWeek: grouped.thisWeek.map(formatNotification),
        older: grouped.older.map(formatNotification),
      };
    }),

  /**
   * Get unread count
   */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(notification)
      .where(
        and(eq(notification.userId, userId), eq(notification.read, false))
      );

    return { count: result[0]?.count ?? 0 };
  }),

  /**
   * Get notification preferences
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, userId),
    });

    return prefs ?? DEFAULT_PREFERENCES;
  }),

  /**
   * Update notification preferences
   */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        inAppEnabled: z.boolean().optional(),
        emailDigestEnabled: z.boolean().optional(),
        emailDigestFrequency: z
          .enum(["daily", "weekly", "realtime", "never"])
          .optional(),
        commitmentsNewEnabled: z.boolean().optional(),
        commitmentsDueEnabled: z.boolean().optional(),
        commitmentsOverdueEnabled: z.boolean().optional(),
        decisionsNewEnabled: z.boolean().optional(),
        decisionsSupersededEnabled: z.boolean().optional(),
        calendarRemindersEnabled: z.boolean().optional(),
        emailUrgentEnabled: z.boolean().optional(),
        emailImportantEnabled: z.boolean().optional(),
        syncStatusEnabled: z.boolean().optional(),
        quietHoursEnabled: z.boolean().optional(),
        quietHoursStart: z.string().optional(),
        quietHoursEnd: z.string().optional(),
        quietHoursTimezone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if preferences exist
      const existing = await db.query.notificationPreferences.findFirst({
        where: eq(notificationPreferences.userId, userId),
      });

      if (existing) {
        await db
          .update(notificationPreferences)
          .set(input)
          .where(eq(notificationPreferences.userId, userId));
      } else {
        await db.insert(notificationPreferences).values({
          id: randomUUID(),
          userId,
          ...input,
        });
      }

      return { success: true };
    }),

  /**
   * Mark notification as read
   */
  markAsRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .update(notification)
        .set({ read: true })
        .where(
          and(eq(notification.id, input.id), eq(notification.userId, userId))
        );

      return { success: true };
    }),

  /**
   * Mark all notifications as read
   */
  markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await db
      .update(notification)
      .set({ read: true })
      .where(
        and(eq(notification.userId, userId), eq(notification.read, false))
      );

    return { success: true };
  }),

  /**
   * Mark all notifications in a category as read
   */
  markCategoryAsRead: protectedProcedure
    .input(z.object({ category: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .update(notification)
        .set({ read: true })
        .where(
          and(
            eq(notification.userId, userId),
            eq(notification.category, input.category),
            eq(notification.read, false)
          )
        );

      return { success: true };
    }),

  /**
   * Delete a notification
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await db
        .delete(notification)
        .where(
          and(eq(notification.id, input.id), eq(notification.userId, userId))
        );

      return { success: true };
    }),

  /**
   * Delete all read notifications
   */
  deleteAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await db
      .delete(notification)
      .where(and(eq(notification.userId, userId), eq(notification.read, true)));

    return { success: true };
  }),

  /**
   * Delete all notifications
   */
  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await db.delete(notification).where(eq(notification.userId, userId));

    return { success: true };
  }),
});

// =============================================================================
// HELPER FUNCTIONS FOR NOTIFICATION CREATION
// =============================================================================

/**
 * Get user's notification preferences
 */
export async function getUserNotificationPreferences(userId: string) {
  const prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });
  return prefs ?? DEFAULT_PREFERENCES;
}

/**
 * Create a notification with preference checking
 */
export async function createNotification(
  userId: string,
  data: NotificationInput,
  subcategory?: string
): Promise<{ id?: string; skipped?: boolean; queued?: boolean }> {
  // 1. Get user preferences
  const prefs = await getUserNotificationPreferences(userId);

  // 2. Check quiet hours
  if (isInQuietHours(prefs)) {
    // In a real implementation, we might queue this for later
    return { queued: true };
  }

  // 3. Check if category is enabled
  if (!isCategoryEnabled(data.category, prefs, subcategory)) {
    return { skipped: true };
  }

  // 4. Create notification
  const id = randomUUID();

  await db.insert(notification).values({
    id,
    userId,
    type: data.type,
    category: data.category,
    title: data.title,
    message: data.message,
    link: data.link,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    priority: data.priority ?? "normal",
    groupKey: data.groupKey,
    entityId: data.entityId,
    entityType: data.entityType,
    actionRequired: data.actionRequired ?? false,
    actionType: data.actionType,
  });

  return { id };
}

/**
 * Create notification without preference checking (for system notifications)
 */
export async function createSystemNotification(
  userId: string,
  data: Omit<NotificationInput, "category">
): Promise<{ id: string }> {
  const id = randomUUID();

  await db.insert(notification).values({
    id,
    userId,
    type: data.type,
    category: "system",
    title: data.title,
    message: data.message,
    link: data.link,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    priority: data.priority ?? "normal",
    groupKey: data.groupKey,
    entityId: data.entityId,
    entityType: data.entityType,
    actionRequired: data.actionRequired ?? false,
    actionType: data.actionType,
  });

  return { id };
}

/**
 * Broadcast notification to multiple users
 */
export async function broadcastNotification(
  userIds: string[],
  data: NotificationInput
): Promise<{ count: number }> {
  const notifications = userIds.map((userId) => ({
    id: randomUUID(),
    userId,
    type: data.type,
    category: data.category,
    title: data.title,
    message: data.message,
    link: data.link,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    priority: data.priority ?? "normal",
    groupKey: data.groupKey,
    entityId: data.entityId,
    entityType: data.entityType,
    actionRequired: data.actionRequired ?? false,
    actionType: data.actionType,
  }));

  if (notifications.length > 0) {
    await db.insert(notification).values(notifications);
  }

  return { count: notifications.length };
}
