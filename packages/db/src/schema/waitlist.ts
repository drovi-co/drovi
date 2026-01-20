import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Waitlist application status
 */
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "pending", // Awaiting review
  "approved", // Approved, invite code generated
  "rejected", // Application rejected
  "converted", // User signed up using invite code
]);

// =============================================================================
// WAITLIST APPLICATION TABLE
// =============================================================================

/**
 * Stores waitlist applications with user-provided information.
 * Each application can have one invite code when approved.
 */
export const waitlistApplication = pgTable(
  "waitlist_application",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Applicant information
    email: text("email").notNull(),
    name: text("name").notNull(),
    company: text("company"),
    role: text("role"), // Job title/role
    useCase: text("use_case"), // Why they want to use MEMORYSTACK

    // Application status
    status: waitlistStatusEnum("status").notNull().default("pending"),

    // Admin management
    reviewedById: text("reviewed_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    adminNotes: text("admin_notes"), // Internal notes (not shown to user)
    rejectionReason: text("rejection_reason"), // Reason shown to user if rejected

    // Metadata
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    referralSource: text("referral_source"), // How they found MEMORYSTACK

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Prevent duplicate applications from same email
    unique("waitlist_email_unique").on(table.email),
    // Indexes for admin queries
    index("waitlist_status_idx").on(table.status),
    index("waitlist_created_at_idx").on(table.createdAt),
    index("waitlist_email_idx").on(table.email),
  ]
);

// =============================================================================
// INVITE CODE TABLE
// =============================================================================

/**
 * Unique invite codes for approved waitlist applicants.
 * One-to-one relationship with approved applications.
 */
export const inviteCode = pgTable(
  "invite_code",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // The unique invite code (e.g., "DROVI-ABC123")
    code: text("code").notNull().unique(),

    // Link to waitlist application
    waitlistApplicationId: text("waitlist_application_id")
      .notNull()
      .unique() // One code per application
      .references(() => waitlistApplication.id, { onDelete: "cascade" }),

    // Usage tracking
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByUserId: text("used_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Expiration (optional, for time-limited invites)
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Email tracking
    lastEmailSentAt: timestamp("last_email_sent_at", { withTimezone: true }),
    emailSendCount: integer("email_send_count").default(0),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("invite_code_code_idx").on(table.code),
    index("invite_code_application_idx").on(table.waitlistApplicationId),
    index("invite_code_expires_idx").on(table.expiresAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const waitlistApplicationRelations = relations(
  waitlistApplication,
  ({ one }) => ({
    reviewedBy: one(user, {
      fields: [waitlistApplication.reviewedById],
      references: [user.id],
    }),
    inviteCode: one(inviteCode, {
      fields: [waitlistApplication.id],
      references: [inviteCode.waitlistApplicationId],
    }),
  })
);

export const inviteCodeRelations = relations(inviteCode, ({ one }) => ({
  waitlistApplication: one(waitlistApplication, {
    fields: [inviteCode.waitlistApplicationId],
    references: [waitlistApplication.id],
  }),
  usedByUser: one(user, {
    fields: [inviteCode.usedByUserId],
    references: [user.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type WaitlistApplication = typeof waitlistApplication.$inferSelect;
export type NewWaitlistApplication = typeof waitlistApplication.$inferInsert;
export type InviteCode = typeof inviteCode.$inferSelect;
export type NewInviteCode = typeof inviteCode.$inferInsert;
export type WaitlistStatus = "pending" | "approved" | "rejected" | "converted";
