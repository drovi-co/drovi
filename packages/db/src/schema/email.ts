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
import { organization } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface EmailAccountSettings {
  syncEnabled: boolean;
  syncFrequencyMinutes: number;
  excludeLabels?: string[];
  includeLabels?: string[];
  autoArchive?: boolean;
  /** Number of days to backfill during initial sync */
  backfillDays?: number;
  /** Gmail Watch expiration timestamp for push notifications */
  watchExpiration?: number;
}

/**
 * Backfill progress tracking for multi-phase import.
 * Power users may have millions of emails spanning years.
 */
export interface BackfillProgress {
  /** Current phase: priority (0-90d), extended (90d-1y), archive (1y+), complete */
  phase: "priority" | "extended" | "archive" | "complete" | "idle";
  /** Total threads discovered in current phase */
  totalThreads: number;
  /** Threads processed in current phase */
  processedThreads: number;
  /** Total messages processed across all phases */
  totalMessages: number;
  /** Phase-specific progress (0-100) */
  phaseProgress: number;
  /** Overall progress across all phases (0-100) */
  overallProgress: number;
  /** Timestamps for tracking */
  phaseStartedAt?: string;
  priorityCompletedAt?: string;
  extendedCompletedAt?: string;
  archiveCompletedAt?: string;
  /** Error tracking */
  lastError?: string;
  errorCount: number;
  /** Estimated completion */
  estimatedTimeRemaining?: number; // seconds
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

// =============================================================================
// ENUMS
// =============================================================================

export const emailAccountProviderEnum = pgEnum("email_account_provider", [
  "gmail",
  "outlook",
]);

export const emailAccountStatusEnum = pgEnum("email_account_status", [
  "active",
  "expired",
  "revoked",
  "syncing",
  "error",
]);

export const emailParticipantRoleEnum = pgEnum("email_participant_role", [
  "from",
  "to",
  "cc",
  "bcc",
]);

// =============================================================================
// EMAIL ACCOUNT TABLE
// =============================================================================

/**
 * Stores OAuth connections for Gmail and Outlook providers.
 * Email accounts belong to organizations, not directly to users.
 * Tokens are encrypted at rest.
 */
export const emailAccount = pgTable(
  "email_account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    // Organization that owns this email account (required for multi-tenancy)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // User who connected this account (for audit/tracking purposes)
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),
    provider: emailAccountProviderEnum("provider").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),

    // OAuth tokens (encrypted in production)
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at").notNull(),

    // Sync state
    syncCursor: text("sync_cursor"),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncStatus: text("last_sync_status"),
    lastSyncError: text("last_sync_error"),

    // Account status
    status: emailAccountStatusEnum("status").notNull().default("active"),
    isPrimary: boolean("is_primary").notNull().default(false),

    // User settings
    settings: jsonb("settings").$type<EmailAccountSettings>().default({
      syncEnabled: true,
      syncFrequencyMinutes: 5,
    }),

    // Backfill tracking (multi-phase full history import)
    backfillProgress: jsonb("backfill_progress")
      .$type<BackfillProgress>()
      .default({
        phase: "idle",
        totalThreads: 0,
        processedThreads: 0,
        totalMessages: 0,
        phaseProgress: 0,
        overallProgress: 0,
        errorCount: 0,
      }),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("email_account_org_idx").on(table.organizationId),
    index("email_account_added_by_idx").on(table.addedByUserId),
    index("email_account_status_idx").on(table.status),
    // Same email can only be connected once per organization
    unique("email_account_org_email_unique").on(
      table.organizationId,
      table.email
    ),
  ]
);

// =============================================================================
// EMAIL THREAD TABLE
// =============================================================================

/**
 * Stores email thread containers with aggregated metadata.
 * Intelligence fields are populated by AI agents.
 */
export const emailThread = pgTable(
  "email_thread",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),

    // Provider data
    providerThreadId: text("provider_thread_id").notNull(),
    subject: text("subject"),
    snippet: text("snippet"),

    // Thread metadata
    participantEmails: text("participant_emails").array(),
    messageCount: integer("message_count").notNull().default(0),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),

    // Gmail/Outlook labels/folders
    labels: text("labels").array(),

    // Status flags
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    isTrashed: boolean("is_trashed").notNull().default(false),

    // ==========================================================================
    // INTELLIGENCE METADATA (populated by AI agents)
    // ==========================================================================

    // Thread Understanding Agent (PRD-03)
    briefSummary: text("brief_summary"), // 3-line contextual brief
    intentClassification: text("intent_classification"), // request, fyi, social, etc.
    urgencyScore: real("urgency_score"), // 0-1 score
    importanceScore: real("importance_score"), // 0-1 score
    sentimentScore: real("sentiment_score"), // -1 to 1

    // Open loops detection
    hasOpenLoops: boolean("has_open_loops").default(false),
    openLoopCount: integer("open_loop_count").default(0),

    // Triage Agent (PRD-07)
    suggestedAction: text("suggested_action"), // respond, archive, delegate, etc.
    suggestedActionReason: text("suggested_action_reason"),
    priorityTier: text("priority_tier"), // urgent, high, medium, low

    // Analysis tracking
    lastAnalyzedAt: timestamp("last_analyzed_at"),
    analysisVersion: text("analysis_version"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("email_thread_account_idx").on(table.accountId),
    index("email_thread_last_message_idx").on(table.lastMessageAt),
    index("email_thread_urgency_idx").on(table.urgencyScore),
    index("email_thread_priority_idx").on(table.priorityTier),
    index("email_thread_open_loops_idx").on(table.hasOpenLoops),
    unique("email_thread_provider_unique").on(
      table.accountId,
      table.providerThreadId
    ),
  ]
);

// =============================================================================
// EMAIL MESSAGE TABLE
// =============================================================================

/**
 * Stores individual email messages with full content and headers.
 */
export const emailMessage = pgTable(
  "email_message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThread.id, { onDelete: "cascade" }),

    // Provider data
    providerMessageId: text("provider_message_id").notNull(),

    // Threading headers
    inReplyTo: text("in_reply_to"),
    references: text("references").array(),

    // Sender
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),

    // Recipients (JSONB for flexibility)
    toRecipients: jsonb("to_recipients").$type<EmailRecipient[]>().default([]),
    ccRecipients: jsonb("cc_recipients").$type<EmailRecipient[]>().default([]),
    bccRecipients: jsonb("bcc_recipients")
      .$type<EmailRecipient[]>()
      .default([]),

    // Content
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    snippet: text("snippet"),

    // Timestamps
    sentAt: timestamp("sent_at"),
    receivedAt: timestamp("received_at"),

    // Headers (for advanced analysis)
    headers: jsonb("headers").$type<Record<string, string>>(),

    // Gmail/Outlook specific
    labelIds: text("label_ids").array(),
    sizeBytes: integer("size_bytes"),

    // Ordering within thread
    messageIndex: integer("message_index").notNull().default(0),

    // Direction (sent by user vs received)
    isFromUser: boolean("is_from_user").notNull().default(false),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("email_message_thread_idx").on(table.threadId),
    index("email_message_from_idx").on(table.fromEmail),
    index("email_message_sent_idx").on(table.sentAt),
    index("email_message_received_idx").on(table.receivedAt),
    unique("email_message_provider_unique").on(
      table.threadId,
      table.providerMessageId
    ),
  ]
);

// =============================================================================
// EMAIL ATTACHMENT TABLE
// =============================================================================

/**
 * Stores attachment metadata without binary content.
 * Actual files stored in object storage (S3/R2).
 */
export const emailAttachment = pgTable(
  "email_attachment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => emailMessage.id, { onDelete: "cascade" }),

    // Provider data
    providerAttachmentId: text("provider_attachment_id"),

    // File metadata
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),

    // Inline attachment support (for embedded images)
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),

    // Storage (optional - for downloaded attachments)
    storageKey: text("storage_key"),
    downloadedAt: timestamp("downloaded_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("email_attachment_message_idx").on(table.messageId)]
);

// =============================================================================
// EMAIL PARTICIPANT TABLE
// =============================================================================

/**
 * Links messages to contacts for identity resolution.
 * Enables relationship tracking across messages.
 */
export const emailParticipant = pgTable(
  "email_participant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    messageId: text("message_id")
      .notNull()
      .references(() => emailMessage.id, { onDelete: "cascade" }),
    // Note: contactId references contact table defined in intelligence.ts
    // We'll add the reference after contact is defined
    contactId: text("contact_id"),

    // Participant data
    email: text("email").notNull(),
    displayName: text("display_name"),
    role: emailParticipantRoleEnum("role").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("email_participant_message_idx").on(table.messageId),
    index("email_participant_contact_idx").on(table.contactId),
    index("email_participant_email_idx").on(table.email),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const emailAccountRelations = relations(
  emailAccount,
  ({ many, one }) => ({
    threads: many(emailThread),
    addedByUser: one(user, {
      fields: [emailAccount.addedByUserId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [emailAccount.organizationId],
      references: [organization.id],
    }),
  })
);

export const emailThreadRelations = relations(emailThread, ({ many, one }) => ({
  account: one(emailAccount, {
    fields: [emailThread.accountId],
    references: [emailAccount.id],
  }),
  messages: many(emailMessage),
}));

export const emailMessageRelations = relations(
  emailMessage,
  ({ many, one }) => ({
    thread: one(emailThread, {
      fields: [emailMessage.threadId],
      references: [emailThread.id],
    }),
    attachments: many(emailAttachment),
    participants: many(emailParticipant),
  })
);

export const emailAttachmentRelations = relations(
  emailAttachment,
  ({ one }) => ({
    message: one(emailMessage, {
      fields: [emailAttachment.messageId],
      references: [emailMessage.id],
    }),
  })
);

export const emailParticipantRelations = relations(
  emailParticipant,
  ({ one }) => ({
    message: one(emailMessage, {
      fields: [emailParticipant.messageId],
      references: [emailMessage.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type EmailAccount = typeof emailAccount.$inferSelect;
export type NewEmailAccount = typeof emailAccount.$inferInsert;
export type EmailThread = typeof emailThread.$inferSelect;
export type NewEmailThread = typeof emailThread.$inferInsert;
export type EmailMessage = typeof emailMessage.$inferSelect;
export type NewEmailMessage = typeof emailMessage.$inferInsert;
export type EmailAttachment = typeof emailAttachment.$inferSelect;
export type NewEmailAttachment = typeof emailAttachment.$inferInsert;
export type EmailParticipant = typeof emailParticipant.$inferSelect;
export type NewEmailParticipant = typeof emailParticipant.$inferInsert;
