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
import { contact, conversationTopic } from "./intelligence";
import { organization } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Settings for source accounts - varies by source type
 */
export interface SourceAccountSettings {
  syncEnabled: boolean;
  syncFrequencyMinutes: number;
  // Email-specific
  excludeLabels?: string[];
  includeLabels?: string[];
  autoArchive?: boolean;
  // Slack-specific
  includeChannels?: string[];
  excludeChannels?: string[];
  syncDirectMessages?: boolean;
  syncPrivateChannels?: boolean;
  // Calendar-specific
  syncAllCalendars?: boolean;
  calendarIds?: string[];
  // Notion-specific
  workspaceIds?: string[];
  databaseIds?: string[];
  // Generic
  customSettings?: Record<string, unknown>;
}

/**
 * Backfill progress tracking for multi-phase import.
 */
export interface SourceBackfillProgress {
  phase: "priority" | "extended" | "archive" | "complete" | "idle";
  totalItems: number;
  processedItems: number;
  phaseProgress: number;
  overallProgress: number;
  phaseStartedAt?: string;
  priorityCompletedAt?: string;
  extendedCompletedAt?: string;
  archiveCompletedAt?: string;
  lastError?: string;
  errorCount: number;
  estimatedTimeRemaining?: number;
}

/**
 * Recipient information for message-based sources
 */
export interface MessageRecipient {
  id: string;
  email?: string;
  name?: string;
  type: "to" | "cc" | "bcc" | "mention" | "reaction";
}

/**
 * Conversation metadata varies by source type
 */
export interface ConversationMetadata {
  // Email-specific
  inReplyTo?: string;
  references?: string[];
  labels?: string[];
  // Slack-specific
  channelId?: string;
  channelName?: string;
  threadTs?: string;
  isPrivate?: boolean;
  teamDomain?: string;
  teamId?: string;
  // Calendar-specific
  eventId?: string;
  location?: string;
  conferenceUrl?: string;
  // Notion-specific
  pageId?: string;
  databaseId?: string;
  workspaceId?: string;
  parentType?: string;
  parentId?: string;
  url?: string;
  // Google Docs-specific
  documentId?: string;
  mimeType?: string;
  folderId?: string;
  folderName?: string;
  // Meeting-specific
  meetingPlatform?: "zoom" | "teams" | "meet" | "other";
  duration?: number;
  recordingUrl?: string;
  // WhatsApp-specific
  phoneNumber?: string;
  groupId?: string;
  waId?: string;
  phoneNumberId?: string;
  wabaId?: string;
  contactName?: string;
  // Generic
  customMetadata?: Record<string, unknown>;
}

/**
 * Message metadata varies by source type
 */
export interface MessageMetadata {
  // Email-specific
  headers?: Record<string, string>;
  labelIds?: string[];
  sizeBytes?: number;
  // Slack-specific
  ts?: string;
  reactions?: Array<{ name: string; count: number; users: string[] }>;
  files?: Array<{ id: string; name: string; mimeType: string; url: string }>;
  // Calendar-specific
  attendeeStatus?: "accepted" | "declined" | "tentative" | "needs_action";
  // WhatsApp-specific
  wamId?: string;
  messageType?: string;
  context?: { from?: string; id?: string; forwarded?: boolean };
  reaction?: { message_id?: string; emoji?: string };
  // Notion-specific
  isPageContent?: boolean;
  blockType?: string;
  parentType?: string;
  parentId?: string;
  // Google Docs-specific
  isDocumentContent?: boolean;
  discussionId?: string;
  isReply?: boolean;
  replyToId?: string;
  resolved?: boolean;
  parentCommentId?: string;
  anchor?: string;
  quotedContent?: string;
  isResolved?: boolean;
  // Generic
  customMetadata?: Record<string, unknown>;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * All supported source types for the multi-source intelligence platform
 */
export const sourceTypeEnum = pgEnum("source_type", [
  "email",
  "slack",
  "calendar",
  "whatsapp",
  "notion",
  "google_docs",
  "google_sheets",
  "meeting_transcript",
  "teams",
  "discord",
  "linear",
  "github",
]);

/**
 * Connection status for source accounts
 */
export const sourceStatusEnum = pgEnum("source_status", [
  "connected",
  "disconnected",
  "syncing",
  "error",
  "expired",
  "revoked",
  "pending",
]);

/**
 * Conversation types within sources
 */
export const conversationTypeEnum = pgEnum("conversation_type", [
  // Email
  "thread",
  // Slack/Discord/Teams
  "channel",
  "dm",
  "group_dm",
  "slack_thread",
  // Calendar
  "event",
  "recurring_event",
  // Notion
  "page",
  "database_item",
  "comment_thread",
  // Google Docs
  "document",
  "doc_comment_thread",
  // Meeting
  "meeting",
  "recording",
  // WhatsApp
  "chat",
  "group_chat",
  // Generic
  "other",
]);

/**
 * Priority tiers for unified inbox sorting
 */
export const priorityTierEnum = pgEnum("priority_tier", [
  "urgent",
  "high",
  "medium",
  "low",
]);

// =============================================================================
// SOURCE ACCOUNT TABLE
// =============================================================================

/**
 * Generic OAuth/connection for any source type.
 * Replaces email-specific account management with a unified approach.
 */
export const sourceAccount = pgTable(
  "source_account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Organization that owns this source (required for multi-tenancy)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // User who connected this source (for audit/tracking)
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "set null" }),

    // Source identification
    type: sourceTypeEnum("type").notNull(),
    provider: text("provider").notNull(), // "gmail", "outlook", "slack", "notion", etc.
    externalId: text("external_id").notNull(), // email address, workspace ID, etc.
    displayName: text("display_name"),

    // OAuth tokens (encrypted in production)
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at"),

    // API keys for non-OAuth sources
    apiKey: text("api_key"),

    // Webhook configuration
    webhookId: text("webhook_id"),
    webhookSecret: text("webhook_secret"),
    webhookUrl: text("webhook_url"),

    // Connection status
    status: sourceStatusEnum("status").notNull().default("disconnected"),

    // Sync state
    syncCursor: text("sync_cursor"),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncStatus: text("last_sync_status"),
    lastSyncError: text("last_sync_error"),
    nextSyncAt: timestamp("next_sync_at"),

    // Backfill tracking
    backfillProgress: jsonb("backfill_progress")
      .$type<SourceBackfillProgress>()
      .default({
        phase: "idle",
        totalItems: 0,
        processedItems: 0,
        phaseProgress: 0,
        overallProgress: 0,
        errorCount: 0,
      }),

    // Settings (source-specific configuration)
    settings: jsonb("settings").$type<SourceAccountSettings>().default({
      syncEnabled: true,
      syncFrequencyMinutes: 5,
    }),

    // Primary account flag (for sources with multiple accounts)
    isPrimary: boolean("is_primary").notNull().default(false),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("source_account_org_idx").on(table.organizationId),
    index("source_account_type_idx").on(table.type),
    index("source_account_status_idx").on(table.status),
    index("source_account_added_by_idx").on(table.addedByUserId),
    // Same external ID can only be connected once per organization per type
    unique("source_account_org_type_external_unique").on(
      table.organizationId,
      table.type,
      table.externalId
    ),
  ]
);

// =============================================================================
// CONVERSATION TABLE
// =============================================================================

/**
 * Generic conversation container for all source types.
 * Maps to: email thread, Slack channel/thread, calendar event, Notion page, etc.
 * Intelligence metadata is populated by AI agents.
 */
export const conversation = pgTable(
  "conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Source reference
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // External identification
    externalId: text("external_id").notNull(),
    conversationType: conversationTypeEnum("conversation_type"),

    // Display information
    title: text("title"),
    snippet: text("snippet"),

    // Participants (array of external IDs from the source)
    participantIds: text("participant_ids").array().default([]),

    // Message statistics
    messageCount: integer("message_count").notNull().default(0),
    firstMessageAt: timestamp("first_message_at"),
    lastMessageAt: timestamp("last_message_at"),

    // Status flags
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    isMuted: boolean("is_muted").notNull().default(false),
    isTrashed: boolean("is_trashed").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),

    // Snooze support
    snoozedUntil: timestamp("snoozed_until"),

    // ==========================================================================
    // INTELLIGENCE METADATA (populated by AI agents)
    // ==========================================================================

    // Thread/Conversation Understanding Agent
    briefSummary: text("brief_summary"), // 3-line contextual brief
    intentClassification: text("intent_classification"), // request, fyi, social, etc.
    urgencyScore: real("urgency_score"), // 0-1 score
    importanceScore: real("importance_score"), // 0-1 score
    sentimentScore: real("sentiment_score"), // -1 to 1

    // Open loops detection
    hasOpenLoops: boolean("has_open_loops").default(false),
    openLoopCount: integer("open_loop_count").default(0),

    // Triage/Prioritization Agent
    suggestedAction: text("suggested_action"), // respond, archive, delegate, etc.
    suggestedActionReason: text("suggested_action_reason"),
    priorityTier: priorityTierEnum("priority_tier"),

    // Intelligence counts
    commitmentCount: integer("commitment_count").default(0),
    decisionCount: integer("decision_count").default(0),
    claimCount: integer("claim_count").default(0),

    // Risk indicators
    hasRiskWarning: boolean("has_risk_warning").default(false),
    riskLevel: text("risk_level"), // low, medium, high, critical

    // Analysis tracking
    lastAnalyzedAt: timestamp("last_analyzed_at"),
    analysisVersion: text("analysis_version"),

    // Source-specific metadata (JSON for flexibility)
    metadata: jsonb("metadata").$type<ConversationMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("conversation_source_idx").on(table.sourceAccountId),
    index("conversation_last_message_idx").on(table.lastMessageAt),
    index("conversation_urgency_idx").on(table.urgencyScore),
    index("conversation_priority_idx").on(table.priorityTier),
    index("conversation_open_loops_idx").on(table.hasOpenLoops),
    index("conversation_is_read_idx").on(table.isRead),
    index("conversation_is_archived_idx").on(table.isArchived),
    index("conversation_type_idx").on(table.conversationType),
    // External ID must be unique per source account
    unique("conversation_source_external_unique").on(
      table.sourceAccountId,
      table.externalId
    ),
  ]
);

// =============================================================================
// MESSAGE TABLE
// =============================================================================

/**
 * Generic message/item within a conversation.
 * Maps to: email message, Slack message, calendar event details, Notion block, etc.
 */
export const message = pgTable(
  "message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Conversation reference
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),

    // External identification
    externalId: text("external_id").notNull(),

    // Sender information
    senderExternalId: text("sender_external_id").notNull(),
    senderName: text("sender_name"),
    senderEmail: text("sender_email"),
    senderAvatarUrl: text("sender_avatar_url"),

    // Recipients (for email-like sources)
    recipients: jsonb("recipients").$type<MessageRecipient[]>().default([]),

    // Content
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    snippet: text("snippet"),

    // Timestamps
    sentAt: timestamp("sent_at"),
    receivedAt: timestamp("received_at"),
    editedAt: timestamp("edited_at"),

    // Ordering within conversation
    messageIndex: integer("message_index").notNull().default(0),

    // Direction (sent by user vs received)
    isFromUser: boolean("is_from_user").notNull().default(false),

    // Attachments flag
    hasAttachments: boolean("has_attachments").notNull().default(false),

    // Source-specific metadata
    metadata: jsonb("metadata").$type<MessageMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("message_conversation_idx").on(table.conversationId),
    index("message_sender_idx").on(table.senderExternalId),
    index("message_sent_idx").on(table.sentAt),
    index("message_received_idx").on(table.receivedAt),
    // External ID must be unique per conversation
    unique("message_conv_external_unique").on(
      table.conversationId,
      table.externalId
    ),
  ]
);

// =============================================================================
// PARTICIPANT TABLE
// =============================================================================

/**
 * Links participants to contacts across all sources.
 * Enables cross-source relationship tracking.
 */
export const participant = pgTable(
  "participant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Source reference
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // Link to unified contact (optional - may not be resolved yet)
    contactId: text("contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),

    // External identification from source
    externalId: text("external_id").notNull(),

    // Display information from source
    displayName: text("display_name"),
    email: text("email"),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),

    // Source-specific metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // Resolution status
    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("participant_source_idx").on(table.sourceAccountId),
    index("participant_contact_idx").on(table.contactId),
    index("participant_email_idx").on(table.email),
    index("participant_resolved_idx").on(table.isResolved),
    // External ID must be unique per source account
    unique("participant_source_external_unique").on(
      table.sourceAccountId,
      table.externalId
    ),
  ]
);

// =============================================================================
// ATTACHMENT TABLE
// =============================================================================

/**
 * Generic attachment/file metadata for any source.
 */
export const attachment = pgTable(
  "attachment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Message reference
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),

    // External identification
    externalId: text("external_id"),

    // File metadata
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),

    // Inline attachment support (for embedded images)
    contentId: text("content_id"),
    isInline: boolean("is_inline").notNull().default(false),

    // Storage (for downloaded/cached files)
    storageKey: text("storage_key"),
    downloadUrl: text("download_url"),
    downloadedAt: timestamp("downloaded_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("attachment_message_idx").on(table.messageId),
    index("attachment_mime_idx").on(table.mimeType),
  ]
);

// =============================================================================
// RELATED CONVERSATIONS TABLE
// =============================================================================

/**
 * Relationship types between conversations
 */
export const conversationRelationTypeEnum = pgEnum(
  "conversation_relation_type",
  [
    "calendar_email", // Calendar event related to email thread
    "slack_email", // Slack thread related to email
    "calendar_slack", // Calendar event related to Slack
    "meeting_calendar", // Meeting transcript related to calendar event
    "follow_up", // One conversation is a follow-up to another
    "reference", // One conversation references another
    "duplicate", // Potential duplicate conversations
  ]
);

/**
 * Links related conversations across sources for cross-source intelligence.
 * Examples: calendar event → related email thread, Slack discussion → email thread
 */
export const relatedConversation = pgTable(
  "related_conversation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // The two related conversations
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    relatedConversationId: text("related_conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),

    // Relationship type
    relationType: conversationRelationTypeEnum("relation_type").notNull(),

    // How confident we are in this relationship
    confidence: real("confidence").notNull().default(0.5),

    // Why we think they're related
    matchReason: text("match_reason"), // e.g., "shared_participants", "subject_match", "explicit_reference"

    // Was this auto-detected or manually linked?
    isAutoDetected: boolean("is_auto_detected").notNull().default(true),

    // Allow users to dismiss false positives
    isDismissed: boolean("is_dismissed").notNull().default(false),
    dismissedAt: timestamp("dismissed_at"),
    dismissedByUserId: text("dismissed_by_user_id"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("related_conv_conv_idx").on(table.conversationId),
    index("related_conv_related_idx").on(table.relatedConversationId),
    index("related_conv_type_idx").on(table.relationType),
    index("related_conv_confidence_idx").on(table.confidence),
    // Prevent duplicate relationships
    unique("related_conv_pair_unique").on(
      table.conversationId,
      table.relatedConversationId,
      table.relationType
    ),
  ]
);

// =============================================================================
// CONVERSATION-TOPIC JUNCTION TABLE
// =============================================================================
// RELATIONS
// =============================================================================

export const sourceAccountRelations = relations(
  sourceAccount,
  ({ many, one }) => ({
    conversations: many(conversation),
    participants: many(participant),
    addedByUser: one(user, {
      fields: [sourceAccount.addedByUserId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [sourceAccount.organizationId],
      references: [organization.id],
    }),
  })
);

export const conversationRelations = relations(
  conversation,
  ({ many, one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [conversation.sourceAccountId],
      references: [sourceAccount.id],
    }),
    messages: many(message),
    topics: many(conversationTopic),
  })
);

export const messageRelations = relations(message, ({ many, one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  attachments: many(attachment),
}));

export const participantRelations = relations(participant, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [participant.sourceAccountId],
    references: [sourceAccount.id],
  }),
  contact: one(contact, {
    fields: [participant.contactId],
    references: [contact.id],
  }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  message: one(message, {
    fields: [attachment.messageId],
    references: [message.id],
  }),
}));

export const relatedConversationRelations = relations(
  relatedConversation,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [relatedConversation.conversationId],
      references: [conversation.id],
      relationName: "conversation",
    }),
    relatedConversation: one(conversation, {
      fields: [relatedConversation.relatedConversationId],
      references: [conversation.id],
      relationName: "relatedConversation",
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SourceAccount = typeof sourceAccount.$inferSelect;
export type NewSourceAccount = typeof sourceAccount.$inferInsert;
export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
export type Message = typeof message.$inferSelect;
export type NewMessage = typeof message.$inferInsert;
export type Participant = typeof participant.$inferSelect;
export type NewParticipant = typeof participant.$inferInsert;
export type Attachment = typeof attachment.$inferSelect;
export type NewAttachment = typeof attachment.$inferInsert;
export type RelatedConversation = typeof relatedConversation.$inferSelect;
export type NewRelatedConversation = typeof relatedConversation.$inferInsert;

// Relation type union for TypeScript
export type ConversationRelationType =
  | "calendar_email"
  | "slack_email"
  | "calendar_slack"
  | "meeting_calendar"
  | "follow_up"
  | "reference"
  | "duplicate";

// Source type union for TypeScript
export type SourceType =
  | "email"
  | "slack"
  | "calendar"
  | "whatsapp"
  | "notion"
  | "google_docs"
  | "google_sheets"
  | "meeting_transcript"
  | "teams"
  | "discord"
  | "linear"
  | "github";
