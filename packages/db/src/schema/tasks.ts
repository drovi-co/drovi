import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { commitment, decision } from "./intelligence";
import { organization } from "./organization";
import { conversation } from "./sources";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Metadata cached from source for fast queries
 */
export interface TaskMetadata {
  sourceUrl?: string;
  sourceTitle?: string;
  sourceAccountType?: string; // email, slack, whatsapp, notion, etc.
  sourceAccountId?: string;
  sourceSnippet?: string;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Task workflow status following Linear/kanban conventions
 */
export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

/**
 * Task priority levels
 */
export const taskPriorityEnum = pgEnum("task_priority", [
  "no_priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

/**
 * Source type that created the task
 */
export const taskSourceTypeEnum = pgEnum("task_source_type", [
  "conversation", // Email, Slack, WhatsApp, Notion, Google Docs threads
  "commitment", // Extracted commitment
  "decision", // Extracted decision
  "manual", // User-created task
]);

// =============================================================================
// TASK TABLE
// =============================================================================

/**
 * Main task table - auto-created for all conversations/commitments/decisions
 * or manually created by users.
 *
 * Architecture: Task is a metadata overlay on existing items.
 * Every synced conversation, extracted commitment, and decision
 * automatically gets a task record in "backlog" status.
 */
export const task = pgTable(
  "task",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Organization (required for multi-tenancy)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Title: auto-populated from source OR user-provided for manual tasks
    title: text("title").notNull(),

    // Description: optional enhancement by user (markdown supported)
    description: text("description"),

    // Task state - user can modify these
    status: taskStatusEnum("status").notNull().default("backlog"),
    priority: taskPriorityEnum("priority").notNull().default("no_priority"),

    // Assignment
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),

    // Due date
    dueDate: timestamp("due_date", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    // Source reference (exactly one should be set, or none for manual tasks)
    sourceType: taskSourceTypeEnum("source_type").notNull(),

    // One-to-one with source (unique constraints ensure no duplicates)
    sourceConversationId: text("source_conversation_id").references(
      () => conversation.id,
      { onDelete: "cascade" }
    ),
    sourceCommitmentId: text("source_commitment_id").references(
      () => commitment.id,
      { onDelete: "cascade" }
    ),
    sourceDecisionId: text("source_decision_id").references(() => decision.id, {
      onDelete: "cascade",
    }),

    // Audit fields
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }), // null for auto-created tasks

    // Cache source metadata for fast queries
    metadata: jsonb("metadata").$type<TaskMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Core indexes
    index("task_org_idx").on(table.organizationId),
    index("task_status_idx").on(table.status),
    index("task_priority_idx").on(table.priority),
    index("task_assignee_idx").on(table.assigneeId),
    index("task_due_date_idx").on(table.dueDate),
    index("task_source_type_idx").on(table.sourceType),
    index("task_created_at_idx").on(table.createdAt),

    // Source reference indexes
    index("task_source_conversation_idx").on(table.sourceConversationId),
    index("task_source_commitment_idx").on(table.sourceCommitmentId),
    index("task_source_decision_idx").on(table.sourceDecisionId),

    // One task per source item (prevents duplicates)
    unique("task_conversation_unique").on(table.sourceConversationId),
    unique("task_commitment_unique").on(table.sourceCommitmentId),
    unique("task_decision_unique").on(table.sourceDecisionId),
  ]
);

// =============================================================================
// TASK LABEL TABLE
// =============================================================================

/**
 * Organization-defined labels for categorizing tasks.
 * Users can create custom labels with colors.
 */
export const taskLabel = pgTable(
  "task_label",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    color: text("color").notNull().default("#6B7280"), // gray-500 default

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("task_label_org_idx").on(table.organizationId),
    // Label names must be unique within an organization
    unique("task_label_org_name_unique").on(table.organizationId, table.name),
  ]
);

// =============================================================================
// TASK-LABEL JUNCTION TABLE
// =============================================================================

/**
 * Many-to-many relationship between tasks and labels.
 */
export const taskLabelJunction = pgTable(
  "task_label_junction",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => taskLabel.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index("task_label_junction_task_idx").on(table.taskId),
    index("task_label_junction_label_idx").on(table.labelId),
  ]
);

// =============================================================================
// TASK ACTIVITY TABLE
// =============================================================================

/**
 * Activity log for task changes.
 * Tracks status changes, assignments, comments, etc.
 */
export const taskActivity = pgTable(
  "task_activity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    taskId: text("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Activity type: created, status_changed, priority_changed, assigned,
    // unassigned, description_updated, due_date_set, due_date_removed,
    // label_added, label_removed, comment_added
    activityType: text("activity_type").notNull(),

    // For changes, store previous and new values
    previousValue: text("previous_value"),
    newValue: text("new_value"),

    // For comment-type activities
    comment: text("comment"),

    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("task_activity_task_idx").on(table.taskId),
    index("task_activity_user_idx").on(table.userId),
    index("task_activity_type_idx").on(table.activityType),
    index("task_activity_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const taskRelations = relations(task, ({ one, many }) => ({
  organization: one(organization, {
    fields: [task.organizationId],
    references: [organization.id],
  }),
  assignee: one(user, {
    fields: [task.assigneeId],
    references: [user.id],
    relationName: "taskAssignee",
  }),
  createdBy: one(user, {
    fields: [task.createdById],
    references: [user.id],
    relationName: "taskCreatedBy",
  }),
  sourceConversation: one(conversation, {
    fields: [task.sourceConversationId],
    references: [conversation.id],
  }),
  sourceCommitment: one(commitment, {
    fields: [task.sourceCommitmentId],
    references: [commitment.id],
  }),
  sourceDecision: one(decision, {
    fields: [task.sourceDecisionId],
    references: [decision.id],
  }),
  labelJunctions: many(taskLabelJunction),
  activities: many(taskActivity),
}));

export const taskLabelRelations = relations(taskLabel, ({ one, many }) => ({
  organization: one(organization, {
    fields: [taskLabel.organizationId],
    references: [organization.id],
  }),
  taskJunctions: many(taskLabelJunction),
}));

export const taskLabelJunctionRelations = relations(
  taskLabelJunction,
  ({ one }) => ({
    task: one(task, {
      fields: [taskLabelJunction.taskId],
      references: [task.id],
    }),
    label: one(taskLabel, {
      fields: [taskLabelJunction.labelId],
      references: [taskLabel.id],
    }),
  })
);

export const taskActivityRelations = relations(taskActivity, ({ one }) => ({
  task: one(task, {
    fields: [taskActivity.taskId],
    references: [task.id],
  }),
  user: one(user, {
    fields: [taskActivity.userId],
    references: [user.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Task = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type TaskLabel = typeof taskLabel.$inferSelect;
export type NewTaskLabel = typeof taskLabel.$inferInsert;
export type TaskLabelJunction = typeof taskLabelJunction.$inferSelect;
export type NewTaskLabelJunction = typeof taskLabelJunction.$inferInsert;
export type TaskActivity = typeof taskActivity.$inferSelect;
export type NewTaskActivity = typeof taskActivity.$inferInsert;

// Enum value types for TypeScript
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type TaskPriority =
  | "no_priority"
  | "low"
  | "medium"
  | "high"
  | "urgent";

export type TaskSourceType =
  | "conversation"
  | "commitment"
  | "decision"
  | "manual";
