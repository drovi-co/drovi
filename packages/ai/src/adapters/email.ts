// =============================================================================
// EMAIL ADAPTER
// =============================================================================
//
// Converts email data (EmailThread, EmailMessage) to generic ConversationInput
// format for multi-source intelligence processing.
//

import type {
  ConversationInput,
  EmailConversation,
  MessageInput,
  Participant,
  SourceAdapter,
} from "../types/content";

// =============================================================================
// EMAIL-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * Email message from database (matches EmailMessage schema).
 */
export interface EmailMessageData {
  id: string;
  providerMessageId: string;
  fromEmail: string;
  fromName?: string | null;
  toRecipients?: Array<{ email: string; name?: string | null }> | null;
  ccRecipients?: Array<{ email: string; name?: string | null }> | null;
  bccRecipients?: Array<{ email: string; name?: string | null }> | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  snippet?: string | null;
  sentAt?: Date | null;
  receivedAt?: Date | null;
  isFromUser: boolean;
  messageIndex: number;
  headers?: Record<string, string> | null;
  labelIds?: string[] | null;
  sizeBytes?: number | null;
}

/**
 * Email thread from database (matches EmailThread schema).
 */
export interface EmailThreadData {
  id: string;
  accountId: string;
  providerThreadId: string;
  subject?: string | null;
  snippet?: string | null;
  participantEmails?: string[] | null;
  messageCount: number;
  hasAttachments: boolean;
  firstMessageAt?: Date | null;
  lastMessageAt?: Date | null;
  labels?: string[] | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isDraft: boolean;
  isTrashed: boolean;
  // Intelligence metadata (optional, may not be loaded)
  briefSummary?: string | null;
  intentClassification?: string | null;
  urgencyScore?: number | null;
  importanceScore?: number | null;
  sentimentScore?: number | null;
  hasOpenLoops?: boolean | null;
  openLoopCount?: number | null;
  suggestedAction?: string | null;
  priorityTier?: string | null;
}

/**
 * Email thread with messages loaded.
 */
export interface EmailThreadWithMessages extends EmailThreadData {
  messages: EmailMessageData[];
  account?: {
    id: string;
    organizationId: string;
    email: string;
  };
}

// =============================================================================
// EMAIL ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Email adapter for converting email data to generic format.
 */
export const emailAdapter: SourceAdapter<
  EmailThreadWithMessages,
  EmailMessageData
> = {
  sourceType: "email",

  /**
   * Convert email thread to generic ConversationInput.
   */
  toConversation(
    thread: EmailThreadWithMessages,
    sourceId: string,
    userEmail: string
  ): EmailConversation {
    return {
      id: thread.id,
      externalId: thread.providerThreadId,
      sourceId,
      sourceType: "email",
      organizationId: thread.account?.organizationId ?? "",
      conversationType: "thread",
      title: thread.subject ?? undefined,
      participantIds: thread.participantEmails ?? [],
      userIdentifier: userEmail,
      messages: thread.messages.map((msg, idx) =>
        this.toMessage(msg, msg.messageIndex ?? idx)
      ),
      metadata: {
        providerThreadId: thread.providerThreadId,
        inReplyTo: thread.messages[0]?.headers?.["in-reply-to"] ?? undefined,
        references: thread.messages[0]?.headers?.references?.split(" "),
        labels: thread.labels ?? undefined,
        isRead: thread.isRead,
        isStarred: thread.isStarred,
        isArchived: thread.isArchived,
      },
    };
  },

  /**
   * Convert email message to generic MessageInput.
   */
  toMessage(msg: EmailMessageData, messageIndex: number): MessageInput {
    const recipients = [
      ...(msg.toRecipients ?? []).map((r) => ({
        id: r.email,
        email: r.email,
        name: r.name ?? undefined,
        type: "to" as const,
      })),
      ...(msg.ccRecipients ?? []).map((r) => ({
        id: r.email,
        email: r.email,
        name: r.name ?? undefined,
        type: "cc" as const,
      })),
      ...(msg.bccRecipients ?? []).map((r) => ({
        id: r.email,
        email: r.email,
        name: r.name ?? undefined,
        type: "bcc" as const,
      })),
    ];

    return {
      id: msg.id,
      externalId: msg.providerMessageId,
      senderId: msg.fromEmail,
      senderName: msg.fromName ?? undefined,
      senderEmail: msg.fromEmail,
      isFromUser: msg.isFromUser,
      recipients: recipients.length > 0 ? recipients : undefined,
      subject: msg.subject ?? undefined,
      bodyText: msg.bodyText ?? undefined,
      bodyHtml: msg.bodyHtml ?? undefined,
      sentAt: msg.sentAt ?? undefined,
      receivedAt: msg.receivedAt ?? undefined,
      messageIndex,
      hasAttachments: Boolean(msg.sizeBytes && msg.sizeBytes > 0),
      metadata: {
        headers: msg.headers ?? undefined,
        labelIds: msg.labelIds ?? undefined,
        sizeBytes: msg.sizeBytes ?? undefined,
        snippet: msg.snippet ?? undefined,
      },
    };
  },

  /**
   * Extract participant from email address.
   */
  toParticipant(raw: unknown): Participant {
    if (typeof raw === "string") {
      // Just an email address
      return {
        id: raw,
        email: raw,
      };
    }

    if (
      typeof raw === "object" &&
      raw !== null &&
      "email" in raw &&
      typeof (raw as { email: unknown }).email === "string"
    ) {
      const data = raw as { email: string; name?: string | null };
      return {
        id: data.email,
        email: data.email,
        name: data.name ?? undefined,
      };
    }

    throw new Error("Invalid email participant data");
  },

  /**
   * Get display name for email source.
   */
  getSourceDisplayName(_conversation: ConversationInput): string {
    return "Email";
  },

  /**
   * Get deep link URL to email thread.
   * Note: This is a placeholder - actual implementation depends on provider.
   */
  getSourceUrl(
    conversation: ConversationInput,
    _messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as
      | EmailConversation["metadata"]
      | undefined;
    const threadId = metadata?.providerThreadId ?? conversation.externalId;

    // Gmail web URL format
    if (threadId) {
      return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
    }

    return undefined;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert legacy ThreadInput to ConversationInput.
 * This enables gradual migration from email-specific to generic types.
 */
export function threadInputToConversationInput(
  thread: {
    id: string;
    accountId: string;
    organizationId: string;
    providerThreadId: string;
    subject?: string;
    participantEmails?: string[];
    userEmail: string;
    messages: Array<{
      id: string;
      providerMessageId: string;
      fromEmail: string;
      fromName?: string;
      toRecipients: Array<{ email: string; name?: string }>;
      ccRecipients?: Array<{ email: string; name?: string }>;
      subject?: string;
      bodyText?: string;
      bodyHtml?: string;
      sentAt?: Date;
      receivedAt?: Date;
      isFromUser: boolean;
      messageIndex: number;
    }>;
  },
  sourceId: string
): ConversationInput {
  return {
    id: thread.id,
    externalId: thread.providerThreadId,
    sourceId,
    sourceType: "email",
    organizationId: thread.organizationId,
    conversationType: "thread",
    title: thread.subject,
    participantIds: thread.participantEmails ?? [],
    userIdentifier: thread.userEmail,
    messages: thread.messages.map((msg) => ({
      id: msg.id,
      externalId: msg.providerMessageId,
      senderId: msg.fromEmail,
      senderName: msg.fromName,
      senderEmail: msg.fromEmail,
      isFromUser: msg.isFromUser,
      recipients: [
        ...msg.toRecipients.map((r) => ({
          id: r.email,
          email: r.email,
          name: r.name,
          type: "to" as const,
        })),
        ...(msg.ccRecipients ?? []).map((r) => ({
          id: r.email,
          email: r.email,
          name: r.name,
          type: "cc" as const,
        })),
      ],
      subject: msg.subject,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
      sentAt: msg.sentAt,
      receivedAt: msg.receivedAt,
      messageIndex: msg.messageIndex,
    })),
    metadata: {
      providerThreadId: thread.providerThreadId,
    },
  };
}

/**
 * Convert ConversationInput back to legacy ThreadInput format.
 * Useful for backward compatibility with existing agents.
 */
export function conversationInputToThreadInput(
  conversation: ConversationInput
): {
  id: string;
  accountId: string;
  organizationId: string;
  providerThreadId: string;
  subject?: string;
  participantEmails?: string[];
  userEmail: string;
  messages: Array<{
    id: string;
    providerMessageId: string;
    fromEmail: string;
    fromName?: string;
    toRecipients: Array<{ email: string; name?: string }>;
    ccRecipients?: Array<{ email: string; name?: string }>;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    sentAt?: Date;
    receivedAt?: Date;
    isFromUser: boolean;
    messageIndex: number;
  }>;
} {
  const metadata = conversation.metadata as Record<string, unknown> | undefined;

  return {
    id: conversation.id,
    accountId: conversation.sourceId,
    organizationId: conversation.organizationId,
    providerThreadId:
      (metadata?.providerThreadId as string) ?? conversation.externalId,
    subject: conversation.title,
    participantEmails: conversation.participantIds,
    userEmail: conversation.userIdentifier,
    messages: conversation.messages.map((msg) => ({
      id: msg.id,
      providerMessageId: msg.externalId,
      fromEmail: msg.senderEmail ?? msg.senderId,
      fromName: msg.senderName,
      toRecipients: (msg.recipients ?? [])
        .filter((r) => r.type === "to")
        .map((r) => ({ email: r.email ?? r.id, name: r.name })),
      ccRecipients: (msg.recipients ?? [])
        .filter((r) => r.type === "cc")
        .map((r) => ({ email: r.email ?? r.id, name: r.name })),
      subject: msg.subject,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
      sentAt: msg.sentAt,
      receivedAt: msg.receivedAt,
      isFromUser: msg.isFromUser,
      messageIndex: msg.messageIndex,
    })),
  };
}
