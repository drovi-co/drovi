// =============================================================================
// MESSAGE BACKFILL TRIGGER.DEV TASK
// =============================================================================
//
// Backfills messages for threads that were synced but have 0 messages.
// This can happen due to API errors, rate limiting, or interrupted syncs.
//

import { db } from "@memorystack/db";
import {
  emailAccount,
  emailMessage,
  emailThread,
} from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { safeDecryptToken } from "../lib/crypto/tokens";
import {
  createEmailClient,
  type GmailEmailClient,
  type OutlookEmailClient,
} from "../lib/email-client";
import { log } from "../lib/logger";
import { processMessage } from "../lib/sync/processor";
import type { SyncError } from "../lib/sync/types";

// =============================================================================
// TYPES
// =============================================================================

interface MessageBackfillPayload {
  /** Account ID to backfill messages for */
  accountId: string;
  /** Optional: specific thread IDs to backfill (if not provided, finds all orphaned threads) */
  threadIds?: string[];
  /** Max threads to process in one run (default: 100) */
  limit?: number;
  /** Concurrency for parallel fetching (default: 3) */
  concurrency?: number;
}

interface MessageBackfillResult {
  success: boolean;
  accountId: string;
  threadsProcessed: number;
  messagesBackfilled: number;
  threadsFailed: number;
  errors: SyncError[];
  duration: number;
}

// =============================================================================
// FIND ORPHANED THREADS
// =============================================================================

/**
 * Find threads that have messageCount > 0 but no actual message records.
 * These are "orphaned" threads that need message backfill.
 */
async function findOrphanedThreadsWithExpectedMessages(
  accountId: string,
  limit: number
): Promise<
  Array<{ id: string; providerThreadId: string; messageCount: number }>
> {
  // First, get ALL thread IDs that have at least one message
  const threadIdsWithMessages = await db
    .selectDistinct({ threadId: emailMessage.threadId })
    .from(emailMessage)
    .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
    .where(eq(emailThread.accountId, accountId));

  const threadsWithMessagesSet = new Set(
    threadIdsWithMessages.map((t) => t.threadId)
  );

  // Get threads with messageCount > 0, excluding those that already have messages
  const allThreads = await db.query.emailThread.findMany({
    where: and(
      eq(emailThread.accountId, accountId),
      gt(emailThread.messageCount, 0)
    ),
    columns: {
      id: true,
      providerThreadId: true,
      messageCount: true,
    },
  });

  // Filter to orphaned threads (have expected messages but none in DB)
  const orphanedThreads = allThreads.filter(
    (t) => !threadsWithMessagesSet.has(t.id)
  );

  log.info("Found orphaned threads", {
    accountId,
    totalThreads: allThreads.length,
    threadsWithMessages: threadsWithMessagesSet.size,
    orphanedCount: orphanedThreads.length,
    requestedLimit: limit,
  });

  return orphanedThreads.slice(0, limit);
}

/**
 * Get total count of orphaned threads for an account.
 */
async function countOrphanedThreads(accountId: string): Promise<number> {
  // Get ALL thread IDs that have at least one message
  const threadIdsWithMessages = await db
    .selectDistinct({ threadId: emailMessage.threadId })
    .from(emailMessage)
    .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
    .where(eq(emailThread.accountId, accountId));

  const threadsWithMessagesSet = new Set(
    threadIdsWithMessages.map((t) => t.threadId)
  );

  // Count threads with messageCount > 0
  const allThreads = await db.query.emailThread.findMany({
    where: and(
      eq(emailThread.accountId, accountId),
      gt(emailThread.messageCount, 0)
    ),
    columns: { id: true },
  });

  // Count orphaned (have messageCount > 0 but no actual messages)
  return allThreads.filter((t) => !threadsWithMessagesSet.has(t.id)).length;
}

// =============================================================================
// MESSAGE BACKFILL TASK
// =============================================================================

/**
 * Backfill messages for threads that have 0 messages but should have some.
 *
 * This task:
 * 1. Finds threads with messageCount > 0 but no actual message records
 * 2. Fetches full thread data from Gmail/Outlook
 * 3. Processes and stores the messages
 *
 * Run manually when you notice threads without messages:
 * ```
 * await messageBackfillTask.trigger({ accountId: "..." });
 * ```
 */
export const messageBackfillTask = task({
  id: "message-backfill",
  queue: {
    name: "email-backfill-priority",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max
  run: async (
    payload: MessageBackfillPayload
  ): Promise<MessageBackfillResult> => {
    const startTime = Date.now();
    const {
      accountId,
      threadIds: specificThreadIds,
      limit = 100,
      concurrency = 3,
    } = payload;

    const result: MessageBackfillResult = {
      success: false,
      accountId,
      threadsProcessed: 0,
      messagesBackfilled: 0,
      threadsFailed: 0,
      errors: [],
      duration: 0,
    };

    log.info("Message backfill starting", {
      accountId,
      specificThreadIds: specificThreadIds?.length,
      limit,
      concurrency,
    });

    try {
      // Get account
      const account = await db.query.emailAccount.findFirst({
        where: eq(emailAccount.id, accountId),
      });

      if (!account) {
        throw new Error(`Account not found: ${accountId}`);
      }

      // Create email client
      const client = createEmailClient({
        account,
        skipCache: true,
        decryptToken: safeDecryptToken,
      });

      // Refresh token if needed
      if (client.needsRefresh()) {
        await client.refreshToken();
        const newTokenInfo = client.getTokenInfo();
        await db
          .update(emailAccount)
          .set({
            accessToken: newTokenInfo.accessToken,
            refreshToken: newTokenInfo.refreshToken,
            tokenExpiresAt: newTokenInfo.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(emailAccount.id, accountId));
      }

      // Get threads to process
      let threadsToProcess: Array<{
        id: string;
        providerThreadId: string;
        messageCount: number;
      }>;

      if (specificThreadIds && specificThreadIds.length > 0) {
        // Use specific thread IDs
        threadsToProcess = await db.query.emailThread.findMany({
          where: and(
            eq(emailThread.accountId, accountId),
            inArray(emailThread.id, specificThreadIds)
          ),
          columns: {
            id: true,
            providerThreadId: true,
            messageCount: true,
          },
        });
      } else {
        // Find orphaned threads
        threadsToProcess = await findOrphanedThreadsWithExpectedMessages(
          accountId,
          limit
        );
      }

      log.info("Found threads to backfill", {
        accountId,
        count: threadsToProcess.length,
      });

      if (threadsToProcess.length === 0) {
        result.success = true;
        result.duration = Date.now() - startTime;
        return result;
      }

      // Process threads in concurrent batches
      for (let i = 0; i < threadsToProcess.length; i += concurrency) {
        const batch = threadsToProcess.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
          batch.map(async (thread) => {
            return await backfillThreadMessages(
              client as GmailEmailClient | OutlookEmailClient,
              thread.id,
              thread.providerThreadId,
              account.provider
            );
          })
        );

        // Process results
        for (const batchResult of batchResults) {
          if (batchResult.status === "fulfilled") {
            result.threadsProcessed++;
            result.messagesBackfilled += batchResult.value.messagesAdded;
            if (!batchResult.value.success) {
              result.threadsFailed++;
              if (batchResult.value.error) {
                result.errors.push({
                  code: "THREAD_BACKFILL_ERROR",
                  message: batchResult.value.error,
                  threadId: batchResult.value.threadId,
                  retryable: true,
                });
              }
            }
          } else {
            result.threadsFailed++;
            result.errors.push({
              code: "THREAD_BACKFILL_FAILED",
              message:
                batchResult.reason instanceof Error
                  ? batchResult.reason.message
                  : "Unknown error",
              retryable: true,
            });
          }
        }

        log.debug("Message backfill batch complete", {
          accountId,
          processed: result.threadsProcessed,
          total: threadsToProcess.length,
          messagesBackfilled: result.messagesBackfilled,
        });

        // Small delay between batches
        if (i + concurrency < threadsToProcess.length) {
          await sleep(100);
        }
      }

      result.success = result.threadsFailed === 0;
      result.duration = Date.now() - startTime;

      log.info("Message backfill completed", {
        ...result,
        accountId,
      });

      return result;
    } catch (error) {
      result.errors.push({
        code: "BACKFILL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        retryable: true,
      });
      result.duration = Date.now() - startTime;

      log.error("Message backfill failed", error, { accountId });

      return result;
    }
  },
});

/**
 * Backfill messages for a single thread.
 */
async function backfillThreadMessages(
  client: GmailEmailClient | OutlookEmailClient,
  threadId: string,
  providerThreadId: string,
  provider: string
): Promise<{
  success: boolean;
  threadId: string;
  messagesAdded: number;
  error?: string;
}> {
  try {
    // Fetch full thread from provider
    const fullThread = await client.getThread(providerThreadId);

    if (!fullThread) {
      return {
        success: false,
        threadId,
        messagesAdded: 0,
        error: `Thread not found in ${provider}: ${providerThreadId}`,
      };
    }

    if (fullThread.messages.length === 0) {
      log.warn("Thread has no messages from provider", {
        threadId,
        providerThreadId,
        provider,
      });
      return {
        success: true,
        threadId,
        messagesAdded: 0,
      };
    }

    // Process each message
    let messagesAdded = 0;
    for (let idx = 0; idx < fullThread.messages.length; idx++) {
      const message = fullThread.messages[idx];
      if (!message) continue;

      try {
        // Add messageIndex for ordering
        const messageWithIndex = {
          ...message,
          messageIndex: idx,
        };

        await processMessage(threadId, messageWithIndex, {
          skipExisting: true,
          forceUpdate: false,
        });
        messagesAdded++;
      } catch (msgError) {
        log.error("Failed to process message", msgError, {
          threadId,
          providerMessageId: message.providerMessageId,
        });
      }
    }

    // Update thread with actual message count if needed
    await db
      .update(emailThread)
      .set({
        messageCount: fullThread.messages.length,
        updatedAt: new Date(),
      })
      .where(eq(emailThread.id, threadId));

    return {
      success: true,
      threadId,
      messagesAdded,
    };
  } catch (error) {
    return {
      success: false,
      threadId,
      messagesAdded: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// BATCH MESSAGE BACKFILL TASK
// =============================================================================

/**
 * Batch backfill all orphaned threads for an account.
 * Runs multiple batches until all threads are processed.
 */
export const batchMessageBackfillTask = task({
  id: "message-backfill-batch",
  queue: {
    name: "email-backfill-extended",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 1800, // 30 minutes max
  run: async (payload: {
    accountId: string;
    batchSize?: number;
  }): Promise<{
    success: boolean;
    accountId: string;
    totalOrphaned: number;
    totalProcessed: number;
    totalMessages: number;
    batches: number;
  }> => {
    const { accountId, batchSize = 100 } = payload;

    log.info("Batch message backfill starting", { accountId, batchSize });

    let totalProcessed = 0;
    let totalMessages = 0;
    let batches = 0;

    // Count total orphaned threads
    const totalOrphaned = await countOrphanedThreads(accountId);

    if (totalOrphaned === 0) {
      log.info("No orphaned threads found", { accountId });
      return {
        success: true,
        accountId,
        totalOrphaned: 0,
        totalProcessed: 0,
        totalMessages: 0,
        batches: 0,
      };
    }

    log.info("Found orphaned threads", {
      accountId,
      totalOrphaned,
    });

    // Process in batches
    let hasMore = true;
    while (hasMore) {
      const result = await messageBackfillTask.triggerAndWait({
        accountId,
        limit: batchSize,
        concurrency: 5,
      });

      if (!result.ok) {
        log.error("Batch failed", {
          accountId,
          batch: batches,
          error: result.error,
        });
        break;
      }

      totalProcessed += result.output.threadsProcessed;
      totalMessages += result.output.messagesBackfilled;
      batches++;

      log.info("Batch complete", {
        accountId,
        batch: batches,
        processed: result.output.threadsProcessed,
        messages: result.output.messagesBackfilled,
        totalProcessed,
      });

      // Check if there are more orphaned threads
      const remaining = await countOrphanedThreads(accountId);
      hasMore = remaining > 0 && result.output.threadsProcessed > 0;

      if (hasMore) {
        // Small delay between batches
        await sleep(1000);
      }
    }

    log.info("Batch message backfill completed", {
      accountId,
      totalOrphaned,
      totalProcessed,
      totalMessages,
      batches,
    });

    return {
      success: true,
      accountId,
      totalOrphaned,
      totalProcessed,
      totalMessages,
      batches,
    };
  },
});

// =============================================================================
// DIAGNOSTIC TASK
// =============================================================================

/**
 * Diagnostic task to check message sync status for an account.
 */
export const checkMessageSyncStatusTask = task({
  id: "check-message-sync-status",
  queue: {
    name: "email-sync",
    concurrencyLimit: 10,
  },
  run: async (payload: {
    accountId: string;
  }): Promise<{
    accountId: string;
    totalThreads: number;
    threadsWithMessages: number;
    orphanedThreads: number;
    totalMessages: number;
    avgMessagesPerThread: number;
  }> => {
    const { accountId } = payload;

    // Count total threads
    const threads = await db.query.emailThread.findMany({
      where: eq(emailThread.accountId, accountId),
      columns: { id: true, messageCount: true },
    });

    // Count threads with actual messages
    const threadIdsWithMessages = await db
      .selectDistinct({ threadId: emailMessage.threadId })
      .from(emailMessage)
      .where(
        inArray(
          emailMessage.threadId,
          threads.map((t) => t.id)
        )
      );

    // Count total messages
    const messageCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(emailMessage)
      .innerJoin(emailThread, eq(emailMessage.threadId, emailThread.id))
      .where(eq(emailThread.accountId, accountId));
    const totalMessages = messageCountResult[0]?.count ?? 0;

    const threadsWithMessages = threadIdsWithMessages.length;
    const orphanedThreads = threads.length - threadsWithMessages;
    const avgMessagesPerThread =
      threadsWithMessages > 0
        ? Math.round((Number(totalMessages) / threadsWithMessages) * 10) / 10
        : 0;

    const result = {
      accountId,
      totalThreads: threads.length,
      threadsWithMessages,
      orphanedThreads,
      totalMessages: Number(totalMessages),
      avgMessagesPerThread,
    };

    log.info("Message sync status", result);

    return result;
  },
});

// =============================================================================
// HELPERS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { MessageBackfillPayload, MessageBackfillResult };
