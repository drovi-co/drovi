// =============================================================================
// EMAIL DEDUPLICATION
// =============================================================================
//
// Handles deduplication of emails during sync to prevent duplicate records.
// Uses provider message IDs as the unique identifier.
//
// Uses ONLY the unified schema (conversation, message).
//

import { db } from "@memorystack/db";
import { conversation, message } from "@memorystack/db/schema";
import { and, eq, inArray } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface DeduplicationResult {
  /** IDs that are new (not in database) */
  newIds: string[];
  /** IDs that already exist in database */
  existingIds: string[];
  /** Map of provider ID to database ID for existing records */
  existingMap: Map<string, string>;
}

// =============================================================================
// CONVERSATION DEDUPLICATION
// =============================================================================

/**
 * Check which conversation IDs already exist in the database.
 * Conversations without actual message records (orphaned) are treated as "new" for reprocessing.
 *
 * @param sourceAccountId - Source account ID
 * @param externalIds - Provider thread IDs to check
 * @returns Deduplication result
 */
export async function deduplicateThreads(
  sourceAccountId: string,
  externalIds: string[]
): Promise<DeduplicationResult> {
  if (externalIds.length === 0) {
    return { newIds: [], existingIds: [], existingMap: new Map() };
  }

  // Batch check for existing conversations
  const existingConversations = await db.query.conversation.findMany({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      inArray(conversation.externalId, externalIds)
    ),
    columns: {
      id: true,
      externalId: true,
    },
  });

  if (existingConversations.length === 0) {
    return {
      newIds: externalIds,
      existingIds: [],
      existingMap: new Map(),
    };
  }

  const existingMap = new Map<string, string>();
  const convIdToExternalMap = new Map<string, string>();

  for (const conv of existingConversations) {
    existingMap.set(conv.externalId, conv.id);
    convIdToExternalMap.set(conv.id, conv.externalId);
  }

  // Get all conversation IDs that have at least one message (batch query)
  const convsWithMessages = await db
    .selectDistinct({ conversationId: message.conversationId })
    .from(message)
    .where(
      inArray(
        message.conversationId,
        existingConversations.map((c) => c.id)
      )
    );

  const convsWithMessagesSet = new Set(
    convsWithMessages.map((c) => c.conversationId)
  );

  // Categorize conversations
  const existingExternalIds = new Set<string>();
  const orphanedExternalIds = new Set<string>();

  for (const conv of existingConversations) {
    if (convsWithMessagesSet.has(conv.id)) {
      existingExternalIds.add(conv.externalId);
    } else {
      // Conversation exists but has no messages - treat as orphaned
      orphanedExternalIds.add(conv.externalId);
    }
  }

  // New = not in database OR orphaned (no actual message records)
  const newIds = externalIds.filter(
    (id) => !existingExternalIds.has(id) || orphanedExternalIds.has(id)
  );
  const existingIds = externalIds.filter(
    (id) => existingExternalIds.has(id) && !orphanedExternalIds.has(id)
  );

  return { newIds, existingIds, existingMap };
}

// =============================================================================
// MESSAGE DEDUPLICATION
// =============================================================================

/**
 * Check which message IDs already exist in the database.
 *
 * @param conversationId - Conversation ID in our database
 * @param externalIds - Provider message IDs to check
 * @returns Deduplication result
 */
export async function deduplicateMessages(
  conversationId: string,
  externalIds: string[]
): Promise<DeduplicationResult> {
  if (externalIds.length === 0) {
    return { newIds: [], existingIds: [], existingMap: new Map() };
  }

  // Batch check for existing messages
  const existingMessages = await db.query.message.findMany({
    where: and(
      eq(message.conversationId, conversationId),
      inArray(message.externalId, externalIds)
    ),
    columns: {
      id: true,
      externalId: true,
    },
  });

  const existingMap = new Map<string, string>();
  const existingExternalIds = new Set<string>();

  for (const msg of existingMessages) {
    existingMap.set(msg.externalId, msg.id);
    existingExternalIds.add(msg.externalId);
  }

  const newIds = externalIds.filter((id) => !existingExternalIds.has(id));
  const existingIds = externalIds.filter((id) => existingExternalIds.has(id));

  return { newIds, existingIds, existingMap };
}

// =============================================================================
// BATCH DEDUPLICATION
// =============================================================================

/**
 * Efficiently deduplicate a large batch of conversation IDs.
 * Processes in chunks to avoid memory issues.
 *
 * @param sourceAccountId - Source account ID
 * @param externalIds - Provider thread IDs to check
 * @param chunkSize - Number of IDs to process at once
 * @returns Combined deduplication result
 */
export async function batchDeduplicateThreads(
  sourceAccountId: string,
  externalIds: string[],
  chunkSize = 100
): Promise<DeduplicationResult> {
  const allNewIds: string[] = [];
  const allExistingIds: string[] = [];
  const existingMap = new Map<string, string>();

  // Process in chunks
  for (let i = 0; i < externalIds.length; i += chunkSize) {
    const chunk = externalIds.slice(i, i + chunkSize);
    const result = await deduplicateThreads(sourceAccountId, chunk);

    allNewIds.push(...result.newIds);
    allExistingIds.push(...result.existingIds);
    for (const [key, value] of result.existingMap) {
      existingMap.set(key, value);
    }
  }

  return {
    newIds: allNewIds,
    existingIds: allExistingIds,
    existingMap,
  };
}

// =============================================================================
// UPSERT HELPERS
// =============================================================================

/**
 * Get or create conversation ID for a provider thread.
 * Used when you need to ensure a conversation exists before processing messages.
 *
 * @param sourceAccountId - Source account ID
 * @param externalId - Provider's thread ID
 * @returns Object with conversation ID and whether it was newly created
 */
export async function getOrCreateConversationId(
  sourceAccountId: string,
  externalId: string
): Promise<{ id: string; isNew: boolean }> {
  // Check if exists
  const existing = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, externalId)
    ),
    columns: { id: true },
  });

  if (existing) {
    return { id: existing.id, isNew: false };
  }

  // Create placeholder (will be updated with full data later)
  const id = crypto.randomUUID();
  await db.insert(conversation).values({
    id,
    sourceAccountId,
    externalId,
    conversationType: "thread",
    title: "",
    snippet: "",
    participantIds: [],
    messageCount: 0,
    isRead: false,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { id, isNew: true };
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Find orphaned conversations (conversations with no messages).
 * Can happen if message processing fails.
 *
 * @param sourceAccountId - Source account ID
 * @returns List of orphaned conversation IDs
 */
export async function findOrphanedConversations(
  sourceAccountId: string
): Promise<string[]> {
  const conversations = await db.query.conversation.findMany({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.messageCount, 0)
    ),
    columns: { id: true },
  });

  return conversations.map((c) => c.id);
}

/**
 * Remove orphaned conversations.
 *
 * @param conversationIds - Conversation IDs to remove
 */
export async function removeOrphanedConversations(
  conversationIds: string[]
): Promise<void> {
  if (conversationIds.length === 0) {
    return;
  }

  await db
    .delete(conversation)
    .where(inArray(conversation.id, conversationIds));
}
