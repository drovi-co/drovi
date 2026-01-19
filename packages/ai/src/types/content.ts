// =============================================================================
// GENERIC CONTENT TYPES FOR MULTI-SOURCE INTELLIGENCE
// =============================================================================
//
// These types define source-agnostic data structures that work for any
// communication source: email, Slack, WhatsApp, Notion, Calendar, etc.
//
// The existing ThreadInput/ThreadMessage types remain for backward compatibility
// with the email-specific code paths. These new types enable multi-source
// intelligence extraction.
//

import { z } from "zod";

// =============================================================================
// SOURCE TYPES
// =============================================================================

/**
 * All supported source types for the multi-source intelligence platform.
 */
export const SourceType = z.enum([
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
export type SourceType = z.infer<typeof SourceType>;

/**
 * Conversation types within sources.
 * Each source type has different conversation structures.
 */
export const ConversationType = z.enum([
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
export type ConversationType = z.infer<typeof ConversationType>;

// =============================================================================
// PARTICIPANT/RECIPIENT TYPES
// =============================================================================

/**
 * Recipient type in a message.
 */
export const RecipientType = z.enum([
  "to",
  "cc",
  "bcc",
  "mention",
  "reaction",
  "assignee",
  "reviewer",
]);
export type RecipientType = z.infer<typeof RecipientType>;

/**
 * A recipient of a message.
 * Works across all sources - email addresses, Slack handles, phone numbers, etc.
 */
export const MessageRecipientSchema = z.object({
  id: z.string(), // External ID from source (email, user ID, phone number)
  email: z.string().optional(),
  name: z.string().optional(),
  type: RecipientType,
});
export type MessageRecipient = z.infer<typeof MessageRecipientSchema>;

/**
 * A participant in a conversation.
 * Used for building contact profiles and relationship intelligence.
 */
export const ParticipantSchema = z.object({
  id: z.string(), // External ID from source
  email: z.string().optional(),
  name: z.string().optional(),
  avatarUrl: z.string().optional(),
  // Source-specific metadata
  metadata: z.record(z.unknown()).optional(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// =============================================================================
// MESSAGE TYPES
// =============================================================================

/**
 * Generic message input for analysis.
 * Works for: email messages, Slack messages, WhatsApp messages,
 * Notion comments, document comments, meeting transcript segments, etc.
 */
export const MessageInputSchema = z.object({
  // Identification
  id: z.string(),
  externalId: z.string(), // ID from the source system

  // Sender information
  senderId: z.string(), // External ID of sender
  senderName: z.string().optional(),
  senderEmail: z.string().optional(),

  // Direction
  isFromUser: z.boolean(), // Was this sent by the account owner?

  // Recipients (for email-like sources)
  recipients: z.array(MessageRecipientSchema).optional(),

  // Content
  subject: z.string().optional(), // For email-like sources
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),

  // Timing
  sentAt: z.date().optional(),
  receivedAt: z.date().optional(),
  editedAt: z.date().optional(),

  // Ordering within conversation
  messageIndex: z.number(),

  // Attachments flag
  hasAttachments: z.boolean().optional(),

  // Source-specific metadata
  metadata: z.record(z.unknown()).optional(),
});
export type MessageInput = z.infer<typeof MessageInputSchema>;

// =============================================================================
// CONVERSATION TYPES
// =============================================================================

/**
 * Generic conversation input for analysis.
 * Works for: email threads, Slack channels/DMs/threads, WhatsApp chats,
 * Notion pages, calendar events, meeting transcripts, etc.
 */
export const ConversationInputSchema = z.object({
  // Identification
  id: z.string(),
  externalId: z.string(), // ID from the source system

  // Source information
  sourceId: z.string(), // Source account ID
  sourceType: SourceType,
  organizationId: z.string(),

  // Conversation type within source
  conversationType: ConversationType.optional(),

  // Display information
  title: z.string().optional(), // Subject for email, channel name for Slack, etc.

  // Participants
  participantIds: z.array(z.string()), // External IDs of participants
  userIdentifier: z.string(), // The user's ID in this source (email, Slack user ID, etc.)

  // Messages
  messages: z.array(MessageInputSchema),

  // Source-specific metadata
  metadata: z.record(z.unknown()).optional(),
});
export type ConversationInput = z.infer<typeof ConversationInputSchema>;

// =============================================================================
// SOURCE-SPECIFIC CONVERSATION TYPES
// =============================================================================

/**
 * Email-specific conversation (thread).
 */
export interface EmailConversation extends ConversationInput {
  sourceType: "email";
  conversationType: "thread";
  metadata?: {
    providerThreadId: string;
    inReplyTo?: string;
    references?: string[];
    labels?: string[];
    isRead?: boolean;
    isStarred?: boolean;
    isArchived?: boolean;
  };
}

/**
 * Slack-specific conversation (channel, DM, or thread).
 */
export interface SlackConversation extends ConversationInput {
  sourceType: "slack";
  conversationType: "channel" | "dm" | "group_dm" | "slack_thread";
  metadata?: {
    channelId: string;
    channelName?: string;
    threadTs?: string; // Thread parent timestamp
    isPrivate?: boolean;
    isMember?: boolean;
    isArchived?: boolean;
  };
}

/**
 * Calendar event as a conversation (for extracting commitments, decisions).
 */
export interface CalendarConversation extends ConversationInput {
  sourceType: "calendar";
  conversationType: "event" | "recurring_event";
  metadata?: {
    eventId: string;
    calendarId?: string;
    location?: string;
    conferenceUrl?: string;
    start: Date;
    end: Date;
    isAllDay?: boolean;
    recurrenceRule?: string;
    status?: "confirmed" | "tentative" | "cancelled";
    organizer?: {
      email: string;
      name?: string;
    };
    attendees?: Array<{
      email: string;
      name?: string;
      status: "accepted" | "declined" | "tentative" | "needs_action";
      isOrganizer?: boolean;
    }>;
  };
}

/**
 * WhatsApp-specific conversation.
 */
export interface WhatsAppConversation extends ConversationInput {
  sourceType: "whatsapp";
  conversationType: "dm" | "chat" | "group_chat";
  metadata?: {
    waId?: string; // Contact's WhatsApp ID
    phoneNumberId?: string; // Our phone number ID
    displayPhoneNumber?: string; // Our formatted phone number
    wabaId?: string; // WhatsApp Business Account ID
    wabaName?: string; // WhatsApp Business Account name
    contactName?: string; // Contact's display name
    groupId?: string;
    groupName?: string;
  };
}

/**
 * Notion-specific conversation (page or comment thread).
 */
export interface NotionConversation extends ConversationInput {
  sourceType: "notion";
  conversationType: "page" | "database_item" | "comment_thread";
  metadata?: {
    pageId: string;
    workspaceId: string;
    databaseId?: string;
    parentPageId?: string;
    pageType?: "page" | "database";
    url?: string;
  };
}

/**
 * Google Docs-specific conversation (document or comment thread).
 */
export interface GoogleDocsConversation extends ConversationInput {
  sourceType: "google_docs";
  conversationType: "document" | "doc_comment_thread";
  metadata?: {
    documentId: string;
    documentTitle?: string;
    url?: string;
    commentAnchor?: string; // For comment threads
  };
}

/**
 * Meeting transcript as a conversation.
 */
export interface MeetingTranscriptConversation extends ConversationInput {
  sourceType: "meeting_transcript";
  conversationType: "meeting" | "recording";
  metadata?: {
    meetingId?: string;
    meetingPlatform?: "zoom" | "teams" | "meet" | "other";
    recordingUrl?: string;
    duration?: number; // Seconds
    startTime?: Date;
    endTime?: Date;
    calendarEventId?: string; // Link to associated calendar event
  };
}

// =============================================================================
// ANALYSIS OUTPUT TYPES (Source-Agnostic)
// =============================================================================

/**
 * Analysis result that includes source information.
 * Extends the base ThreadAnalysis with source context.
 */
export interface ConversationAnalysisContext {
  // Source identification
  sourceId: string;
  sourceType: SourceType;
  conversationType?: ConversationType;

  // For evidence linking
  sourceDisplayName?: string; // "Gmail", "Slack #general", etc.
  sourceUrl?: string; // Deep link to source
}

// =============================================================================
// ADAPTER TYPES
// =============================================================================

/**
 * Source adapter interface.
 * Each source implements this to convert its data to generic format.
 */
export interface SourceAdapter<TRawConversation, TRawMessage = unknown> {
  readonly sourceType: SourceType;

  /**
   * Convert raw conversation data to generic ConversationInput.
   */
  toConversation(
    raw: TRawConversation,
    sourceId: string,
    userIdentifier: string
  ): ConversationInput;

  /**
   * Convert raw message data to generic MessageInput.
   */
  toMessage(raw: TRawMessage, messageIndex: number): MessageInput;

  /**
   * Extract participant from raw data.
   */
  toParticipant?(raw: unknown): Participant;

  /**
   * Get display name for source (e.g., "Gmail", "Slack #general").
   */
  getSourceDisplayName?(conversation: ConversationInput): string;

  /**
   * Get deep link URL to source.
   */
  getSourceUrl?(conversation: ConversationInput, messageId?: string): string | undefined;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Extract user identifier from different source types.
 */
export function getUserIdentifierType(sourceType: SourceType): string {
  switch (sourceType) {
    case "email":
      return "email";
    case "slack":
    case "discord":
    case "teams":
      return "user_id";
    case "whatsapp":
      return "phone_number";
    case "notion":
    case "google_docs":
    case "google_sheets":
      return "user_id";
    case "calendar":
      return "email";
    case "meeting_transcript":
      return "speaker_id";
    case "linear":
    case "github":
      return "username";
    default:
      return "id";
  }
}

/**
 * Get source display config for UI.
 */
export interface SourceDisplayConfig {
  icon: string; // Icon identifier (e.g., "mail", "slack", "calendar")
  color: string; // Brand color hex
  label: string; // Display label (e.g., "Email", "Slack")
  description: string; // Short description
}

export const SOURCE_DISPLAY_CONFIG: Record<SourceType, SourceDisplayConfig> = {
  email: {
    icon: "mail",
    color: "#EA4335",
    label: "Email",
    description: "Gmail, Outlook, and other email providers",
  },
  slack: {
    icon: "hash",
    color: "#4A154B",
    label: "Slack",
    description: "Messages and threads from Slack",
  },
  calendar: {
    icon: "calendar",
    color: "#4285F4",
    label: "Calendar",
    description: "Events and meeting details",
  },
  whatsapp: {
    icon: "message-circle",
    color: "#25D366",
    label: "WhatsApp",
    description: "Personal and business messaging",
  },
  notion: {
    icon: "file-text",
    color: "#000000",
    label: "Notion",
    description: "Pages, databases, and comments",
  },
  google_docs: {
    icon: "file-text",
    color: "#4285F4",
    label: "Google Docs",
    description: "Documents and comments",
  },
  google_sheets: {
    icon: "table",
    color: "#0F9D58",
    label: "Google Sheets",
    description: "Spreadsheets and comments",
  },
  meeting_transcript: {
    icon: "mic",
    color: "#FF6B6B",
    label: "Meetings",
    description: "Transcripts from Zoom, Teams, Meet",
  },
  teams: {
    icon: "users",
    color: "#6264A7",
    label: "Teams",
    description: "Microsoft Teams messages",
  },
  discord: {
    icon: "hash",
    color: "#5865F2",
    label: "Discord",
    description: "Discord channels and DMs",
  },
  linear: {
    icon: "check-circle",
    color: "#5E6AD2",
    label: "Linear",
    description: "Issues and comments",
  },
  github: {
    icon: "git-branch",
    color: "#24292E",
    label: "GitHub",
    description: "Issues, PRs, and discussions",
  },
};
