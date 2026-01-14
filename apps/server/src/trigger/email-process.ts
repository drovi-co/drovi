// =============================================================================
// EMAIL PROCESSING TRIGGER.DEV TASKS
// =============================================================================
//
// Downstream processing tasks triggered after email sync.
// These tasks feed into the intelligence pipeline (PRD-03, PRD-06).
//

import { db } from "@memorystack/db";
import { emailMessage, emailThread } from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq, isNull } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface ThreadProcessingPayload {
  /** Thread ID in our database */
  threadId: string;
  /** Account ID */
  accountId: string;
  /** Organization ID */
  organizationId: string;
  /** Whether this is a new thread (vs updated) */
  isNew: boolean;
  /** Force reprocessing */
  force?: boolean;
}

interface BatchProcessingPayload {
  /** Account ID to process threads for */
  accountId: string;
  /** Organization ID */
  organizationId: string;
  /** Maximum threads to process */
  limit?: number;
  /** Force reprocessing even if already processed */
  force?: boolean;
}

interface EmbeddingPayload {
  /** Message ID to generate embedding for */
  messageId: string;
  /** Thread ID */
  threadId: string;
  /** Organization ID */
  organizationId: string;
}

// =============================================================================
// THREAD ANALYSIS TASK
// =============================================================================

/**
 * Queue a thread for AI analysis (PRD-03).
 *
 * This task will eventually:
 * - Classify thread intent
 * - Extract claims (facts, promises, requests, decisions)
 * - Generate thread brief
 * - Detect open loops
 *
 * For now, it's a placeholder that marks threads as queued for processing.
 */
export const processThreadTask = task({
  id: "process-thread",
  queue: {
    name: "thread-processing",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  run: async (payload: ThreadProcessingPayload) => {
    const { threadId, accountId, organizationId, isNew, force } = payload;

    log.info("Processing thread for analysis", {
      threadId,
      accountId,
      organizationId,
      isNew,
    });

    // Get thread with messages
    const thread = await db.query.emailThread.findFirst({
      where: eq(emailThread.id, threadId),
    });

    if (!thread) {
      log.warn("Thread not found for processing", { threadId });
      return { processed: false, reason: "thread_not_found" };
    }

    // Check if already processed (unless forced)
    if (thread.lastAnalyzedAt && !force) {
      log.debug("Thread already processed", { threadId });
      return { processed: false, reason: "already_processed" };
    }

    // Get messages for the thread
    const messages = await db.query.emailMessage.findMany({
      where: eq(emailMessage.threadId, threadId),
      orderBy: (m, { asc }) => [asc(m.sentAt)],
    });

    if (messages.length === 0) {
      log.warn("No messages found for thread", { threadId });
      return { processed: false, reason: "no_messages" };
    }

    // TODO: PRD-03 - Call Thread Understanding Agent here
    // For now, just mark as processed
    //
    // Future implementation:
    // const analysis = await threadUnderstandingAgent.analyze({
    //   thread,
    //   messages,
    //   organizationId,
    // });

    // Mark thread as processed
    await db
      .update(emailThread)
      .set({
        lastAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailThread.id, threadId));

    log.info("Thread processed", {
      threadId,
      messageCount: messages.length,
    });

    // Trigger embedding generation for messages
    for (const message of messages) {
      await generateEmbeddingTask.trigger({
        messageId: message.id,
        threadId,
        organizationId,
      });
    }

    return {
      processed: true,
      threadId,
      messageCount: messages.length,
    };
  },
});

// =============================================================================
// BATCH THREAD PROCESSING TASK
// =============================================================================

/**
 * Process multiple unprocessed threads for an account.
 * Used after backfill to catch up on AI processing.
 */
export const processThreadsBatchTask = task({
  id: "process-threads-batch",
  queue: {
    name: "thread-processing",
    concurrencyLimit: 5,
  },
  maxDuration: 600, // 10 minutes
  run: async (payload: BatchProcessingPayload) => {
    const { accountId, organizationId, limit = 100, force } = payload;

    log.info("Batch processing threads", {
      accountId,
      organizationId,
      limit,
    });

    // Find unprocessed threads
    const whereClause = force
      ? eq(emailThread.accountId, accountId)
      : and(
          eq(emailThread.accountId, accountId),
          isNull(emailThread.lastAnalyzedAt)
        );

    const threads = await db.query.emailThread.findMany({
      where: whereClause,
      orderBy: (t, { desc }) => [desc(t.lastMessageAt)],
      limit,
      columns: { id: true },
    });

    log.info("Found threads for batch processing", {
      accountId,
      count: threads.length,
    });

    let processed = 0;
    let failed = 0;

    for (const thread of threads) {
      try {
        await processThreadTask.trigger({
          threadId: thread.id,
          accountId,
          organizationId,
          isNew: false,
          force,
        });
        processed++;
      } catch (error) {
        failed++;
        log.error("Failed to queue thread for processing", error, {
          threadId: thread.id,
        });
      }
    }

    return {
      total: threads.length,
      processed,
      failed,
    };
  },
});

// =============================================================================
// EMBEDDING GENERATION TASK
// =============================================================================

/**
 * Generate embedding for a message (PRD-06).
 *
 * This task will eventually:
 * - Extract text content from message
 * - Generate embedding using OpenAI
 * - Store embedding in pgvector
 *
 * For now, it's a placeholder.
 */
export const generateEmbeddingTask = task({
  id: "generate-embedding",
  queue: {
    name: "embedding-generation",
    concurrencyLimit: 50, // High concurrency for embedding API
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: EmbeddingPayload) => {
    const { messageId, threadId, organizationId } = payload;

    log.debug("Generating embedding for message", {
      messageId,
      threadId,
      organizationId,
    });

    // Get message content
    const message = await db.query.emailMessage.findFirst({
      where: eq(emailMessage.id, messageId),
      columns: {
        id: true,
        subject: true,
        bodyText: true,
        snippet: true,
      },
    });

    if (!message) {
      log.warn("Message not found for embedding", { messageId });
      return { generated: false, reason: "message_not_found" };
    }

    // TODO: PRD-06 - Generate embedding here
    // Future implementation:
    // const text = `${message.subject}\n\n${message.bodyText || message.snippet}`;
    // const embedding = await openai.embeddings.create({
    //   model: "text-embedding-3-small",
    //   input: text,
    // });
    // await db.insert(messageEmbedding).values({
    //   messageId,
    //   embedding: embedding.data[0].embedding,
    // });

    log.debug("Embedding generation placeholder", { messageId });

    return {
      generated: false,
      reason: "not_implemented",
      messageId,
    };
  },
});

// =============================================================================
// SYNC COMPLETION HANDLER
// =============================================================================

/**
 * Handle sync completion and trigger downstream processing.
 * Called after incremental sync or backfill completes.
 */
export const onSyncCompleteTask = task({
  id: "on-sync-complete",
  queue: {
    name: "sync-events",
    concurrencyLimit: 10,
  },
  run: async (payload: {
    accountId: string;
    organizationId: string;
    type: "incremental" | "backfill";
    newThreadIds: string[];
    updatedThreadIds: string[];
  }) => {
    const { accountId, organizationId, type, newThreadIds, updatedThreadIds } =
      payload;

    log.info("Handling sync completion", {
      accountId,
      type,
      newThreads: newThreadIds.length,
      updatedThreads: updatedThreadIds.length,
    });

    // Queue new threads for processing
    for (const threadId of newThreadIds) {
      await processThreadTask.trigger({
        threadId,
        accountId,
        organizationId,
        isNew: true,
      });
    }

    // Queue updated threads for reprocessing
    for (const threadId of updatedThreadIds) {
      await processThreadTask.trigger({
        threadId,
        accountId,
        organizationId,
        isNew: false,
        force: true, // Reprocess updated threads
      });
    }

    return {
      queued: newThreadIds.length + updatedThreadIds.length,
      newThreads: newThreadIds.length,
      updatedThreads: updatedThreadIds.length,
    };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  ThreadProcessingPayload,
  BatchProcessingPayload,
  EmbeddingPayload,
};
