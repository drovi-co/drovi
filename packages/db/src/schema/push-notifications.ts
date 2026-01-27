import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// =============================================================================
// PUSH SUBSCRIPTION KEYS TYPE
// =============================================================================

/**
 * Web Push subscription keys (p256dh and auth)
 */
export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

// =============================================================================
// PUSH SUBSCRIPTION TABLE
// =============================================================================

/**
 * Web Push API subscriptions for browser push notifications.
 */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // ==========================================================================
    // SUBSCRIPTION DETAILS
    // ==========================================================================

    // The push endpoint URL provided by the browser
    endpoint: text("endpoint").notNull().unique(),

    // Subscription keys for encryption
    keys: jsonb("keys").$type<PushSubscriptionKeys>().notNull(),

    // ==========================================================================
    // DEVICE INFO
    // ==========================================================================

    // User agent of the subscribing browser/device
    userAgent: text("user_agent"),

    // Friendly name for the device (optional, set by user)
    deviceName: text("device_name"),

    // Browser type (chrome, firefox, safari, etc.)
    browserType: text("browser_type"),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    // Whether this subscription is active
    isActive: boolean("is_active").notNull().default(true),

    // When the subscription was last used to send a notification
    lastUsedAt: timestamp("last_used_at"),

    // Subscription expiration time (if provided by browser)
    expirationTime: timestamp("expiration_time"),

    // Number of failed delivery attempts
    failureCount: text("failure_count").default("0"),

    // ==========================================================================
    // TIMESTAMPS
    // ==========================================================================

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("push_subscription_user_idx").on(table.userId),
    index("push_subscription_endpoint_idx").on(table.endpoint),
    index("push_subscription_active_idx").on(table.isActive),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const pushSubscriptionRelations = relations(
  pushSubscription,
  ({ one }) => ({
    user: one(user, {
      fields: [pushSubscription.userId],
      references: [user.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PushSubscription = typeof pushSubscription.$inferSelect;
export type NewPushSubscription = typeof pushSubscription.$inferInsert;
