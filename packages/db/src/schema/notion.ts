// =============================================================================
// NOTION SCHEMA
// =============================================================================
//
// Tables specific to Notion integration. These complement the generic
// source tables (source_account, conversation, message) with Notion-specific
// data like workspace info, page metadata, and database info.
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sourceAccount } from "./sources";

// =============================================================================
// NOTION WORKSPACE TABLE
// =============================================================================

/**
 * Notion workspace information.
 * Stores workspace-level data from Notion OAuth.
 */
export const notionWorkspace = pgTable(
  "notion_workspace",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Notion identifiers
    notionWorkspaceId: text("notion_workspace_id").notNull(),
    notionBotId: text("notion_bot_id"),

    // Workspace info
    name: text("name"),
    icon: text("icon"), // URL or emoji

    // Owner info
    ownerType: text("owner_type"), // 'user' | 'workspace'
    ownerId: text("owner_id"),
    ownerEmail: text("owner_email"),

    // Sync tracking
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncCursor: text("last_sync_cursor"), // For incremental sync

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notion_workspace_source_idx").on(table.sourceAccountId),
    unique("notion_workspace_source_notion_unique").on(
      table.sourceAccountId,
      table.notionWorkspaceId
    ),
  ]
);

// =============================================================================
// NOTION PAGE CACHE TABLE
// =============================================================================

/**
 * Cached Notion page information.
 * Stores page metadata for tracking changes and avoiding repeated API calls.
 */
export const notionPageCache = pgTable(
  "notion_page_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Notion identifiers
    notionPageId: text("notion_page_id").notNull(),
    notionWorkspaceId: text("notion_workspace_id").notNull(),

    // Page hierarchy
    parentType: text("parent_type"), // 'workspace' | 'page_id' | 'database_id'
    parentId: text("parent_id"), // The ID of the parent

    // Page info
    title: text("title"),
    icon: text("icon"), // URL or emoji
    coverUrl: text("cover_url"),
    url: text("url"),

    // Status
    isArchived: boolean("is_archived").notNull().default(false),
    isInTrash: boolean("is_in_trash").notNull().default(false),
    isDatabase: boolean("is_database").notNull().default(false), // If this is a database page

    // Timestamps from Notion
    notionCreatedAt: timestamp("notion_created_at"),
    notionUpdatedAt: timestamp("notion_updated_at"),

    // Creator info
    createdByUserId: text("created_by_user_id"),
    lastEditedByUserId: text("last_edited_by_user_id"),

    // Cache management
    lastContentSyncAt: timestamp("last_content_sync_at"),
    contentHash: text("content_hash"), // Hash of content for change detection

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notion_page_cache_source_idx").on(table.sourceAccountId),
    index("notion_page_cache_workspace_idx").on(table.notionWorkspaceId),
    index("notion_page_cache_parent_idx").on(table.parentType, table.parentId),
    index("notion_page_cache_archived_idx").on(table.isArchived),
    index("notion_page_cache_database_idx").on(table.isDatabase),
    unique("notion_page_cache_source_notion_unique").on(
      table.sourceAccountId,
      table.notionPageId
    ),
  ]
);

// =============================================================================
// NOTION DATABASE TABLE
// =============================================================================

/**
 * Notion database metadata.
 * Stores information about Notion databases (not pages in databases).
 */
export const notionDatabase = pgTable(
  "notion_database",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Notion identifiers
    notionDatabaseId: text("notion_database_id").notNull(),
    notionWorkspaceId: text("notion_workspace_id").notNull(),

    // Database hierarchy
    parentType: text("parent_type"), // 'workspace' | 'page_id'
    parentId: text("parent_id"),

    // Database info
    title: text("title"),
    description: text("description"),
    icon: text("icon"),
    coverUrl: text("cover_url"),
    url: text("url"),

    // Status
    isArchived: boolean("is_archived").notNull().default(false),
    isInTrash: boolean("is_in_trash").notNull().default(false),
    isInline: boolean("is_inline").notNull().default(false), // Inline database

    // Schema information (JSON of property definitions)
    properties: jsonb("properties"),

    // Timestamps from Notion
    notionCreatedAt: timestamp("notion_created_at"),
    notionUpdatedAt: timestamp("notion_updated_at"),

    // Sync tracking
    lastSyncAt: timestamp("last_sync_at"),
    itemCount: text("item_count"), // Number of items in database

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("notion_database_source_idx").on(table.sourceAccountId),
    index("notion_database_workspace_idx").on(table.notionWorkspaceId),
    index("notion_database_archived_idx").on(table.isArchived),
    unique("notion_database_source_notion_unique").on(
      table.sourceAccountId,
      table.notionDatabaseId
    ),
  ]
);

// =============================================================================
// NOTION USER CACHE TABLE
// =============================================================================

/**
 * Cached Notion user information.
 * Caches user profiles from Notion to avoid repeated API calls.
 */
export const notionUserCache = pgTable(
  "notion_user_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Notion identifiers
    notionUserId: text("notion_user_id").notNull(),

    // User info
    type: text("type"), // 'person' | 'bot'
    name: text("name"),
    avatarUrl: text("avatar_url"),
    email: text("email"),

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
    index("notion_user_cache_source_idx").on(table.sourceAccountId),
    index("notion_user_cache_email_idx").on(table.email),
    unique("notion_user_cache_source_notion_unique").on(
      table.sourceAccountId,
      table.notionUserId
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const notionWorkspaceRelations = relations(
  notionWorkspace,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [notionWorkspace.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

export const notionPageCacheRelations = relations(
  notionPageCache,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [notionPageCache.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

export const notionDatabaseRelations = relations(notionDatabase, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [notionDatabase.sourceAccountId],
    references: [sourceAccount.id],
  }),
}));

export const notionUserCacheRelations = relations(
  notionUserCache,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [notionUserCache.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type NotionWorkspace = typeof notionWorkspace.$inferSelect;
export type NewNotionWorkspace = typeof notionWorkspace.$inferInsert;
export type NotionPageCache = typeof notionPageCache.$inferSelect;
export type NewNotionPageCache = typeof notionPageCache.$inferInsert;
export type NotionDatabase = typeof notionDatabase.$inferSelect;
export type NewNotionDatabase = typeof notionDatabase.$inferInsert;
export type NotionUserCache = typeof notionUserCache.$inferSelect;
export type NewNotionUserCache = typeof notionUserCache.$inferInsert;
