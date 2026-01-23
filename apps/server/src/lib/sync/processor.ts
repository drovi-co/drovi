// =============================================================================
// EMAIL PROCESSING PIPELINE
// =============================================================================
//
// Transforms raw email data from providers into the unified schema.
// Handles conversation reconstruction, message normalization, and
// attachment metadata processing.
//
// Uses ONLY the unified schema (conversation, message, attachment).
// Legacy email_* tables have been removed.
//

import { db } from "@memorystack/db";
import {
  attachment,
  conversation,
  type ConversationMetadata,
  message,
  type MessageMetadata,
  type MessageRecipient,
  sourceAccount,
} from "@memorystack/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type {
  AttachmentMetadata,
  EmailMessageData,
  EmailThreadData,
  EmailThreadWithMessages,
} from "../email-client/types";
import { log } from "../logger";
import type { BatchResult, ProcessedThread, SyncError } from "./types";

// =============================================================================
// THREAD PROCESSING
// =============================================================================

/**
 * Process a thread and its messages into the unified schema.
 *
 * @param sourceAccountId - Source account ID (unified schema)
 * @param threadData - Thread with messages from provider
 * @param options - Processing options
 * @returns Processed thread result
 */
export async function processThread(
  sourceAccountId: string,
  threadData: EmailThreadWithMessages,
  options: { skipExisting?: boolean; forceUpdate?: boolean } = {}
): Promise<ProcessedThread> {
  const { skipExisting = true, forceUpdate = false } = options;

  // Validate that we have messages to process
  const hasMessagesInPayload =
    threadData.messages && threadData.messages.length > 0;

  if (!hasMessagesInPayload && threadData.messageCount > 0) {
    log.warn(
      "Thread has messageCount but no messages in payload - skipping to avoid orphaned conversation",
      {
        providerThreadId: threadData.providerThreadId,
        expectedMessageCount: threadData.messageCount,
        actualMessageCount: threadData.messages?.length ?? 0,
      }
    );
    // Return early - don't create orphaned conversation
    return {
      thread: threadData,
      messages: [],
      isNew: false,
      wasUpdated: false,
      conversationId: "", // Empty - no conversation created
    };
  }

  // Check if conversation exists
  const existingConversation = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, threadData.providerThreadId)
    ),
  });

  const isNew = !existingConversation;

  // Check if conversation has messages (to handle orphaned conversations from crashed syncs)
  let hasMessagesInDb = false;
  if (existingConversation) {
    const msgCount = await db.query.message.findFirst({
      where: eq(message.conversationId, existingConversation.id),
      columns: { id: true },
    });
    hasMessagesInDb = !!msgCount;
  }

  // Skip only if conversation exists WITH messages and not forcing update
  if (existingConversation && hasMessagesInDb && skipExisting && !forceUpdate) {
    return {
      thread: threadData,
      messages: threadData.messages,
      isNew: false,
      wasUpdated: false,
      conversationId: existingConversation.id,
    };
  }

  // Upsert conversation
  const conversationId = existingConversation?.id ?? crypto.randomUUID();

  // Use actual message count from payload, not metadata
  const actualMessageCount = threadData.messages?.length ?? 0;

  await upsertConversation(
    sourceAccountId,
    conversationId,
    threadData,
    actualMessageCount,
    isNew
  );

  // Process messages with index for ordering
  let processedCount = 0;
  for (let idx = 0; idx < (threadData.messages?.length ?? 0); idx++) {
    const msg = threadData.messages[idx];
    if (!msg) continue;

    try {
      // Add message index for ordering within conversation
      const messageWithIndex = {
        ...msg,
        messageIndex: idx,
      };
      await processMessage(conversationId, messageWithIndex, {
        skipExisting,
        forceUpdate,
      });
      processedCount++;
    } catch (error) {
      log.error("Failed to process message", error, {
        conversationId,
        providerMessageId: msg.providerMessageId,
        messageIndex: idx,
      });
    }
  }

  // Log if we didn't process all expected messages
  if (processedCount < actualMessageCount) {
    log.warn("Not all messages were processed", {
      conversationId,
      providerThreadId: threadData.providerThreadId,
      expected: actualMessageCount,
      processed: processedCount,
    });
  }

  return {
    thread: threadData,
    messages: threadData.messages,
    isNew,
    wasUpdated: !isNew,
    conversationId,
  };
}

// =============================================================================
// CONVERSATION HELPERS
// =============================================================================

/**
 * Upsert a conversation to the unified schema.
 */
async function upsertConversation(
  sourceAccountId: string,
  conversationId: string,
  thread: EmailThreadData,
  messageCount: number,
  isNew: boolean
): Promise<void> {
  const metadata: ConversationMetadata = {
    labels: thread.labels,
  };

  const record = {
    id: conversationId,
    sourceAccountId,
    externalId: thread.providerThreadId,
    conversationType: "thread" as const,
    title: thread.subject ?? null,
    snippet: thread.snippet ?? null,
    participantIds: thread.participants.map((p) => p.email),
    messageCount,
    firstMessageAt: thread.firstMessageAt,
    lastMessageAt: thread.lastMessageAt,
    isRead: thread.isRead,
    isStarred: thread.isStarred,
    isArchived: thread.isArchived,
    isTrashed: thread.isTrashed,
    metadata,
    updatedAt: new Date(),
  };

  if (!isNew) {
    await db
      .update(conversation)
      .set(record)
      .where(eq(conversation.id, conversationId));
  } else {
    await db.insert(conversation).values({
      ...record,
      createdAt: new Date(),
    });
  }
}

// =============================================================================
// MESSAGE PROCESSING
// =============================================================================

/**
 * Process a single message into the unified schema.
 *
 * @param conversationId - Conversation ID in our database
 * @param msg - Message data from provider
 * @param options - Processing options
 * @returns Message ID
 */
export async function processMessage(
  conversationId: string,
  msg: EmailMessageData & { messageIndex?: number },
  options: { skipExisting?: boolean; forceUpdate?: boolean } = {}
): Promise<string> {
  const { skipExisting = true, forceUpdate = false } = options;

  // Check if message exists
  const existingMessage = await db.query.message.findFirst({
    where: and(
      eq(message.conversationId, conversationId),
      eq(message.externalId, msg.providerMessageId)
    ),
  });

  // Skip if exists and not forcing update
  if (existingMessage && skipExisting && !forceUpdate) {
    return existingMessage.id;
  }

  const messageId = existingMessage?.id ?? crypto.randomUUID();

  await upsertMessage(conversationId, messageId, msg, !existingMessage);

  // Process attachments for new messages
  if (!existingMessage && msg.attachments?.length) {
    await processAttachments(messageId, msg.attachments);
  }

  return messageId;
}

/**
 * Upsert a message to the unified schema.
 */
async function upsertMessage(
  conversationId: string,
  messageId: string,
  msg: EmailMessageData & { messageIndex?: number },
  isNew: boolean
): Promise<void> {
  const recipients: MessageRecipient[] = [
    ...msg.to.map((r) => ({
      id: r.email,
      email: r.email,
      name: r.name,
      type: "to" as const,
    })),
    ...msg.cc.map((r) => ({
      id: r.email,
      email: r.email,
      name: r.name,
      type: "cc" as const,
    })),
    ...msg.bcc.map((r) => ({
      id: r.email,
      email: r.email,
      name: r.name,
      type: "bcc" as const,
    })),
  ];

  const metadata: MessageMetadata = {
    headers: msg.headers,
    labelIds: msg.labels,
    sizeBytes: msg.sizeBytes,
  };

  const record = {
    id: messageId,
    conversationId,
    externalId: msg.providerMessageId,
    senderExternalId: msg.from.email,
    senderName: msg.from.name ?? null,
    senderEmail: msg.from.email,
    recipients,
    subject: msg.subject ?? null,
    bodyText: msg.bodyText ?? null,
    bodyHtml: msg.bodyHtml ?? null,
    snippet: msg.snippet ?? null,
    sentAt: msg.sentAt,
    receivedAt: msg.receivedAt,
    messageIndex: msg.messageIndex ?? 0,
    isFromUser: msg.isFromUser,
    hasAttachments: (msg.attachments?.length ?? 0) > 0,
    metadata,
    updatedAt: new Date(),
  };

  if (!isNew) {
    await db.update(message).set(record).where(eq(message.id, messageId));
  } else {
    await db.insert(message).values({
      ...record,
      createdAt: new Date(),
    });
  }
}

// =============================================================================
// ATTACHMENT PROCESSING
// =============================================================================

/**
 * Store attachment metadata.
 *
 * @param messageId - Message ID in our database
 * @param attachments - Attachment metadata from provider
 */
export async function processAttachments(
  messageId: string,
  attachments: AttachmentMetadata[]
): Promise<void> {
  if (attachments.length === 0) {
    return;
  }

  for (const att of attachments) {
    const attachmentId = crypto.randomUUID();

    // Check if attachment already exists
    const existing = await db.query.attachment.findFirst({
      where: and(
        eq(attachment.messageId, messageId),
        eq(attachment.externalId, att.id ?? "")
      ),
    });

    if (!existing) {
      await db.insert(attachment).values({
        id: attachmentId,
        messageId,
        externalId: att.id ?? null,
        filename: att.filename,
        mimeType: att.mimeType ?? null,
        sizeBytes: att.size ?? null,
        contentId: att.contentId ?? null,
        isInline: att.isInline ?? false,
        createdAt: new Date(),
      });
    }
  }
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process a batch of threads.
 *
 * @param sourceAccountId - Source account ID (unified schema)
 * @param threads - Threads to process
 * @param options - Processing options
 * @returns Batch result summary
 */
export async function processBatch(
  sourceAccountId: string,
  threads: EmailThreadWithMessages[],
  options: {
    skipExisting?: boolean;
    forceUpdate?: boolean;
    batchSize?: number;
  } = {}
): Promise<BatchResult> {
  const { batchSize = 50 } = options;
  const result: BatchResult = {
    processed: 0,
    skipped: 0,
    errors: [],
    threads: [],
  };

  // Process in smaller batches for memory efficiency
  for (let i = 0; i < threads.length; i += batchSize) {
    const batch = threads.slice(i, i + batchSize);

    for (const threadData of batch) {
      try {
        const processed = await processThread(
          sourceAccountId,
          threadData,
          options
        );
        result.threads.push(processed);

        if (processed.isNew || processed.wasUpdated) {
          result.processed++;
        } else {
          result.skipped++;
        }
      } catch (error) {
        const syncError: SyncError = {
          code: "PROCESSING_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
          threadId: threadData.id,
          retryable: true,
        };
        result.errors.push(syncError);

        log.error("Error processing thread", error, {
          threadId: threadData.id,
          sourceAccountId,
        });
      }
    }
  }

  return result;
}

// =============================================================================
// CONVERSATION METADATA UPDATES
// =============================================================================

/**
 * Update conversation metadata without reprocessing messages.
 * Used for label changes, read status, etc.
 *
 * @param sourceAccountId - Source account ID
 * @param externalId - Provider's thread ID
 * @param updates - Fields to update
 */
export async function updateConversationMetadata(
  sourceAccountId: string,
  externalId: string,
  updates: Partial<{
    isRead: boolean;
    isStarred: boolean;
    isArchived: boolean;
    isTrashed: boolean;
    metadata: ConversationMetadata;
  }>
): Promise<void> {
  await db
    .update(conversation)
    .set({ ...updates, updatedAt: new Date() })
    .where(
      and(
        eq(conversation.sourceAccountId, sourceAccountId),
        eq(conversation.externalId, externalId)
      )
    );
}

/**
 * Mark a conversation as deleted (soft delete).
 *
 * @param sourceAccountId - Source account ID
 * @param externalId - Provider's thread ID
 */
export async function markThreadDeleted(
  sourceAccountId: string,
  externalId: string
): Promise<void> {
  await db
    .update(conversation)
    .set({ isTrashed: true, updatedAt: new Date() })
    .where(
      and(
        eq(conversation.sourceAccountId, sourceAccountId),
        eq(conversation.externalId, externalId)
      )
    );
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get conversation ID from provider thread ID.
 */
export async function getConversationId(
  sourceAccountId: string,
  externalId: string
): Promise<string | null> {
  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, externalId)
    ),
    columns: { id: true },
  });
  return conv?.id ?? null;
}

/**
 * Check if a message exists by provider ID.
 */
export async function messageExists(
  conversationId: string,
  externalId: string
): Promise<boolean> {
  const msg = await db.query.message.findFirst({
    where: and(
      eq(message.conversationId, conversationId),
      eq(message.externalId, externalId)
    ),
    columns: { id: true },
  });
  return !!msg;
}

/**
 * Get sync statistics for a source account.
 */
export async function getSyncStats(sourceAccountId: string): Promise<{
  conversationCount: number;
  messageCount: number;
  lastSyncAt: Date | null;
}> {
  // Count conversations
  const [convCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversation)
    .where(eq(conversation.sourceAccountId, sourceAccountId));

  // Get the most recent message's receivedAt as lastSyncAt
  const latestConv = await db.query.conversation.findFirst({
    where: eq(conversation.sourceAccountId, sourceAccountId),
    orderBy: (c, { desc }) => [desc(c.lastMessageAt)],
    columns: { lastMessageAt: true },
  });

  // Count messages across all conversations for this account
  const conversations = await db.query.conversation.findMany({
    where: eq(conversation.sourceAccountId, sourceAccountId),
    columns: { messageCount: true },
  });
  const msgCount = conversations.reduce((sum, c) => sum + c.messageCount, 0);

  return {
    conversationCount: convCountResult?.count ?? 0,
    messageCount: msgCount,
    lastSyncAt: latestConv?.lastMessageAt ?? null,
  };
}

/**
 * Get or create a source account ID for email processing.
 * This bridges the legacy emailAccount to the unified sourceAccount.
 */
export async function getOrCreateSourceAccount(
  organizationId: string,
  email: string,
  provider: string,
  addedByUserId: string
): Promise<string> {
  // Check if source account already exists
  const existing = await db.query.sourceAccount.findFirst({
    where: and(
      eq(sourceAccount.organizationId, organizationId),
      eq(sourceAccount.type, "email"),
      eq(sourceAccount.externalId, email)
    ),
  });

  if (existing) {
    return existing.id;
  }

  // Create new source account
  const [newAccount] = await db
    .insert(sourceAccount)
    .values({
      organizationId,
      addedByUserId,
      type: "email",
      provider,
      externalId: email,
      displayName: email,
      status: "connected",
      settings: {
        syncEnabled: true,
        syncFrequencyMinutes: 5,
      },
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return newAccount!.id;
}
