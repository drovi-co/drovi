// =============================================================================
// GOOGLE DOCS ADAPTER
// =============================================================================
//
// Converts Google Docs documents and comments to generic ConversationInput format
// for multi-source intelligence processing. Google Docs content maps to:
// - Documents → document conversation type
// - Comment threads → messages within a conversation
//

import type {
  ConversationInput,
  GoogleDocsConversation,
  MessageInput,
  MessageRecipient,
  Participant,
  SourceAdapter,
} from "../types/content";

// =============================================================================
// GOOGLE DOCS-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * Google user profile information.
 */
export interface GoogleUserData {
  id: string;
  email?: string;
  displayName?: string;
  photoLink?: string;
}

/**
 * Google Docs document data for conversion.
 */
export interface GoogleDocData {
  id: string;
  title: string;
  content: string; // Extracted plain text from document
  url: string;
  mimeType: string;
  description?: string;
  parentFolderId?: string;
  isStarred: boolean;
  isTrashed: boolean;
  createdAt: Date;
  modifiedAt: Date;
  ownerEmail?: string;
  ownerName?: string;
  lastModifiedByEmail?: string;
  lastModifiedByName?: string;
  revisionId?: string;
}

/**
 * Google Docs comment data.
 */
export interface GoogleDocCommentData {
  id: string;
  content: string;
  anchor?: string; // Where in the doc the comment is anchored
  quotedContent?: string; // The quoted/highlighted text
  createdAt: Date;
  modifiedAt: Date;
  authorEmail?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  isResolved: boolean;
  replies: GoogleDocReplyData[];
}

/**
 * Google Docs comment reply data.
 */
export interface GoogleDocReplyData {
  id: string;
  content: string;
  createdAt: Date;
  modifiedAt: Date;
  authorEmail?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  isDeleted: boolean;
}

// =============================================================================
// GOOGLE DOCS ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Google Docs adapter for converting Google Docs data to generic format.
 *
 * Google Docs documents are treated as conversations where:
 * - Document content forms the initial message
 * - Comments and replies form subsequent messages
 * - Commitments and decisions can be extracted from both
 */
export const googleDocsAdapter: SourceAdapter<
  { document: GoogleDocData; comments: GoogleDocCommentData[] },
  GoogleDocCommentData | GoogleDocReplyData
> = {
  sourceType: "google_docs",

  /**
   * Convert Google Doc with comments to generic ConversationInput.
   */
  toConversation(
    data: { document: GoogleDocData; comments: GoogleDocCommentData[] },
    sourceId: string,
    userIdentifier: string
  ): GoogleDocsConversation {
    const { document, comments } = data;

    // Build participant list from document owner/editor and comment authors
    const participantEmails = new Set<string>();
    if (document.ownerEmail) {
      participantEmails.add(document.ownerEmail);
    }
    if (document.lastModifiedByEmail) {
      participantEmails.add(document.lastModifiedByEmail);
    }
    for (const comment of comments) {
      if (comment.authorEmail) {
        participantEmails.add(comment.authorEmail);
      }
      for (const reply of comment.replies) {
        if (reply.authorEmail) {
          participantEmails.add(reply.authorEmail);
        }
      }
    }

    // Create the document content as the first "message"
    const messages: MessageInput[] = [];

    // Add document content as first message
    if (document.content) {
      messages.push({
        id: `${document.id}_content`,
        externalId: document.id,
        senderId: document.ownerEmail ?? "unknown",
        senderName: document.ownerName,
        senderEmail: document.ownerEmail,
        isFromUser: document.ownerEmail === userIdentifier,
        recipients: undefined,
        subject: document.title,
        bodyText: document.content,
        bodyHtml: undefined,
        sentAt: document.createdAt,
        receivedAt: document.createdAt,
        editedAt: document.modifiedAt,
        messageIndex: 0,
        hasAttachments: false,
        metadata: {
          isDocumentContent: true,
          description: document.description,
          revisionId: document.revisionId,
        },
      });
    }

    // Flatten comments and replies, sorted by creation time
    const allMessages: Array<{
      data: GoogleDocCommentData | GoogleDocReplyData;
      createdAt: Date;
      isReply: boolean;
      parentCommentId?: string;
    }> = [];

    for (const comment of comments) {
      allMessages.push({
        data: comment,
        createdAt: comment.createdAt,
        isReply: false,
      });
      for (const reply of comment.replies) {
        if (!reply.isDeleted) {
          allMessages.push({
            data: reply,
            createdAt: reply.createdAt,
            isReply: true,
            parentCommentId: comment.id,
          });
        }
      }
    }

    // Sort by creation time
    allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Add comments and replies as subsequent messages
    for (const [index, msg] of allMessages.entries()) {
      const messageInput = googleDocsAdapter.toMessage(msg.data, index + 1);
      if (msg.isReply) {
        messageInput.metadata = {
          ...messageInput.metadata,
          isReply: true,
          parentCommentId: msg.parentCommentId,
        };
      }
      messages.push(messageInput);
    }

    return {
      id: document.id,
      externalId: document.id,
      sourceId,
      sourceType: "google_docs",
      organizationId: "", // Will be set by caller
      conversationType: "document",
      title: document.title,
      participantIds: [...participantEmails],
      userIdentifier,
      messages,
      metadata: {
        documentId: document.id,
        documentTitle: document.title,
        url: document.url,
      },
    };
  },

  /**
   * Convert Google Docs comment or reply to generic MessageInput.
   */
  toMessage(
    msg: GoogleDocCommentData | GoogleDocReplyData,
    messageIndex: number
  ): MessageInput {
    // Type guard to check if it's a comment (has anchor/quotedContent) vs reply
    const isComment = "anchor" in msg;
    const comment = msg as GoogleDocCommentData;
    const reply = msg as GoogleDocReplyData;

    // Extract mentions from content
    const recipients = extractGoogleDocMentions(msg.content);

    return {
      id: msg.id,
      externalId: msg.id,
      senderId: msg.authorEmail ?? "unknown",
      senderName: msg.authorName,
      senderEmail: msg.authorEmail,
      isFromUser: false, // Will be set based on userIdentifier
      recipients,
      subject: undefined, // Comments don't have subjects
      bodyText: msg.content,
      bodyHtml: undefined,
      sentAt: msg.createdAt,
      receivedAt: msg.createdAt,
      editedAt: msg.modifiedAt,
      messageIndex,
      hasAttachments: false,
      metadata: isComment
        ? {
            anchor: comment.anchor,
            quotedContent: comment.quotedContent,
            isResolved: comment.isResolved,
            replyCount: comment.replies?.length ?? 0,
          }
        : {
            isDeleted: reply.isDeleted,
          },
    };
  },

  /**
   * Extract participant from Google user data.
   */
  toParticipant(raw: unknown): Participant {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "email" in raw &&
      typeof (raw as { email: unknown }).email === "string"
    ) {
      const user = raw as GoogleUserData;
      return {
        id: user.id ?? user.email ?? "",
        email: user.email,
        name: user.displayName,
        avatarUrl: user.photoLink,
        metadata: {},
      };
    }

    throw new Error("Invalid Google user data");
  },

  /**
   * Get display name for Google Docs source.
   */
  getSourceDisplayName(conversation: ConversationInput): string {
    const metadata = conversation.metadata as GoogleDocsConversation["metadata"];
    if (metadata?.documentTitle) {
      return metadata.documentTitle;
    }
    if (conversation.title) {
      return conversation.title;
    }
    return "Google Doc";
  },

  /**
   * Get deep link URL to Google Doc.
   */
  getSourceUrl(
    conversation: ConversationInput,
    _messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as GoogleDocsConversation["metadata"];
    return metadata?.url;
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract @mentions from Google Docs content.
 * Google Docs uses + or @ for mentions.
 */
function extractGoogleDocMentions(content: string): MessageRecipient[] {
  const mentions: MessageRecipient[] = [];

  // Google Docs mentions: @email or +email
  const mentionRegex = /[@+]([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  let match: RegExpExecArray | null = null;

  match = mentionRegex.exec(content);
  while (match !== null) {
    const email = match[1];
    if (email) {
      mentions.push({
        id: email,
        email: email,
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
 * Patterns that might indicate commitments in Google Docs content.
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
  /please (?:do|send|complete|review|update)/i,
  /can you (?:do|send|complete|review|update)/i,
];

/**
 * Check if Google Docs content likely contains a commitment.
 */
export function mayContainCommitment(content: string): boolean {
  const text = content.toLowerCase();
  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Patterns that might indicate decisions in Google Docs content.
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
  /resolved/i,
  /agreed upon/i,
];

/**
 * Check if Google Docs content likely contains a decision.
 */
export function mayContainDecision(content: string): boolean {
  const text = content.toLowerCase();
  return DECISION_PATTERNS.some((pattern) => pattern.test(text));
}

// Types are exported inline above
