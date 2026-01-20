// =============================================================================
// OUTLOOK-SPECIFIC SYNC LOGIC
// =============================================================================
//
// Implements Outlook's sync strategy using the Delta API for incremental sync
// and parallel fetching for high-speed backfill.
//

import type { OutlookEmailClient } from "../email-client/outlook";
import type { EmailThreadWithMessages } from "../email-client/types";
import { log } from "../logger";
import { batchDeduplicateThreads } from "./deduplication";
import {
  collectThreadIds,
  estimateTimeRemaining,
  fetchThreadsParallel,
} from "./parallel-fetch";
import { markThreadDeleted, processBatch } from "./processor";
import type {
  BackfillConfig,
  BatchResult,
  PhaseBackfillResult,
  ProviderSyncOptions,
  SyncError,
  SyncResult,
} from "./types";

// =============================================================================
// INCREMENTAL SYNC
// =============================================================================

/**
 * Perform incremental sync for an Outlook account.
 * Uses the Delta API to fetch changes since the last sync cursor.
 *
 * @param client - Outlook client instance
 * @param accountId - Email account ID in our database
 * @param options - Sync options including cursor
 * @returns Sync result with statistics
 */
export async function syncOutlookIncremental(
  client: OutlookEmailClient,
  accountId: string,
  options: ProviderSyncOptions
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    success: false,
    jobId: crypto.randomUUID(),
    accountId,
    type: "incremental",
    threadsProcessed: 0,
    messagesProcessed: 0,
    newThreads: 0,
    updatedThreads: 0,
    newMessages: 0,
    updatedMessages: 0,
    errors: [],
    duration: 0,
  };

  try {
    // Get changes since last sync
    const delta = await client.getChanges(options.cursor);

    log.info("Outlook incremental sync: changes detected", {
      accountId,
      changedThreads: delta.changedThreadIds.length,
      deletedThreads: delta.deletedThreadIds.length,
      fullSyncRequired: delta.fullSyncRequired,
    });

    // If full sync is required (delta link expired), we need to do a backfill
    if (delta.fullSyncRequired) {
      result.errors.push({
        code: "FULL_SYNC_REQUIRED",
        message: "Delta link expired, full sync required",
        retryable: false,
      });
      result.success = false;
      result.duration = Date.now() - startTime;
      return result;
    }

    // Handle deleted threads (conversations)
    for (const threadId of delta.deletedThreadIds) {
      try {
        await markThreadDeleted(accountId, threadId);
      } catch (error) {
        result.errors.push({
          code: "DELETE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
          threadId,
          retryable: true,
        });
      }
    }

    // Fetch and process changed threads
    if (delta.changedThreadIds.length > 0) {
      const batchResult = await fetchAndProcessConversations(
        client,
        accountId,
        delta.changedThreadIds,
        { forceUpdate: true }
      );

      result.threadsProcessed = batchResult.processed;
      result.newThreads = batchResult.threads.filter((t) => t.isNew).length;
      result.updatedThreads = batchResult.threads.filter(
        (t) => t.wasUpdated
      ).length;
      result.messagesProcessed = batchResult.threads.reduce(
        (sum, t) => sum + t.messages.length,
        0
      );
      result.errors.push(...batchResult.errors);
    }

    // Update cursor
    result.newCursor = delta.newCursor;
    result.success = result.errors.length === 0;
    result.duration = Date.now() - startTime;

    log.info("Outlook incremental sync completed", {
      ...result,
      accountId,
    });

    return result;
  } catch (error) {
    result.errors.push({
      code: "SYNC_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: true,
    });
    result.duration = Date.now() - startTime;
    log.error("Outlook incremental sync failed", error, { accountId });
    return result;
  }
}

// =============================================================================
// PHASE-BASED BACKFILL
// =============================================================================

/**
 * Perform phase-based backfill for an Outlook account.
 * Uses parallel fetching for high-speed import.
 *
 * @param client - Outlook client instance
 * @param config - Backfill configuration with phase and date range
 * @param onProgress - Progress callback (processed, total, estimatedTimeRemaining)
 * @returns Phase backfill result with statistics
 */
export async function backfillOutlookPhase(
  client: OutlookEmailClient,
  config: BackfillConfig,
  onProgress?: (
    processed: number,
    total: number,
    estimatedSeconds?: number
  ) => void
): Promise<PhaseBackfillResult> {
  const startTime = Date.now();
  const result: PhaseBackfillResult = {
    success: false,
    jobId: crypto.randomUUID(),
    accountId: config.accountId,
    type: "backfill",
    phase: config.phase,
    phaseComplete: false,
    threadsProcessed: 0,
    messagesProcessed: 0,
    newThreads: 0,
    updatedThreads: 0,
    newMessages: 0,
    updatedMessages: 0,
    errors: [],
    duration: 0,
  };

  try {
    // Step 1: Collect conversation IDs for the date range
    log.info("Outlook phase backfill: collecting conversation IDs", {
      accountId: config.accountId,
      phase: config.phase,
      afterDate: config.afterDate?.toISOString(),
      beforeDate: config.beforeDate?.toISOString(),
    });

    const allThreadIds = await collectThreadIds(
      client,
      config.afterDate,
      config.beforeDate,
      (collected) => {
        log.debug("Outlook phase backfill: collecting", { collected });
      }
    );

    log.info("Outlook phase backfill: conversation IDs collected", {
      accountId: config.accountId,
      phase: config.phase,
      totalConversations: allThreadIds.length,
    });

    // If no threads found, phase is complete
    if (allThreadIds.length === 0) {
      result.success = true;
      result.phaseComplete = true;
      result.duration = Date.now() - startTime;
      return result;
    }

    // Step 2: Deduplicate against existing threads
    const dedupeResult = await batchDeduplicateThreads(
      config.accountId,
      allThreadIds
    );

    const newThreadIds = dedupeResult.newIds;

    log.info("Outlook phase backfill: deduplication complete", {
      accountId: config.accountId,
      phase: config.phase,
      newConversations: newThreadIds.length,
      existingConversations: dedupeResult.existingIds.length,
    });

    // If all threads already exist, phase is complete
    if (newThreadIds.length === 0) {
      result.success = true;
      result.phaseComplete = true;
      result.duration = Date.now() - startTime;
      return result;
    }

    result.threadsRemaining = newThreadIds.length;

    // Step 3: Fetch conversations in parallel batches
    let processedCount = 0;

    for (let i = 0; i < newThreadIds.length; i += config.batchSize) {
      const batch = newThreadIds.slice(i, i + config.batchSize);
      const batchStartTime = Date.now();

      // Fetch batch in parallel
      const fetchResult = await fetchThreadsParallel(client, batch, {
        concurrency: config.threadFetchConcurrency,
        batchDelayMs: 25, // Minimal delay for speed
        onProgress: (fetched) => {
          const currentProcessed = processedCount + fetched;
          const elapsed = Date.now() - startTime;
          const estimated = estimateTimeRemaining(
            currentProcessed,
            newThreadIds.length,
            elapsed
          );
          onProgress?.(currentProcessed, newThreadIds.length, estimated);
        },
      });

      // Process fetched conversations into database
      if (fetchResult.threads.length > 0) {
        const batchResult = await processBatch(
          config.accountId,
          fetchResult.threads,
          { skipExisting: true }
        );

        result.threadsProcessed += batchResult.processed;
        result.newThreads += batchResult.threads.filter((t) => t.isNew).length;
        result.messagesProcessed += batchResult.threads.reduce(
          (sum, t) => sum + t.messages.length,
          0
        );
        result.errors.push(...batchResult.errors);
      }

      result.errors.push(...fetchResult.errors);
      processedCount += batch.length;

      // Update progress
      const elapsed = Date.now() - startTime;
      const estimated = estimateTimeRemaining(
        processedCount,
        newThreadIds.length,
        elapsed
      );
      onProgress?.(processedCount, newThreadIds.length, estimated);

      log.debug("Outlook phase backfill: batch complete", {
        accountId: config.accountId,
        phase: config.phase,
        batchSize: batch.length,
        batchDuration: Date.now() - batchStartTime,
        processed: processedCount,
        total: newThreadIds.length,
      });
    }

    // Phase complete
    result.phaseComplete = true;
    result.threadsRemaining = 0;
    result.success = result.errors.length === 0;
    result.duration = Date.now() - startTime;

    log.info("Outlook phase backfill completed", {
      ...result,
      accountId: config.accountId,
      phase: config.phase,
      throughput: `${Math.round((result.threadsProcessed / result.duration) * 1000)} threads/sec`,
    });

    return result;
  } catch (error) {
    result.errors.push({
      code: "BACKFILL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: true,
    });
    result.duration = Date.now() - startTime;
    log.error("Outlook phase backfill failed", error, {
      accountId: config.accountId,
      phase: config.phase,
    });
    return result;
  }
}

/**
 * Legacy backfill function for backwards compatibility.
 * @deprecated Use backfillOutlookPhase instead
 */
export async function backfillOutlook(
  client: OutlookEmailClient,
  config: BackfillConfig,
  onProgress?: (progress: number, total: number) => void
): Promise<SyncResult> {
  return await backfillOutlookPhase(client, config, (processed, total) => {
    onProgress?.(processed, total);
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Fetch full conversation data and process into Evidence Store.
 *
 * @param client - Outlook client
 * @param accountId - Account ID
 * @param conversationIds - Provider conversation IDs to fetch
 * @param options - Processing options
 * @returns Batch processing result
 */
async function fetchAndProcessConversations(
  client: OutlookEmailClient,
  accountId: string,
  conversationIds: string[],
  options: { skipExisting?: boolean; forceUpdate?: boolean } = {}
): Promise<BatchResult> {
  const threads: EmailThreadWithMessages[] = [];
  const errors: SyncError[] = [];

  // Fetch conversation details in batches
  for (const conversationId of conversationIds) {
    try {
      const thread = await client.getThread(conversationId);
      if (thread) {
        threads.push(thread);
      }
    } catch (error) {
      errors.push({
        code: "FETCH_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        threadId: conversationId,
        retryable: true,
      });
    }
  }

  // Process fetched conversations
  const batchResult = await processBatch(accountId, threads, options);
  batchResult.errors.push(...errors);

  return batchResult;
}

/**
 * Get initial sync cursor for Outlook (deltaLink).
 */
export async function getOutlookInitialCursor(
  client: OutlookEmailClient
): Promise<string> {
  return await client.getInitialCursor();
}
