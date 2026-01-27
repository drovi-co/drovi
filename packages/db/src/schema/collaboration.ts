import { randomUUID } from "node:crypto";
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
import { organization, team } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Emoji reaction with users who reacted
 */
export interface Reaction {
  emoji: string;
  userIds: string[];
  count: number;
}

/**
 * Attachment on a comment
 */
export interface CommentAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/**
 * Activity metadata varies by type
 */
export interface ActivityMetadata {
  // Generic
  title?: string;
  description?: string;

  // For status changes
  previousStatus?: string;
  newStatus?: string;

  // For assignments
  assigneeId?: string;
  assigneeName?: string;

  // For mentions
  mentionText?: string;

  // For shares
  sharePermission?: string;
  sharedWithName?: string;

  // For deadlines
  dueDate?: string;
  previousDueDate?: string;

  // For comments
  commentPreview?: string;

  // Custom data
  [key: string]: unknown;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Types of mentions
 */
export const mentionTypeEnum = pgEnum("mention_type", [
  "user", // @username
  "team", // @team-name
  "all", // @all or @everyone
  "channel", // @channel (current participants)
]);

/**
 * Context where a mention can occur
 */
export const mentionContextTypeEnum = pgEnum("mention_context_type", [
  "conversation",
  "commitment",
  "decision",
  "task",
  "uio",
  "contact",
  "comment",
  "note",
]);

/**
 * Target type for comments
 */
export const commentTargetTypeEnum = pgEnum("comment_target_type", [
  "conversation",
  "commitment",
  "decision",
  "task",
  "uio",
  "contact",
]);

/**
 * Activity types for the feed
 */
export const activityTypeEnum = pgEnum("activity_type", [
  // Intelligence creation
  "commitment_created",
  "commitment_updated",
  "commitment_completed",
  "commitment_overdue",
  "decision_made",
  "decision_updated",
  "decision_reversed",
  "task_created",
  "task_assigned",
  "task_completed",

  // Collaboration
  "comment_added",
  "comment_resolved",
  "mention",
  "share",
  "share_request",

  // Inbox
  "conversation_assigned",
  "conversation_claimed",
  "conversation_resolved",
  "conversation_escalated",

  // Deadlines
  "deadline_approaching",
  "deadline_missed",

  // Risk
  "risk_detected",
  "risk_resolved",

  // System
  "member_joined",
  "member_left",
  "settings_changed",
]);

/**
 * Activity visibility
 */
export const activityVisibilityEnum = pgEnum("activity_visibility", [
  "private", // Only the creator sees it
  "team", // Visible to specific teams
  "organization", // Visible to entire org
]);

// =============================================================================
// MENTION TABLE
// =============================================================================

/**
 * Tracks @mentions across the platform.
 */
export const mention = pgTable(
  "mention",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // WHO MENTIONED
    // ==========================================================================

    mentionedByUserId: text("mentioned_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // ==========================================================================
    // MENTION TARGET
    // ==========================================================================

    // Type of mention
    mentionType: mentionTypeEnum("mention_type").notNull(),

    // Who was mentioned (depends on type)
    mentionedUserId: text("mentioned_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    mentionedTeamId: text("mentioned_team_id").references(() => team.id, {
      onDelete: "cascade",
    }),

    // ==========================================================================
    // CONTEXT
    // ==========================================================================

    // Where the mention occurred
    contextType: mentionContextTypeEnum("context_type").notNull(),
    contextId: text("context_id").notNull(),

    // The actual mention text as written
    mentionText: text("mention_text").notNull(),

    // Surrounding context (preview)
    contextPreview: text("context_preview"),

    // ==========================================================================
    // NOTIFICATION TRACKING
    // ==========================================================================

    // When was the notification sent?
    notifiedAt: timestamp("notified_at"),

    // Has the mentioned user read this?
    readAt: timestamp("read_at"),

    // Has the mentioned user clicked through?
    clickedAt: timestamp("clicked_at"),

    // ==========================================================================
    // TIMESTAMPS
    // ==========================================================================

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("mention_org_idx").on(table.organizationId),
    index("mention_by_user_idx").on(table.mentionedByUserId),
    index("mention_user_idx").on(table.mentionedUserId),
    index("mention_team_idx").on(table.mentionedTeamId),
    index("mention_context_idx").on(table.contextType, table.contextId),
    index("mention_read_idx").on(table.readAt),
    index("mention_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// COMMENT TABLE
// =============================================================================

/**
 * Comments/discussions on any resource.
 */
export const comment = pgTable(
  "comment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // AUTHOR
    // ==========================================================================

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // ==========================================================================
    // TARGET
    // ==========================================================================

    // What is being commented on
    targetType: commentTargetTypeEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),

    // ==========================================================================
    // THREADING
    // ==========================================================================

    // Parent comment for replies (null for top-level)
    // Note: Self-reference defined inline to avoid circular type issues
    parentCommentId: text("parent_comment_id"),

    // Root comment of this thread (for easy queries)
    rootCommentId: text("root_comment_id"),

    // Thread depth (0 = top level)
    depth: integer("depth").notNull().default(0),

    // ==========================================================================
    // CONTENT
    // ==========================================================================

    // Rich text content (supports markdown, mentions)
    content: text("content").notNull(),

    // Plain text version for search
    contentPlainText: text("content_plain_text"),

    // Attachments
    attachments: jsonb("attachments").$type<CommentAttachment[]>().default([]),

    // Emoji reactions
    reactions: jsonb("reactions").$type<Reaction[]>().default([]),

    // ==========================================================================
    // RESOLUTION
    // ==========================================================================

    // Is this thread resolved?
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    // Was this comment edited?
    isEdited: boolean("is_edited").notNull().default(false),
    editedAt: timestamp("edited_at"),

    // Soft delete
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    deletedByUserId: text("deleted_by_user_id").references(() => user.id, {
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
    index("comment_org_idx").on(table.organizationId),
    index("comment_user_idx").on(table.userId),
    index("comment_target_idx").on(table.targetType, table.targetId),
    index("comment_parent_idx").on(table.parentCommentId),
    index("comment_root_idx").on(table.rootCommentId),
    index("comment_resolved_idx").on(table.isResolved),
    index("comment_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// ACTIVITY TABLE
// =============================================================================

/**
 * Activity feed events for team awareness.
 */
export const activity = pgTable(
  "activity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // ACTOR
    // ==========================================================================

    // Who performed the action (null for system events)
    userId: text("user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // ==========================================================================
    // ACTIVITY TYPE
    // ==========================================================================

    activityType: activityTypeEnum("activity_type").notNull(),

    // ==========================================================================
    // TARGET
    // ==========================================================================

    // What the activity is about
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    targetTitle: text("target_title"),

    // ==========================================================================
    // METADATA
    // ==========================================================================

    // Activity-specific data
    metadata: jsonb("metadata").$type<ActivityMetadata>(),

    // ==========================================================================
    // VISIBILITY
    // ==========================================================================

    visibility: activityVisibilityEnum("visibility")
      .notNull()
      .default("organization"),

    // Specific teams that can see this (when visibility = "team")
    visibleToTeamIds: text("visible_to_team_ids").array().default([]),

    // Specific users that can see this
    visibleToUserIds: text("visible_to_user_ids").array().default([]),

    // ==========================================================================
    // AGGREGATION
    // ==========================================================================

    // Group ID for aggregating similar activities
    aggregationKey: text("aggregation_key"),

    // Is this a grouped activity?
    isAggregated: boolean("is_aggregated").notNull().default(false),
    aggregatedCount: integer("aggregated_count").notNull().default(1),

    // ==========================================================================
    // TIMESTAMPS
    // ==========================================================================

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("activity_org_idx").on(table.organizationId),
    index("activity_user_idx").on(table.userId),
    index("activity_type_idx").on(table.activityType),
    index("activity_target_idx").on(table.targetType, table.targetId),
    index("activity_visibility_idx").on(table.visibility),
    index("activity_aggregation_idx").on(table.aggregationKey),
    index("activity_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// ACTIVITY READ STATUS TABLE
// =============================================================================

/**
 * Tracks which activities a user has seen.
 */
export const activityReadStatus = pgTable(
  "activity_read_status",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Last activity ID they've seen
    lastSeenActivityId: text("last_seen_activity_id"),

    // Last time they viewed the activity feed
    lastViewedAt: timestamp("last_viewed_at"),

    // Unread count (cached for performance)
    unreadCount: integer("unread_count").notNull().default(0),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("activity_read_user_idx").on(table.userId),
    index("activity_read_org_idx").on(table.organizationId),
  ]
);

// =============================================================================
// DELEGATION TABLE
// =============================================================================

/**
 * Tracks inbox/task delegation between users.
 */
export const delegation = pgTable(
  "delegation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Who is delegating
    delegatorUserId: text("delegator_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Who is receiving the delegation
    delegateeUserId: text("delegatee_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // ==========================================================================
    // DELEGATION TYPE & SCOPE
    // ==========================================================================

    // Type of delegation
    delegationType: text("delegation_type").notNull(), // "inbox_triage", "commitment_management", "full_access"

    // Which source accounts (empty = all)
    sourceAccountIds: text("source_account_ids").array().default([]),

    // ==========================================================================
    // PERMISSIONS
    // ==========================================================================

    permissions: jsonb("permissions")
      .$type<{
        canRespond: boolean;
        canArchive: boolean;
        canAssignCommitments: boolean;
        canMakeDecisions: boolean;
        canViewPrivate: boolean;
      }>()
      .default({
        canRespond: true,
        canArchive: true,
        canAssignCommitments: false,
        canMakeDecisions: false,
        canViewPrivate: false,
      }),

    // ==========================================================================
    // DURATION
    // ==========================================================================

    startsAt: timestamp("starts_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    isActive: boolean("is_active").notNull().default(true),
    revokedAt: timestamp("revoked_at"),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Reason for delegation
    reason: text("reason"),

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
    index("delegation_org_idx").on(table.organizationId),
    index("delegation_delegator_idx").on(table.delegatorUserId),
    index("delegation_delegatee_idx").on(table.delegateeUserId),
    index("delegation_active_idx").on(table.isActive),
    index("delegation_expires_idx").on(table.expiresAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const mentionRelations = relations(mention, ({ one }) => ({
  organization: one(organization, {
    fields: [mention.organizationId],
    references: [organization.id],
  }),
  mentionedByUser: one(user, {
    fields: [mention.mentionedByUserId],
    references: [user.id],
    relationName: "mentionedByUser",
  }),
  mentionedUser: one(user, {
    fields: [mention.mentionedUserId],
    references: [user.id],
    relationName: "mentionedUser",
  }),
  mentionedTeam: one(team, {
    fields: [mention.mentionedTeamId],
    references: [team.id],
  }),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  organization: one(organization, {
    fields: [comment.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  parentComment: one(comment, {
    fields: [comment.parentCommentId],
    references: [comment.id],
    relationName: "parentComment",
  }),
  replies: many(comment, { relationName: "parentComment" }),
  resolvedByUser: one(user, {
    fields: [comment.resolvedByUserId],
    references: [user.id],
    relationName: "resolvedByUser",
  }),
  deletedByUser: one(user, {
    fields: [comment.deletedByUserId],
    references: [user.id],
    relationName: "deletedByUser",
  }),
}));

export const activityRelations = relations(activity, ({ one }) => ({
  organization: one(organization, {
    fields: [activity.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [activity.userId],
    references: [user.id],
  }),
}));

export const activityReadStatusRelations = relations(
  activityReadStatus,
  ({ one }) => ({
    user: one(user, {
      fields: [activityReadStatus.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [activityReadStatus.organizationId],
      references: [organization.id],
    }),
  })
);

export const delegationRelations = relations(delegation, ({ one }) => ({
  organization: one(organization, {
    fields: [delegation.organizationId],
    references: [organization.id],
  }),
  delegatorUser: one(user, {
    fields: [delegation.delegatorUserId],
    references: [user.id],
    relationName: "delegatorUser",
  }),
  delegateeUser: one(user, {
    fields: [delegation.delegateeUserId],
    references: [user.id],
    relationName: "delegateeUser",
  }),
  revokedByUser: one(user, {
    fields: [delegation.revokedByUserId],
    references: [user.id],
    relationName: "revokedByUser",
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Mention = typeof mention.$inferSelect;
export type NewMention = typeof mention.$inferInsert;
export type Comment = typeof comment.$inferSelect;
export type NewComment = typeof comment.$inferInsert;
export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
export type ActivityReadStatus = typeof activityReadStatus.$inferSelect;
export type NewActivityReadStatus = typeof activityReadStatus.$inferInsert;
export type Delegation = typeof delegation.$inferSelect;
export type NewDelegation = typeof delegation.$inferInsert;

// Type unions
export type MentionType = "user" | "team" | "all" | "channel";
export type MentionContextType =
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "uio"
  | "contact"
  | "comment"
  | "note";
export type CommentTargetType =
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "uio"
  | "contact";
export type ActivityType =
  | "commitment_created"
  | "commitment_updated"
  | "commitment_completed"
  | "commitment_overdue"
  | "decision_made"
  | "decision_updated"
  | "decision_reversed"
  | "task_created"
  | "task_assigned"
  | "task_completed"
  | "comment_added"
  | "comment_resolved"
  | "mention"
  | "share"
  | "share_request"
  | "conversation_assigned"
  | "conversation_claimed"
  | "conversation_resolved"
  | "conversation_escalated"
  | "deadline_approaching"
  | "deadline_missed"
  | "risk_detected"
  | "risk_resolved"
  | "member_joined"
  | "member_left"
  | "settings_changed";
export type ActivityVisibility = "private" | "team" | "organization";
