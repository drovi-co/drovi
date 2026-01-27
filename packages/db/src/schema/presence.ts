import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Device/browser information for presence tracking
 */
export interface DeviceInfo {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  device?: string;
  isMobile?: boolean;
  isDesktopApp?: boolean;
}

/**
 * Cursor position for collaborative editing
 */
export interface CursorPosition {
  line?: number;
  column?: number;
  selection?: {
    start: number;
    end: number;
  };
  scrollTop?: number;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * User presence status
 */
export const presenceStatusEnum = pgEnum("presence_status", [
  "online",
  "away",
  "busy",
  "do_not_disturb",
  "offline",
]);

/**
 * Types of resources users can be viewing
 */
export const viewingTypeEnum = pgEnum("viewing_type", [
  "inbox",
  "conversation",
  "commitment",
  "decision",
  "task",
  "contact",
  "uio",
  "settings",
  "shared_inbox",
  "search",
  "dashboard",
  "other",
]);

// =============================================================================
// USER PRESENCE TABLE
// =============================================================================

/**
 * Tracks real-time presence state for users.
 * Updated via WebSocket heartbeats.
 */
export const userPresence = pgTable(
  "user_presence",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // User this presence belongs to (one presence record per user)
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .unique(),

    // Current organization context
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),

    // ==========================================================================
    // STATUS
    // ==========================================================================

    // Current status
    status: presenceStatusEnum("status").notNull().default("offline"),

    // Custom status message
    statusMessage: text("status_message"),

    // Status emoji
    statusEmoji: text("status_emoji"),

    // When does custom status expire?
    statusExpiresAt: timestamp("status_expires_at"),

    // ==========================================================================
    // CURRENT VIEW
    // ==========================================================================

    // What type of page they're viewing
    currentViewingType: viewingTypeEnum("current_viewing_type"),

    // ID of the specific resource
    currentViewingId: text("current_viewing_id"),

    // Title of what they're viewing (for display)
    currentViewingTitle: text("current_viewing_title"),

    // ==========================================================================
    // CONNECTION
    // ==========================================================================

    // WebSocket connection ID
    connectionId: text("connection_id"),

    // Device/browser information
    deviceInfo: jsonb("device_info").$type<DeviceInfo>(),

    // IP address (for audit)
    ipAddress: text("ip_address"),

    // ==========================================================================
    // ACTIVITY TRACKING
    // ==========================================================================

    // Last WebSocket heartbeat
    lastHeartbeat: timestamp("last_heartbeat"),

    // Last time user was online
    lastOnlineAt: timestamp("last_online_at"),

    // Last activity (typing, clicking, etc.)
    lastActivityAt: timestamp("last_activity_at"),

    // Is user currently typing?
    isTyping: boolean("is_typing").notNull().default(false),
    typingInResourceId: text("typing_in_resource_id"),

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
    index("presence_user_idx").on(table.userId),
    index("presence_org_idx").on(table.organizationId),
    index("presence_status_idx").on(table.status),
    index("presence_viewing_idx").on(
      table.currentViewingType,
      table.currentViewingId
    ),
    index("presence_heartbeat_idx").on(table.lastHeartbeat),
    index("presence_connection_idx").on(table.connectionId),
  ]
);

// =============================================================================
// RESOURCE VIEWERS TABLE
// =============================================================================

/**
 * Tracks who is currently viewing specific resources.
 * Used for "X, Y are viewing" indicators.
 */
export const resourceViewers = pgTable(
  "resource_viewers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // ==========================================================================
    // RESOURCE
    // ==========================================================================

    // Type of resource being viewed
    resourceType: viewingTypeEnum("resource_type").notNull(),

    // ID of the resource
    resourceId: text("resource_id").notNull(),

    // ==========================================================================
    // VIEWER
    // ==========================================================================

    // Who is viewing
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Their organization context
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // ==========================================================================
    // TIMING
    // ==========================================================================

    // When they started viewing
    startedViewingAt: timestamp("started_viewing_at").defaultNow().notNull(),

    // Last heartbeat for this viewing session
    lastHeartbeat: timestamp("last_heartbeat").defaultNow().notNull(),

    // ==========================================================================
    // CURSOR (for collaborative editing)
    // ==========================================================================

    cursorPosition: jsonb("cursor_position").$type<CursorPosition>(),

    // ==========================================================================
    // ACTIVITY
    // ==========================================================================

    // Is the user actively interacting (vs idle on page)?
    isActive: boolean("is_active").notNull().default(true),

    // Is the user currently typing in this resource?
    isTyping: boolean("is_typing").notNull().default(false),
  },
  (table) => [
    index("viewers_resource_idx").on(table.resourceType, table.resourceId),
    index("viewers_user_idx").on(table.userId),
    index("viewers_org_idx").on(table.organizationId),
    index("viewers_heartbeat_idx").on(table.lastHeartbeat),
    // One record per user per resource
    unique("viewers_resource_user_unique").on(
      table.resourceType,
      table.resourceId,
      table.userId
    ),
  ]
);

// =============================================================================
// PRESENCE HISTORY TABLE (optional, for analytics)
// =============================================================================

/**
 * Historical presence data for analytics.
 * Records status changes over time.
 */
export const presenceHistory = pgTable(
  "presence_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),

    // What changed
    previousStatus: presenceStatusEnum("previous_status"),
    newStatus: presenceStatusEnum("new_status").notNull(),

    // Duration in previous status (seconds)
    durationSeconds: text("duration_seconds"),

    // Trigger for the change
    trigger: text("trigger"), // "manual", "timeout", "heartbeat_lost", "explicit_logout"

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("presence_history_user_idx").on(table.userId),
    index("presence_history_org_idx").on(table.organizationId),
    index("presence_history_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const userPresenceRelations = relations(userPresence, ({ one }) => ({
  user: one(user, {
    fields: [userPresence.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [userPresence.organizationId],
    references: [organization.id],
  }),
}));

export const resourceViewersRelations = relations(
  resourceViewers,
  ({ one }) => ({
    user: one(user, {
      fields: [resourceViewers.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [resourceViewers.organizationId],
      references: [organization.id],
    }),
  })
);

export const presenceHistoryRelations = relations(
  presenceHistory,
  ({ one }) => ({
    user: one(user, {
      fields: [presenceHistory.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [presenceHistory.organizationId],
      references: [organization.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type UserPresence = typeof userPresence.$inferSelect;
export type NewUserPresence = typeof userPresence.$inferInsert;
export type ResourceViewers = typeof resourceViewers.$inferSelect;
export type NewResourceViewers = typeof resourceViewers.$inferInsert;
export type PresenceHistory = typeof presenceHistory.$inferSelect;
export type NewPresenceHistory = typeof presenceHistory.$inferInsert;

// Type unions
export type PresenceStatus =
  | "online"
  | "away"
  | "busy"
  | "do_not_disturb"
  | "offline";
export type ViewingType =
  | "inbox"
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "contact"
  | "uio"
  | "settings"
  | "shared_inbox"
  | "search"
  | "dashboard"
  | "other";
