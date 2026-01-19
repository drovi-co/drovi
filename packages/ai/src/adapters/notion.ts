// =============================================================================
// NOTION ADAPTER
// =============================================================================
//
// Converts Notion pages and comments to generic ConversationInput format for
// multi-source intelligence processing. Notion content maps to:
// - Pages → page conversation type
// - Database items → database_item conversation type
// - Comments → messages within a conversation
//

import type {
  ConversationInput,
  MessageInput,
  MessageRecipient,
  NotionConversation,
  Participant,
  SourceAdapter,
} from "../types/content";

// =============================================================================
// NOTION-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * Notion user profile information.
 */
export interface NotionUserData {
  id: string;
  type: "person" | "bot";
  name?: string;
  avatarUrl?: string;
  email?: string;
}

/**
 * Notion page data for conversion.
 */
export interface NotionPageData {
  id: string;
  workspaceId: string;
  title: string;
  content: string; // Extracted plain text from blocks
  url: string;
  parentType: "workspace" | "page_id" | "database_id";
  parentId?: string;
  isArchived: boolean;
  isDatabase: boolean; // True if this page is a database item
  databaseId?: string; // If this is a database item
  createdAt: Date;
  updatedAt: Date;
  createdById?: string;
  lastEditedById?: string;
  icon?: string;
  coverUrl?: string;
  properties?: Record<string, unknown>; // Database item properties
}

/**
 * Notion comment data.
 */
export interface NotionCommentData {
  id: string;
  discussionId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  createdByName?: string;
  createdByEmail?: string;
  parentType: "page_id" | "block_id";
  parentId: string;
}

/**
 * Context for Notion workspace.
 */
export interface NotionWorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  botId: string;
  ownerId: string;
  ownerEmail?: string;
}

// =============================================================================
// NOTION ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Notion adapter for converting Notion data to generic format.
 *
 * Notion pages are treated as conversations where:
 * - Page content forms the initial message
 * - Comments form subsequent messages
 * - Commitments and decisions can be extracted from both
 */
export const notionAdapter: SourceAdapter<
  { page: NotionPageData; comments: NotionCommentData[] },
  NotionCommentData
> = {
  sourceType: "notion",

  /**
   * Convert Notion page with comments to generic ConversationInput.
   */
  toConversation(
    data: { page: NotionPageData; comments: NotionCommentData[] },
    sourceId: string,
    userIdentifier: string
  ): NotionConversation {
    const { page, comments } = data;

    // Determine conversation type
    const conversationType = page.isDatabase ? "database_item" : "page";

    // Build participant list from page creator and comment authors
    const participantIds = new Set<string>();
    if (page.createdById) {
      participantIds.add(page.createdById);
    }
    if (page.lastEditedById) {
      participantIds.add(page.lastEditedById);
    }
    for (const comment of comments) {
      participantIds.add(comment.createdById);
    }

    // Create the page content as the first "message"
    const messages: MessageInput[] = [];

    // Add page content as first message
    if (page.content) {
      messages.push({
        id: `${page.id}_content`,
        externalId: page.id,
        senderId: page.createdById ?? "unknown",
        senderName: undefined, // Will be enriched with user lookup
        senderEmail: undefined,
        isFromUser: page.createdById === userIdentifier,
        recipients: undefined,
        subject: page.title,
        bodyText: page.content,
        bodyHtml: undefined,
        sentAt: page.createdAt,
        receivedAt: page.createdAt,
        editedAt: page.updatedAt,
        messageIndex: 0,
        hasAttachments: false,
        metadata: {
          isPageContent: true,
          icon: page.icon,
          coverUrl: page.coverUrl,
          properties: page.properties,
        },
      });
    }

    // Sort comments by creation time
    const sortedComments = [...comments].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );

    // Add comments as subsequent messages
    for (const [index, comment] of sortedComments.entries()) {
      messages.push(notionAdapter.toMessage(comment, index + 1));
    }

    return {
      id: page.id,
      externalId: page.id,
      sourceId,
      sourceType: "notion",
      organizationId: "", // Will be set by caller
      conversationType,
      title: page.title,
      participantIds: [...participantIds],
      userIdentifier,
      messages,
      metadata: {
        pageId: page.id,
        workspaceId: page.workspaceId,
        databaseId: page.databaseId,
        parentPageId: page.parentType === "page_id" ? page.parentId : undefined,
        pageType: page.isDatabase ? "database" : "page",
        url: page.url,
      },
    };
  },

  /**
   * Convert Notion comment to generic MessageInput.
   */
  toMessage(comment: NotionCommentData, messageIndex: number): MessageInput {
    // Extract mentions from comment content
    const recipients = extractNotionMentions(comment.content);

    return {
      id: comment.id,
      externalId: comment.id,
      senderId: comment.createdById,
      senderName: comment.createdByName,
      senderEmail: comment.createdByEmail,
      isFromUser: false, // Will be set based on userIdentifier
      recipients,
      subject: undefined, // Comments don't have subjects
      bodyText: comment.content,
      bodyHtml: undefined,
      sentAt: comment.createdAt,
      receivedAt: comment.createdAt,
      editedAt: comment.updatedAt,
      messageIndex,
      hasAttachments: false,
      metadata: {
        discussionId: comment.discussionId,
        parentType: comment.parentType,
        parentId: comment.parentId,
      },
    };
  },

  /**
   * Extract participant from Notion user data.
   */
  toParticipant(raw: unknown): Participant {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "id" in raw &&
      typeof (raw as { id: unknown }).id === "string"
    ) {
      const user = raw as NotionUserData;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        metadata: {
          type: user.type,
        },
      };
    }

    throw new Error("Invalid Notion user data");
  },

  /**
   * Get display name for Notion source.
   */
  getSourceDisplayName(conversation: ConversationInput): string {
    if (conversation.title) {
      return conversation.title;
    }
    return "Notion Page";
  },

  /**
   * Get deep link URL to Notion page.
   */
  getSourceUrl(
    conversation: ConversationInput,
    _messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as NotionConversation["metadata"];
    return metadata?.url;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract @mentions from Notion content.
 * Notion mentions format: @User Name or user_id references
 */
function extractNotionMentions(content: string): MessageRecipient[] {
  const mentions: MessageRecipient[] = [];

  // Notion mentions are typically inline in the rich text
  // The actual format depends on how the content was extracted
  // For now, we'll look for @mentions in plain text
  const mentionRegex = /@([^\s@]+)/g;
  let match: RegExpExecArray | null = null;

  match = mentionRegex.exec(content);
  while (match !== null) {
    const userName = match[1];
    if (userName) {
      mentions.push({
        id: userName,
        name: userName,
        type: "mention",
      });
    }
    match = mentionRegex.exec(content);
  }

  return mentions;
}

// =============================================================================
// COMMITMENT EXTRACTION HELPERS
// =============================================================================

/**
 * Patterns that might indicate commitments in Notion content.
 */
const COMMITMENT_PATTERNS = [
  /\[\s*\]\s+/i, // Unchecked checkbox
  /- \[ \]/i, // Markdown unchecked
  /todo[::\s]/i,
  /action item[::\s]/i,
  /assigned to/i,
  /deadline[::\s]/i,
  /due[::\s]/i,
  /by (?:end of day|eod|tomorrow|next week|monday|tuesday|wednesday|thursday|friday)/i,
  /i('ll| will) (?:do|send|complete|finish|deliver|handle|take care of)/i,
  /promise to/i,
  /committed to/i,
];

/**
 * Check if Notion content likely contains a commitment.
 */
export function mayContainCommitment(content: string): boolean {
  const text = content.toLowerCase();
  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Patterns that might indicate decisions in Notion content.
 */
const DECISION_PATTERNS = [
  /decided to/i,
  /decision[::\s]/i,
  /we('re| are) going with/i,
  /final decision[::\s]/i,
  /approved/i,
  /rejected/i,
  /let's go with/i,
  /the plan is/i,
  /we('ll| will) proceed with/i,
  /resolution[::\s]/i,
  /concluded/i,
];

/**
 * Check if Notion content likely contains a decision.
 */
export function mayContainDecision(content: string): boolean {
  const text = content.toLowerCase();
  return DECISION_PATTERNS.some((pattern) => pattern.test(text));
}

// Types are exported inline above
