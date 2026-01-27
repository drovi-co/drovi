import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./organization";

// ============================================================================
// Constants - Plan Configuration
// ============================================================================

/**
 * Plan definitions with features and limits
 * Only Pro and Enterprise tiers available
 */
export const PLANS = {
  pro: {
    name: "Pro",
    pricePerUser: 29, // $29/user/month
    features: [
      "Unlimited email connections",
      "AI intelligence extraction",
      "Commitment tracking",
      "Decision logging",
      "Contact intelligence",
      "Unlimited team members",
      "Priority support",
    ],
    limits: {
      maxUsers: Number.POSITIVE_INFINITY, // Unlimited, per-seat pricing
      maxSources: 5,
      aiCredits: 5000,
    },
  },
  enterprise: {
    name: "Enterprise",
    pricePerUser: null, // Custom pricing, contact sales
    features: [
      "Everything in Pro",
      "Unlimited sources",
      "SSO/SAML integration",
      "SCIM provisioning",
      "Advanced analytics",
      "Custom integrations",
      "Dedicated support",
      "SLA guarantees",
      "On-premise option",
    ],
    limits: {
      maxUsers: Number.POSITIVE_INFINITY,
      maxSources: Number.POSITIVE_INFINITY,
      aiCredits: 50_000,
    },
  },
} as const;

export type PlanType = keyof typeof PLANS;

// ============================================================================
// Enums
// ============================================================================

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial", // Free trial period
  "active", // Paid and active
  "past_due", // Payment failed, grace period
  "canceled", // User canceled, still active until period end
  "expired", // Subscription ended
]);

export const planTypeEnum = pgEnum("plan_type", ["pro", "enterprise"]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Subscription - tracks organization billing status
 * Per-user pricing with seat count
 */
export const subscription = pgTable(
  "subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Plan details
    planType: planTypeEnum("plan_type").notNull().default("pro"),
    status: subscriptionStatusEnum("status").notNull().default("trial"),

    // Per-user pricing
    seatCount: integer("seat_count").notNull().default(1),
    pricePerSeat: integer("price_per_seat").notNull().default(2900), // In cents ($29.00)

    // Trial tracking
    trialEndsAt: timestamp("trial_ends_at"),

    // Billing period
    currentPeriodStart: timestamp("current_period_start"),
    currentPeriodEnd: timestamp("current_period_end"),

    // Polar integration
    polarSubscriptionId: text("polar_subscription_id"),
    polarCustomerId: text("polar_customer_id"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("subscription_organization_id_idx").on(table.organizationId),
    index("subscription_status_idx").on(table.status),
    index("subscription_polar_subscription_id_idx").on(
      table.polarSubscriptionId
    ),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  organization: one(organization, {
    fields: [subscription.organizationId],
    references: [organization.id],
  }),
}));

// ============================================================================
// Types
// ============================================================================

export type Subscription = typeof subscription.$inferSelect;
export type NewSubscription = typeof subscription.$inferInsert;
export type SubscriptionStatus =
  (typeof subscriptionStatusEnum.enumValues)[number];
