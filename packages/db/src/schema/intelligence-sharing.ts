import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { contact } from "./intelligence";
import { organization, team } from "./organization";
import { unifiedIntelligenceObject } from "./unified-intelligence";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * How the share was created
 */
export const shareTypeEnum = pgEnum("share_type", [
  "auto_mention", // Auto-shared because teammate was @mentioned
  "auto_participant", // Auto-shared because teammate is a participant
  "auto_owner", // Auto-shared because teammate is owner/assignee
  "manual", // Explicitly shared by user
  "team_policy", // Shared due to team privacy policy
  "inherited", // Inherited from parent object
]);

/**
 * Permission level for shared access
 */
export const sharePermissionEnum = pgEnum("share_permission", [
  "view", // Can view only
  "comment", // Can view and comment
  "edit", // Can view, comment, and edit
  "admin", // Full access including sharing
]);

/**
 * How a teammate contact link was established
 */
export const contactLinkMethodEnum = pgEnum("contact_link_method", [
  "email_match", // Matched by email address
  "sso_match", // Matched via SSO identity
  "manual", // Manually linked by admin
  "import", // Imported from external system
]);

// =============================================================================
// INTELLIGENCE SHARE TABLE
// =============================================================================

/**
 * Tracks sharing of unified intelligence objects (commitments, decisions, etc.)
 * with users, teams, or the entire organization.
 */
export const intelligenceShare = pgTable(
  "intelligence_share",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // What is being shared
    unifiedObjectId: text("unified_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),

    // ==========================================================================
    // SHARE TARGET (exactly one must be set)
    // ==========================================================================

    // Shared with a specific user
    sharedWithUserId: text("shared_with_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),

    // Shared with a team
    sharedWithTeamId: text("shared_with_team_id").references(() => team.id, {
      onDelete: "cascade",
    }),

    // Shared with entire organization
    sharedWithOrganization: boolean("shared_with_organization")
      .notNull()
      .default(false),

    // ==========================================================================
    // SHARE DETAILS
    // ==========================================================================

    // How was it shared
    shareType: shareTypeEnum("share_type").notNull(),

    // Permission level
    permission: sharePermissionEnum("permission").notNull().default("view"),

    // Why was it shared (for auto-shares)
    shareReason: text("share_reason"),

    // Related contact (for auto-shares based on contact involvement)
    relatedContactId: text("related_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),

    // The @mention text that triggered the share (if applicable)
    mentionText: text("mention_text"),

    // ==========================================================================
    // AUDIT
    // ==========================================================================

    // Who shared it (null for system auto-shares)
    sharedByUserId: text("shared_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Optional note from the sharer
    shareNote: text("share_note"),

    // ==========================================================================
    // NOTIFICATION TRACKING
    // ==========================================================================

    notificationSent: boolean("notification_sent").notNull().default(false),
    notificationSentAt: timestamp("notification_sent_at"),

    // ==========================================================================
    // ACCESS TRACKING
    // ==========================================================================

    lastAccessedAt: timestamp("last_accessed_at"),
    accessCount: integer("access_count").notNull().default(0),

    // ==========================================================================
    // EXPIRATION
    // ==========================================================================

    // Optional expiration for temporary shares
    expiresAt: timestamp("expires_at"),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    isActive: boolean("is_active").notNull().default(true),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

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
    index("intel_share_uio_idx").on(table.unifiedObjectId),
    index("intel_share_user_idx").on(table.sharedWithUserId),
    index("intel_share_team_idx").on(table.sharedWithTeamId),
    index("intel_share_type_idx").on(table.shareType),
    index("intel_share_active_idx").on(table.isActive),
    index("intel_share_expires_idx").on(table.expiresAt),
    // Prevent duplicate shares to the same user
    unique("intel_share_uio_user_unique").on(
      table.unifiedObjectId,
      table.sharedWithUserId
    ),
    // Prevent duplicate shares to the same team
    unique("intel_share_uio_team_unique").on(
      table.unifiedObjectId,
      table.sharedWithTeamId
    ),
  ]
);

// =============================================================================
// TEAMMATE CONTACT LINK TABLE
// =============================================================================

/**
 * Links internal team members to their Contact records.
 * Used for detecting when intelligence involves teammates and enabling auto-sharing.
 */
export const teammateContactLink = pgTable(
  "teammate_contact_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // The internal user
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // The contact record they're linked to
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    // ==========================================================================
    // LINK DETAILS
    // ==========================================================================

    // How the link was established
    linkMethod: contactLinkMethodEnum("link_method").notNull(),

    // Confidence in this link (1.0 for verified, lower for inferred)
    confidence: real("confidence").notNull().default(1.0),

    // Which email address was matched (for email_match method)
    matchedEmail: text("matched_email"),

    // ==========================================================================
    // VERIFICATION
    // ==========================================================================

    // Has this link been verified by admin or user?
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedByUserId: text("verified_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    isPrimary: boolean("is_primary").notNull().default(true), // Primary contact for this user
    isActive: boolean("is_active").notNull().default(true),

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
    index("teammate_link_org_idx").on(table.organizationId),
    index("teammate_link_user_idx").on(table.userId),
    index("teammate_link_contact_idx").on(table.contactId),
    index("teammate_link_verified_idx").on(table.isVerified),
    index("teammate_link_active_idx").on(table.isActive),
    // A user can only be linked to a contact once per org
    unique("teammate_link_user_contact_unique").on(table.userId, table.contactId),
  ]
);

// =============================================================================
// SHARE REQUEST TABLE (for requesting access)
// =============================================================================

/**
 * Tracks requests for access to intelligence objects.
 */
export const shareRequest = pgTable(
  "share_request",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // What they want access to
    unifiedObjectId: text("unified_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),

    // Who is requesting
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Requested permission level
    requestedPermission: sharePermissionEnum("requested_permission")
      .notNull()
      .default("view"),

    // Why they need access
    requestReason: text("request_reason"),

    // ==========================================================================
    // APPROVAL
    // ==========================================================================

    status: text("status").notNull().default("pending"), // "pending", "approved", "denied"

    // Who responded
    respondedByUserId: text("responded_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    respondedAt: timestamp("responded_at"),
    responseNote: text("response_note"),

    // Created share (if approved)
    createdShareId: text("created_share_id").references(
      () => intelligenceShare.id,
      { onDelete: "set null" }
    ),

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
    index("share_request_org_idx").on(table.organizationId),
    index("share_request_uio_idx").on(table.unifiedObjectId),
    index("share_request_user_idx").on(table.requestedByUserId),
    index("share_request_status_idx").on(table.status),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const intelligenceShareRelations = relations(
  intelligenceShare,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [intelligenceShare.unifiedObjectId],
      references: [unifiedIntelligenceObject.id],
    }),
    sharedWithUser: one(user, {
      fields: [intelligenceShare.sharedWithUserId],
      references: [user.id],
      relationName: "sharedWithUser",
    }),
    sharedWithTeam: one(team, {
      fields: [intelligenceShare.sharedWithTeamId],
      references: [team.id],
    }),
    sharedByUser: one(user, {
      fields: [intelligenceShare.sharedByUserId],
      references: [user.id],
      relationName: "sharedByUser",
    }),
    relatedContact: one(contact, {
      fields: [intelligenceShare.relatedContactId],
      references: [contact.id],
    }),
    revokedByUser: one(user, {
      fields: [intelligenceShare.revokedByUserId],
      references: [user.id],
      relationName: "revokedByUser",
    }),
  })
);

export const teammateContactLinkRelations = relations(
  teammateContactLink,
  ({ one }) => ({
    organization: one(organization, {
      fields: [teammateContactLink.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [teammateContactLink.userId],
      references: [user.id],
    }),
    contact: one(contact, {
      fields: [teammateContactLink.contactId],
      references: [contact.id],
    }),
    verifiedByUser: one(user, {
      fields: [teammateContactLink.verifiedByUserId],
      references: [user.id],
      relationName: "verifiedByUser",
    }),
  })
);

export const shareRequestRelations = relations(shareRequest, ({ one }) => ({
  organization: one(organization, {
    fields: [shareRequest.organizationId],
    references: [organization.id],
  }),
  unifiedObject: one(unifiedIntelligenceObject, {
    fields: [shareRequest.unifiedObjectId],
    references: [unifiedIntelligenceObject.id],
  }),
  requestedByUser: one(user, {
    fields: [shareRequest.requestedByUserId],
    references: [user.id],
    relationName: "requestedByUser",
  }),
  respondedByUser: one(user, {
    fields: [shareRequest.respondedByUserId],
    references: [user.id],
    relationName: "respondedByUser",
  }),
  createdShare: one(intelligenceShare, {
    fields: [shareRequest.createdShareId],
    references: [intelligenceShare.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type IntelligenceShare = typeof intelligenceShare.$inferSelect;
export type NewIntelligenceShare = typeof intelligenceShare.$inferInsert;
export type TeammateContactLink = typeof teammateContactLink.$inferSelect;
export type NewTeammateContactLink = typeof teammateContactLink.$inferInsert;
export type ShareRequest = typeof shareRequest.$inferSelect;
export type NewShareRequest = typeof shareRequest.$inferInsert;

// Type unions
export type ShareType =
  | "auto_mention"
  | "auto_participant"
  | "auto_owner"
  | "manual"
  | "team_policy"
  | "inherited";
export type SharePermission = "view" | "comment" | "edit" | "admin";
export type ContactLinkMethod =
  | "email_match"
  | "sso_match"
  | "manual"
  | "import";
