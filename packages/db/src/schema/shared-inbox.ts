import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization, team } from "./organization";
import { assignmentMethodEnum } from "./organization-settings";
import { conversation } from "./sources";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Working hours configuration for shared inbox
 */
export interface WorkingHoursConfig {
  timezone: string;
  schedule: Array<{
    day: number; // 0-6 (Sunday = 0)
    start: string; // "09:00"
    end: string; // "17:00"
  }>;
}

/**
 * SLA breach notification settings
 */
export interface SLANotificationConfig {
  notifyOnWarning: boolean;
  notifyOnBreach: boolean;
  warningThresholdPercent: number; // e.g., 80 = notify when 80% of SLA time elapsed
  notifyChannels: ("in_app" | "email" | "slack")[];
  escalateOnBreach: boolean;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Shared inbox type
 */
export const sharedInboxTypeEnum = pgEnum("shared_inbox_type", [
  "support",
  "sales",
  "general",
  "custom",
]);

/**
 * Assignment status for conversations
 */
export const assignmentStatusEnum = pgEnum("assignment_status", [
  "unassigned",
  "assigned",
  "claimed",
  "in_progress",
  "waiting",
  "resolved",
  "escalated",
]);

/**
 * Member availability status
 */
export const memberAvailabilityEnum = pgEnum("member_availability", [
  "available",
  "busy",
  "away",
  "do_not_disturb",
  "offline",
]);

/**
 * Priority levels for assignments
 */
export const assignmentPriorityEnum = pgEnum("assignment_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

// =============================================================================
// SHARED INBOX TABLE
// =============================================================================

/**
 * Configuration for a shared inbox (e.g., support@, sales@).
 * Multiple source accounts can be linked to a single shared inbox.
 */
export const sharedInbox = pgTable(
  "shared_inbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // INBOX IDENTITY
    // ==========================================================================

    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    type: sharedInboxTypeEnum("type").notNull().default("general"),

    // Icon/color for UI
    icon: text("icon"),
    color: text("color"),

    // Connected source accounts (e.g., support@company.com)
    sourceAccountIds: text("source_account_ids").array().default([]),

    // ==========================================================================
    // ASSIGNMENT SETTINGS
    // ==========================================================================

    // Assignment method (round_robin, load_balanced, manual_only, skills_based)
    assignmentMethod: assignmentMethodEnum("assignment_method")
      .notNull()
      .default("round_robin"),

    // Maximum assignments per member (0 = unlimited)
    maxAssignmentsPerMember: integer("max_assignments_per_member")
      .notNull()
      .default(10),

    // Enable automatic assignment
    autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(true),

    // Skip away/offline members in auto-assignment
    skipAwayMembers: boolean("skip_away_members").notNull().default(true),

    // Automatically reassign when member goes away
    reassignOnAway: boolean("reassign_on_away").notNull().default(false),

    // ==========================================================================
    // SLA SETTINGS
    // ==========================================================================

    // First response SLA in minutes (null = no SLA)
    firstResponseSlaMinutes: integer("first_response_sla_minutes"),

    // Resolution SLA in minutes (null = no SLA)
    resolutionSlaMinutes: integer("resolution_sla_minutes"),

    // SLA notification settings
    slaNotifications: jsonb("sla_notifications").$type<SLANotificationConfig>(),

    // ==========================================================================
    // ESCALATION SETTINGS
    // ==========================================================================

    // Enable automatic escalation
    escalationEnabled: boolean("escalation_enabled").notNull().default(false),

    // Delay before escalation in minutes
    escalationDelayMinutes: integer("escalation_delay_minutes")
      .notNull()
      .default(60),

    // Target team for escalations
    escalationTargetTeamId: text("escalation_target_team_id").references(
      () => team.id,
      { onDelete: "set null" }
    ),

    // User to escalate to (if no team)
    escalationTargetUserId: text("escalation_target_user_id").references(
      () => user.id,
      { onDelete: "set null" }
    ),

    // ==========================================================================
    // WORKING HOURS
    // ==========================================================================

    // Enable working hours restrictions
    workingHoursEnabled: boolean("working_hours_enabled")
      .notNull()
      .default(false),

    // Working hours configuration
    workingHours: jsonb("working_hours").$type<WorkingHoursConfig>(),

    // ==========================================================================
    // STATISTICS
    // ==========================================================================

    // Total conversations assigned (all time)
    totalAssigned: integer("total_assigned").notNull().default(0),

    // Total conversations resolved (all time)
    totalResolved: integer("total_resolved").notNull().default(0),

    // Average resolution time in minutes (rolling)
    avgResolutionTimeMinutes: real("avg_resolution_time_minutes"),

    // Average first response time in minutes (rolling)
    avgFirstResponseTimeMinutes: real("avg_first_response_time_minutes"),

    // ==========================================================================
    // STATUS
    // ==========================================================================

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
    index("shared_inbox_org_idx").on(table.organizationId),
    index("shared_inbox_active_idx").on(table.isActive),
    index("shared_inbox_type_idx").on(table.type),
    unique("shared_inbox_org_slug_unique").on(table.organizationId, table.slug),
  ]
);

// =============================================================================
// SHARED INBOX MEMBER TABLE
// =============================================================================

/**
 * Members assigned to a shared inbox with their availability and workload.
 */
export const sharedInboxMember = pgTable(
  "shared_inbox_member",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    sharedInboxId: text("shared_inbox_id")
      .notNull()
      .references(() => sharedInbox.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // ==========================================================================
    // AVAILABILITY
    // ==========================================================================

    availability: memberAvailabilityEnum("availability")
      .notNull()
      .default("available"),
    awayUntil: timestamp("away_until"),
    awayReason: text("away_reason"),

    // ==========================================================================
    // ROUND-ROBIN STATE
    // ==========================================================================

    // Position in round-robin queue (lower = assigned sooner)
    roundRobinPosition: integer("round_robin_position").notNull().default(0),

    // Last time this member was assigned a conversation
    lastAssignedAt: timestamp("last_assigned_at"),

    // ==========================================================================
    // WORKLOAD
    // ==========================================================================

    // Current number of assigned conversations
    currentAssignments: integer("current_assignments").notNull().default(0),

    // Max assignments for this member (overrides inbox default if set)
    maxAssignments: integer("max_assignments"),

    // ==========================================================================
    // SKILLS (for skills-based routing)
    // ==========================================================================

    skills: text("skills").array().default([]),
    skillLevels: jsonb("skill_levels").$type<Record<string, number>>(), // skill -> proficiency 1-5

    // ==========================================================================
    // STATISTICS
    // ==========================================================================

    totalAssigned: integer("total_assigned").notNull().default(0),
    totalResolved: integer("total_resolved").notNull().default(0),
    avgResponseTimeMinutes: real("avg_response_time_minutes"),
    avgResolutionTimeMinutes: real("avg_resolution_time_minutes"),

    // ==========================================================================
    // ROLE
    // ==========================================================================

    // Is this member an admin of the shared inbox?
    isAdmin: boolean("is_admin").notNull().default(false),

    // ==========================================================================
    // STATUS
    // ==========================================================================

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
    index("shared_inbox_member_inbox_idx").on(table.sharedInboxId),
    index("shared_inbox_member_user_idx").on(table.userId),
    index("shared_inbox_member_availability_idx").on(table.availability),
    index("shared_inbox_member_position_idx").on(table.roundRobinPosition),
    index("shared_inbox_member_active_idx").on(table.isActive),
    unique("shared_inbox_member_unique").on(table.sharedInboxId, table.userId),
  ]
);

// =============================================================================
// CONVERSATION ASSIGNMENT TABLE
// =============================================================================

/**
 * Tracks the assignment state of conversations in shared inboxes.
 */
export const conversationAssignment = pgTable(
  "conversation_assignment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    sharedInboxId: text("shared_inbox_id")
      .notNull()
      .references(() => sharedInbox.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),

    // ==========================================================================
    // ASSIGNMENT STATE
    // ==========================================================================

    // Current assignee (null if unassigned)
    assigneeUserId: text("assignee_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Current status
    status: assignmentStatusEnum("status").notNull().default("unassigned"),

    // Priority
    priority: assignmentPriorityEnum("priority").notNull().default("medium"),

    // ==========================================================================
    // ASSIGNMENT TRACKING
    // ==========================================================================

    // When was it assigned
    assignedAt: timestamp("assigned_at"),

    // Who/what assigned it ("system" for auto-assign, userId for manual)
    assignedBy: text("assigned_by"),

    // How was it assigned
    assignmentMethod: text("assignment_method"), // "round_robin", "load_balanced", "manual", "claimed"

    // ==========================================================================
    // CLAIM WORKFLOW
    // ==========================================================================

    // When was it claimed (user self-assigned)
    claimedAt: timestamp("claimed_at"),
    claimedBy: text("claimed_by"),

    // ==========================================================================
    // RESOLUTION
    // ==========================================================================

    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),

    // ==========================================================================
    // SLA TRACKING
    // ==========================================================================

    // Time of first response
    firstResponseAt: timestamp("first_response_at"),

    // SLA breach flags
    firstResponseSlaBreached: boolean("first_response_sla_breached")
      .notNull()
      .default(false),
    resolutionSlaBreached: boolean("resolution_sla_breached")
      .notNull()
      .default(false),

    // When SLA warning was sent
    slaWarningAt: timestamp("sla_warning_at"),

    // ==========================================================================
    // ESCALATION
    // ==========================================================================

    escalatedAt: timestamp("escalated_at"),
    escalatedTo: text("escalated_to"),
    escalationReason: text("escalation_reason"),

    // ==========================================================================
    // CATEGORIZATION
    // ==========================================================================

    tags: text("tags").array().default([]),

    // Custom metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

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
    index("conv_assignment_inbox_idx").on(table.sharedInboxId),
    index("conv_assignment_conv_idx").on(table.conversationId),
    index("conv_assignment_assignee_idx").on(table.assigneeUserId),
    index("conv_assignment_status_idx").on(table.status),
    index("conv_assignment_priority_idx").on(table.priority),
    index("conv_assignment_sla_breach_idx").on(
      table.firstResponseSlaBreached,
      table.resolutionSlaBreached
    ),
    unique("conv_assignment_conv_unique").on(table.conversationId),
  ]
);

// =============================================================================
// ASSIGNMENT HISTORY TABLE
// =============================================================================

/**
 * Audit trail for assignment changes.
 */
export const assignmentHistory = pgTable(
  "assignment_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    conversationAssignmentId: text("conversation_assignment_id")
      .notNull()
      .references(() => conversationAssignment.id, { onDelete: "cascade" }),

    // What changed
    action: text("action").notNull(), // "assigned", "claimed", "released", "escalated", "resolved", "reopened", "priority_changed"

    // Who was involved
    fromUserId: text("from_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    toUserId: text("to_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Who performed the action ("system" or userId)
    performedBy: text("performed_by").notNull(),

    // Context
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // IP for audit
    ipAddress: text("ip_address"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("assignment_history_assignment_idx").on(
      table.conversationAssignmentId
    ),
    index("assignment_history_action_idx").on(table.action),
    index("assignment_history_performed_by_idx").on(table.performedBy),
    index("assignment_history_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const sharedInboxRelations = relations(sharedInbox, ({ one, many }) => ({
  organization: one(organization, {
    fields: [sharedInbox.organizationId],
    references: [organization.id],
  }),
  escalationTargetTeam: one(team, {
    fields: [sharedInbox.escalationTargetTeamId],
    references: [team.id],
  }),
  escalationTargetUser: one(user, {
    fields: [sharedInbox.escalationTargetUserId],
    references: [user.id],
  }),
  members: many(sharedInboxMember),
  assignments: many(conversationAssignment),
}));

export const sharedInboxMemberRelations = relations(
  sharedInboxMember,
  ({ one }) => ({
    sharedInbox: one(sharedInbox, {
      fields: [sharedInboxMember.sharedInboxId],
      references: [sharedInbox.id],
    }),
    user: one(user, {
      fields: [sharedInboxMember.userId],
      references: [user.id],
    }),
  })
);

export const conversationAssignmentRelations = relations(
  conversationAssignment,
  ({ one, many }) => ({
    sharedInbox: one(sharedInbox, {
      fields: [conversationAssignment.sharedInboxId],
      references: [sharedInbox.id],
    }),
    conversation: one(conversation, {
      fields: [conversationAssignment.conversationId],
      references: [conversation.id],
    }),
    assignee: one(user, {
      fields: [conversationAssignment.assigneeUserId],
      references: [user.id],
    }),
    history: many(assignmentHistory),
  })
);

export const assignmentHistoryRelations = relations(
  assignmentHistory,
  ({ one }) => ({
    assignment: one(conversationAssignment, {
      fields: [assignmentHistory.conversationAssignmentId],
      references: [conversationAssignment.id],
    }),
    fromUser: one(user, {
      fields: [assignmentHistory.fromUserId],
      references: [user.id],
      relationName: "fromUser",
    }),
    toUser: one(user, {
      fields: [assignmentHistory.toUserId],
      references: [user.id],
      relationName: "toUser",
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SharedInbox = typeof sharedInbox.$inferSelect;
export type NewSharedInbox = typeof sharedInbox.$inferInsert;
export type SharedInboxMember = typeof sharedInboxMember.$inferSelect;
export type NewSharedInboxMember = typeof sharedInboxMember.$inferInsert;
export type ConversationAssignment = typeof conversationAssignment.$inferSelect;
export type NewConversationAssignment =
  typeof conversationAssignment.$inferInsert;
export type AssignmentHistory = typeof assignmentHistory.$inferSelect;
export type NewAssignmentHistory = typeof assignmentHistory.$inferInsert;

// Status type unions
export type SharedInboxType = "support" | "sales" | "general" | "custom";
export type AssignmentStatus =
  | "unassigned"
  | "assigned"
  | "claimed"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "escalated";
export type MemberAvailability =
  | "available"
  | "busy"
  | "away"
  | "do_not_disturb"
  | "offline";
export type AssignmentPriority = "low" | "medium" | "high" | "urgent";
