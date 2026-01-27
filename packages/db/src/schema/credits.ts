import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { organization } from "./organization";

// ============================================================================
// Constants
// ============================================================================

/** Monthly credit allocation per plan (Pro and Enterprise only) */
export const PLAN_CREDITS = {
  trial: 500, // Trial credits (7-day trial)
  pro: 5000, // Per-user credits for Pro plan
  enterprise: 50_000, // Per-org credits for Enterprise plan
} as const;

/** Trial configuration */
export const TRIAL_CONFIG = {
  durationDays: 7,
  credits: 500,
} as const;

/** Token to credit conversion ratio (1000 tokens = 1 credit) */
export const TOKEN_TO_CREDIT_RATIO = 1000;

// ============================================================================
// Enums
// ============================================================================

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "purchase", // Bought credit pack
  "subscription", // Monthly plan allocation
  "consumption", // Used on AI action
  "refund", // Refunded credits
  "trial", // Trial credits
  "bonus", // Promotional bonus
  "adjustment", // Admin adjustment
  "expiration", // Expired credits
]);

export const trialStatusEnum = pgEnum("trial_status", [
  "active", // Trial in progress
  "expired", // Trial ended without conversion
  "converted", // Converted to paid plan
]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Organization credits - main balance tracking at organization level
 * Shared across all team members
 */
export const organizationCredits = pgTable(
  "organization_credits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Credit balance
    balance: integer("balance").default(0).notNull(),
    lifetimeCredits: integer("lifetime_credits").default(0).notNull(),
    lifetimeUsed: integer("lifetime_used").default(0).notNull(),

    // Trial tracking
    trialStatus: trialStatusEnum("trial_status").default("active").notNull(),
    trialStartedAt: timestamp("trial_started_at"),
    trialEndsAt: timestamp("trial_ends_at"),
    trialCreditsGranted: integer("trial_credits_granted").default(0).notNull(),

    // Monthly allocation tracking
    monthlyAllocationDate: timestamp("monthly_allocation_date"),

    // Notification tracking
    lastLowBalanceNotification: timestamp("last_low_balance_notification"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("org_credits_organization_id_idx").on(table.organizationId)]
);

/**
 * Credit transaction - audit ledger for all credit changes
 * Tracks every credit movement with full context
 */
export const creditTransaction = pgTable(
  "credit_transaction",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),

    // Transaction details
    type: creditTransactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(), // Positive for additions, negative for deductions
    balanceBefore: integer("balance_before").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: text("description"),

    // Reference to related entity (e.g., purchase ID, request ID)
    referenceId: text("reference_id"),
    referenceType: text("reference_type"), // e.g., "polar_checkout", "ai_request", "subscription"

    // Token tracking for consumption transactions
    tokensUsed: integer("tokens_used"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    model: text("model"),

    // Additional context
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("credit_tx_organization_id_idx").on(table.organizationId),
    index("credit_tx_user_id_idx").on(table.userId),
    index("credit_tx_type_idx").on(table.type),
    index("credit_tx_created_at_idx").on(table.createdAt),
    index("credit_tx_reference_id_idx").on(table.referenceId),
  ]
);

/**
 * Credit package - purchasable credit packs via Polar
 */
export const creditPackage = pgTable(
  "credit_package",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),

    // Credit amounts
    credits: integer("credits").notNull(),
    bonusCredits: integer("bonus_credits").default(0).notNull(),

    // Pricing
    priceInCents: integer("price_in_cents").notNull(),

    // Polar integration
    polarProductId: text("polar_product_id").unique(),

    // Display settings
    active: boolean("active").default(true).notNull(),
    featured: boolean("featured").default(false).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("credit_package_active_idx").on(table.active),
    index("credit_package_polar_product_id_idx").on(table.polarProductId),
  ]
);

// ============================================================================
// Relations
// ============================================================================

export const organizationCreditsRelations = relations(
  organizationCredits,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationCredits.organizationId],
      references: [organization.id],
    }),
    transactions: many(creditTransaction),
  })
);

export const creditTransactionRelations = relations(
  creditTransaction,
  ({ one }) => ({
    organization: one(organization, {
      fields: [creditTransaction.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [creditTransaction.userId],
      references: [user.id],
    }),
    organizationCredits: one(organizationCredits, {
      fields: [creditTransaction.organizationId],
      references: [organizationCredits.organizationId],
    }),
  })
);

// ============================================================================
// Types
// ============================================================================

export type OrganizationCredits = typeof organizationCredits.$inferSelect;
export type NewOrganizationCredits = typeof organizationCredits.$inferInsert;
export type CreditTransaction = typeof creditTransaction.$inferSelect;
export type NewCreditTransaction = typeof creditTransaction.$inferInsert;
export type CreditPackage = typeof creditPackage.$inferSelect;
export type NewCreditPackage = typeof creditPackage.$inferInsert;
export type CreditTransactionType =
  (typeof creditTransactionTypeEnum.enumValues)[number];
export type TrialStatus = (typeof trialStatusEnum.enumValues)[number];

// ============================================================================
// Audit Actions (extends existing audit actions)
// ============================================================================

export const CreditAuditActions = {
  CREDITS_PURCHASED: "credits.purchased",
  CREDITS_CONSUMED: "credits.consumed",
  CREDITS_REFUNDED: "credits.refunded",
  CREDITS_ADJUSTED: "credits.adjusted",
  CREDITS_TRIAL_STARTED: "credits.trial_started",
  CREDITS_TRIAL_EXPIRED: "credits.trial_expired",
  CREDITS_TRIAL_CONVERTED: "credits.trial_converted",
  CREDITS_MONTHLY_ALLOCATED: "credits.monthly_allocated",
  CREDITS_LOW_BALANCE: "credits.low_balance",
} as const;

export type CreditAuditAction =
  (typeof CreditAuditActions)[keyof typeof CreditAuditActions];
