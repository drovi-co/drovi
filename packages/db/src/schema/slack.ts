// =============================================================================
// SLACK SCHEMA
// =============================================================================
//
// Tables specific to Slack integration. These complement the generic
// source tables (source_account, conversation, message) with Slack-specific
// data like channel metadata and team info.
//

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { sourceAccount } from "./sources";

// =============================================================================
// SLACK CHANNEL TABLE
// =============================================================================

/**
 * Slack channel metadata.
 * Stores Slack-specific channel information that doesn't fit in the generic
 * conversation table.
 */
export const slackChannel = pgTable(
  "slack_channel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Slack identifiers
    slackChannelId: text("slack_channel_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),

    // Channel info
    name: text("name"),
    topic: text("topic"),
    purpose: text("purpose"),

    // Channel type flags
    isChannel: boolean("is_channel").notNull().default(true),
    isGroup: boolean("is_group").notNull().default(false), // Private channel
    isIm: boolean("is_im").notNull().default(false), // Direct message
    isMpim: boolean("is_mpim").notNull().default(false), // Group DM
    isPrivate: boolean("is_private").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    isGeneral: boolean("is_general").notNull().default(false),

    // Membership
    isMember: boolean("is_member").notNull().default(false),
    memberCount: integer("member_count"),

    // Creator
    creatorUserId: text("creator_user_id"),

    // Timestamps from Slack
    slackCreatedAt: timestamp("slack_created_at"),
    slackUpdatedAt: timestamp("slack_updated_at"),

    // Sync tracking
    lastMessageTs: text("last_message_ts"), // Slack timestamp of last synced message
    lastSyncAt: timestamp("last_sync_at"),
    unreadCount: integer("unread_count"),

    // Priority settings (user can customize)
    customPriority: real("custom_priority"), // User-set priority multiplier

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("slack_channel_source_idx").on(table.sourceAccountId),
    index("slack_channel_team_idx").on(table.slackTeamId),
    index("slack_channel_archived_idx").on(table.isArchived),
    index("slack_channel_type_idx").on(
      table.isChannel,
      table.isGroup,
      table.isIm,
      table.isMpim
    ),
    unique("slack_channel_source_slack_unique").on(
      table.sourceAccountId,
      table.slackChannelId
    ),
  ]
);

// =============================================================================
// SLACK USER CACHE TABLE
// =============================================================================

/**
 * Cached Slack user information.
 * Caches user profiles from Slack to avoid repeated API calls.
 */
export const slackUserCache = pgTable(
  "slack_user_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Slack identifiers
    slackUserId: text("slack_user_id").notNull(),
    slackTeamId: text("slack_team_id").notNull(),

    // User info
    name: text("name"),
    realName: text("real_name"),
    displayName: text("display_name"),
    email: text("email"),
    imageUrl: text("image_url"),

    // Status
    isBot: boolean("is_bot").notNull().default(false),
    isAdmin: boolean("is_admin").notNull().default(false),
    isOwner: boolean("is_owner").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),
    isRestricted: boolean("is_restricted").notNull().default(false),
    isUltraRestricted: boolean("is_ultra_restricted").notNull().default(false),

    // Timezone
    timezone: text("timezone"),
    timezoneLabel: text("timezone_label"),
    timezoneOffset: integer("timezone_offset"),

    // Cache management
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("slack_user_cache_source_idx").on(table.sourceAccountId),
    index("slack_user_cache_team_idx").on(table.slackTeamId),
    index("slack_user_cache_email_idx").on(table.email),
    unique("slack_user_cache_source_slack_unique").on(
      table.sourceAccountId,
      table.slackUserId
    ),
  ]
);

// =============================================================================
// SLACK TEAM TABLE
// =============================================================================

/**
 * Slack workspace/team information.
 */
export const slackTeam = pgTable(
  "slack_team",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Slack identifiers
    slackTeamId: text("slack_team_id").notNull(),

    // Team info
    name: text("name").notNull(),
    domain: text("domain"),
    emailDomain: text("email_domain"),
    iconUrl: text("icon_url"),

    // Enterprise info
    enterpriseId: text("enterprise_id"),
    enterpriseName: text("enterprise_name"),
    isEnterpriseInstall: boolean("is_enterprise_install")
      .notNull()
      .default(false),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("slack_team_source_idx").on(table.sourceAccountId),
    unique("slack_team_source_slack_unique").on(
      table.sourceAccountId,
      table.slackTeamId
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const slackChannelRelations = relations(slackChannel, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [slackChannel.sourceAccountId],
    references: [sourceAccount.id],
  }),
}));

export const slackUserCacheRelations = relations(slackUserCache, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [slackUserCache.sourceAccountId],
    references: [sourceAccount.id],
  }),
}));

export const slackTeamRelations = relations(slackTeam, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [slackTeam.sourceAccountId],
    references: [sourceAccount.id],
  }),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SlackChannel = typeof slackChannel.$inferSelect;
export type NewSlackChannel = typeof slackChannel.$inferInsert;
export type SlackUserCache = typeof slackUserCache.$inferSelect;
export type NewSlackUserCache = typeof slackUserCache.$inferInsert;
export type SlackTeam = typeof slackTeam.$inferSelect;
export type NewSlackTeam = typeof slackTeam.$inferInsert;
