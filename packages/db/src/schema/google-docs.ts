// =============================================================================
// GOOGLE DOCS SCHEMA
// =============================================================================
//
// Tables specific to Google Docs integration. These complement the generic
// source tables (source_account, conversation, message) with Google Docs-specific
// data like document metadata and folder structure.
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sourceAccount } from "./sources";

// =============================================================================
// GOOGLE DOCS DOCUMENT TABLE
// =============================================================================

/**
 * Google Docs document metadata.
 * Stores document information from Google Drive/Docs API.
 */
export const googleDocsDocument = pgTable(
  "google_docs_document",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Google identifiers
    googleDocumentId: text("google_document_id").notNull(),

    // Document info
    title: text("title"),
    mimeType: text("mime_type").default("application/vnd.google-apps.document"),
    description: text("description"),

    // Hierarchy
    parentFolderId: text("parent_folder_id"),

    // URLs
    webViewLink: text("web_view_link"),
    iconLink: text("icon_link"),
    thumbnailLink: text("thumbnail_link"),

    // Status
    isStarred: boolean("is_starred").notNull().default(false),
    isTrashed: boolean("is_trashed").notNull().default(false),

    // Size (for non-Google Docs files)
    fileSize: integer("file_size"), // bytes

    // Owner info
    ownerEmail: text("owner_email"),
    ownerName: text("owner_name"),

    // Last editor info
    lastModifiedByEmail: text("last_modified_by_email"),
    lastModifiedByName: text("last_modified_by_name"),

    // Permissions
    canEdit: boolean("can_edit").notNull().default(false),
    canComment: boolean("can_comment").notNull().default(false),
    canShare: boolean("can_share").notNull().default(false),
    canDownload: boolean("can_download").notNull().default(false),

    // Timestamps from Google
    googleCreatedAt: timestamp("google_created_at"),
    googleModifiedAt: timestamp("google_modified_at"),

    // Sync tracking
    lastContentSyncAt: timestamp("last_content_sync_at"),
    lastCommentSyncAt: timestamp("last_comment_sync_at"),
    contentHash: text("content_hash"), // Hash of content for change detection
    revisionId: text("revision_id"), // Google Drive revision ID

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("google_docs_document_source_idx").on(table.sourceAccountId),
    index("google_docs_document_folder_idx").on(table.parentFolderId),
    index("google_docs_document_trashed_idx").on(table.isTrashed),
    index("google_docs_document_starred_idx").on(table.isStarred),
    index("google_docs_document_modified_idx").on(table.googleModifiedAt),
    unique("google_docs_document_source_google_unique").on(
      table.sourceAccountId,
      table.googleDocumentId
    ),
  ]
);

// =============================================================================
// GOOGLE DOCS FOLDER TABLE
// =============================================================================

/**
 * Google Drive folder metadata.
 * Stores folder structure for organizing documents.
 */
export const googleDocsFolder = pgTable(
  "google_docs_folder",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Google identifiers
    googleFolderId: text("google_folder_id").notNull(),

    // Folder info
    name: text("name"),
    mimeType: text("mime_type").default("application/vnd.google-apps.folder"),

    // Hierarchy
    parentFolderId: text("parent_folder_id"),

    // URLs
    webViewLink: text("web_view_link"),

    // Status
    isStarred: boolean("is_starred").notNull().default(false),
    isTrashed: boolean("is_trashed").notNull().default(false),
    isRoot: boolean("is_root").notNull().default(false),

    // Owner info
    ownerEmail: text("owner_email"),

    // Sync tracking
    lastSyncAt: timestamp("last_sync_at"),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("google_docs_folder_source_idx").on(table.sourceAccountId),
    index("google_docs_folder_parent_idx").on(table.parentFolderId),
    index("google_docs_folder_trashed_idx").on(table.isTrashed),
    unique("google_docs_folder_source_google_unique").on(
      table.sourceAccountId,
      table.googleFolderId
    ),
  ]
);

// =============================================================================
// GOOGLE DOCS COMMENT CACHE TABLE
// =============================================================================

/**
 * Cached Google Docs comment information.
 * Stores comment threads from Google Drive API.
 */
export const googleDocsCommentCache = pgTable(
  "google_docs_comment_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to document
    documentId: text("document_id")
      .notNull()
      .references(() => googleDocsDocument.id, { onDelete: "cascade" }),

    // Google identifiers
    googleCommentId: text("google_comment_id").notNull(),
    googleDocumentId: text("google_document_id").notNull(),

    // Comment info
    content: text("content"),
    anchor: text("anchor"), // Where in the doc the comment is anchored
    quotedContent: text("quoted_content"), // The quoted/highlighted text

    // Author info
    authorEmail: text("author_email"),
    authorName: text("author_name"),
    authorPhotoUrl: text("author_photo_url"),

    // Status
    isResolved: boolean("is_resolved").notNull().default(false),
    isDeleted: boolean("is_deleted").notNull().default(false),

    // Reply count
    replyCount: integer("reply_count").notNull().default(0),

    // Timestamps from Google
    googleCreatedAt: timestamp("google_created_at"),
    googleModifiedAt: timestamp("google_modified_at"),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("google_docs_comment_document_idx").on(table.documentId),
    index("google_docs_comment_google_doc_idx").on(table.googleDocumentId),
    index("google_docs_comment_resolved_idx").on(table.isResolved),
    unique("google_docs_comment_unique").on(
      table.documentId,
      table.googleCommentId
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const googleDocsDocumentRelations = relations(
  googleDocsDocument,
  ({ one, many }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [googleDocsDocument.sourceAccountId],
      references: [sourceAccount.id],
    }),
    comments: many(googleDocsCommentCache),
  })
);

export const googleDocsFolderRelations = relations(
  googleDocsFolder,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [googleDocsFolder.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

export const googleDocsCommentCacheRelations = relations(
  googleDocsCommentCache,
  ({ one }) => ({
    document: one(googleDocsDocument, {
      fields: [googleDocsCommentCache.documentId],
      references: [googleDocsDocument.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type GoogleDocsDocument = typeof googleDocsDocument.$inferSelect;
export type NewGoogleDocsDocument = typeof googleDocsDocument.$inferInsert;
export type GoogleDocsFolder = typeof googleDocsFolder.$inferSelect;
export type NewGoogleDocsFolder = typeof googleDocsFolder.$inferInsert;
export type GoogleDocsCommentCache = typeof googleDocsCommentCache.$inferSelect;
export type NewGoogleDocsCommentCache =
  typeof googleDocsCommentCache.$inferInsert;
