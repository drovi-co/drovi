// =============================================================================
// GMAIL-SPECIFIC SYNC LOGIC
// =============================================================================
//
// Implements Gmail's sync strategy using the History API for incremental sync
// and parallel thread fetching for high-speed backfill.
//
// Uses ONLY the unified schema (sourceAccount, conversation, message).
//

import type { GmailEmailClient } from "../email-client/gmail";
import type { EmailThreadWithMessages } from "../email-client/types";
import { log } from "../logger";
import { batchDeduplicateThreads } from "./deduplication";
import { triggerIntelligenceExtraction } from "./intelligence-trigger";
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
 * Perform incremental sync for a Gmail account.
 * Uses the History API to fetch changes since the last sync cursor.
 *
 * @param client - Gmail client instance
 * @param sourceAccountId - Source account ID in our database
 * @param options - Sync options including cursor
 * @returns Sync result with statistics
 */
export async function syncGmailIncremental(
  client: GmailEmailClient,
  sourceAccountId: string,
  options: ProviderSyncOptions
): Promise<SyncResult> {
  const startTime = Date.now();
  const result: SyncResult = {
    success: false,
    jobId: crypto.randomUUID(),
    accountId: sourceAccountId,
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

    log.info("Gmail incremental sync: changes detected", {
      sourceAccountId,
      changedThreads: delta.changedThreadIds.length,
      deletedThreads: delta.deletedThreadIds.length,
      fullSyncRequired: delta.fullSyncRequired,
    });

    // If full sync is required (history expired), do a catch-up sync
    // Instead of failing, we fetch recent threads and get a fresh cursor
    if (delta.fullSyncRequired) {
      log.warn("Gmail history expired - performing catch-up sync", {
        sourceAccountId,
        oldCursor: options.cursor,
      });

      // Fetch recent threads (last 7 days) to catch up
      const catchUpResult = await performCatchUpSync(client, sourceAccountId);

      result.threadsProcessed = catchUpResult.threadsProcessed;
      result.newThreads = catchUpResult.newThreads;
      result.updatedThreads = catchUpResult.updatedThreads;
      result.messagesProcessed = catchUpResult.messagesProcessed;
      result.errors.push(...catchUpResult.errors);

      // Use the fresh cursor for future syncs
      result.newCursor = delta.newCursor;
      result.success = catchUpResult.errors.length === 0;
      result.duration = Date.now() - startTime;

      log.info("Gmail catch-up sync completed", {
        ...result,
        sourceAccountId,
        newCursor: result.newCursor,
      });

      return result;
    }

    // Handle deleted threads
    for (const threadId of delta.deletedThreadIds) {
      try {
        await markThreadDeleted(sourceAccountId, threadId);
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
      const batchResult = await fetchAndProcessThreads(
        client,
        sourceAccountId,
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

    log.info("Gmail incremental sync completed", {
      ...result,
      sourceAccountId,
    });

    return result;
  } catch (error) {
    result.errors.push({
      code: "SYNC_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: true,
    });
    result.duration = Date.now() - startTime;
    log.error("Gmail incremental sync failed", error, { sourceAccountId });
    return result;
  }
}

// =============================================================================
// PHASE-BASED BACKFILL
// =============================================================================

/**
 * Perform phase-based backfill for a Gmail account.
 * Uses parallel fetching for high-speed import.
 *
 * @param client - Gmail client instance
 * @param config - Backfill configuration with phase and date range
 * @param onProgress - Progress callback (processed, total, estimatedTimeRemaining)
 * @returns Phase backfill result with statistics
 */
export async function backfillGmailPhase(
  client: GmailEmailClient,
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
    accountId: config.sourceAccountId,
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
    // Step 1: Collect thread IDs for the date range
    log.info("Gmail phase backfill: collecting thread IDs", {
      sourceAccountId: config.sourceAccountId,
      phase: config.phase,
      afterDate: config.afterDate?.toISOString(),
      beforeDate: config.beforeDate?.toISOString(),
    });

    const allThreadIds = await collectThreadIds(
      client,
      config.afterDate,
      config.beforeDate,
      (collected) => {
        log.debug("Gmail phase backfill: collecting", { collected });
      }
    );

    log.info("Gmail phase backfill: thread IDs collected", {
      sourceAccountId: config.sourceAccountId,
      phase: config.phase,
      totalThreads: allThreadIds.length,
    });

    // If no threads found, phase is complete
    if (allThreadIds.length === 0) {
      result.success = true;
      result.phaseComplete = true;
      result.duration = Date.now() - startTime;
      return result;
    }

    // Step 2: Deduplicate against existing conversations
    const dedupeResult = await batchDeduplicateThreads(
      config.sourceAccountId,
      allThreadIds
    );

    const newThreadIds = dedupeResult.newIds;

    log.info("Gmail phase backfill: deduplication complete", {
      sourceAccountId: config.sourceAccountId,
      phase: config.phase,
      newThreads: newThreadIds.length,
      existingThreads: dedupeResult.existingIds.length,
    });

    // If all threads already exist, phase is complete
    if (newThreadIds.length === 0) {
      result.success = true;
      result.phaseComplete = true;
      result.duration = Date.now() - startTime;
      return result;
    }

    result.threadsRemaining = newThreadIds.length;

    // Step 3: Fetch threads in parallel batches
    let processedCount = 0;

    for (let i = 0; i < newThreadIds.length; i += config.batchSize) {
      const batch = newThreadIds.slice(i, i + config.batchSize);
      const batchStartTime = Date.now();

      // Fetch batch in parallel
      const fetchResult = await fetchThreadsParallel(client, batch, {
        concurrency: config.threadFetchConcurrency,
        batchDelayMs: 25, // Minimal delay for speed
        onProgress: (fetched, _total) => {
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

      // Process fetched threads into database
      if (fetchResult.threads.length > 0) {
        const batchResult = await processBatch(
          config.sourceAccountId,
          fetchResult.threads,
          { skipExisting: true }
        );

        result.threadsProcessed += batchResult.processed;
        result.newThreads += batchResult.threads.filter((t) => t.isNew).length;
        const messagesInBatch = batchResult.threads.reduce(
          (sum, t) => sum + (t.messages?.length ?? 0),
          0
        );
        result.messagesProcessed += messagesInBatch;
        result.errors.push(...batchResult.errors);

        // Log batch summary for debugging
        log.debug("Batch processing summary", {
          sourceAccountId: config.sourceAccountId,
          phase: config.phase,
          threadsInBatch: fetchResult.threads.length,
          threadsProcessed: batchResult.processed,
          messagesInBatch,
          errors: batchResult.errors.length,
        });

        // Trigger intelligence extraction for new threads (fire and forget)
        // This runs in parallel with the next batch fetch for speed
        triggerIntelligenceExtraction(
          batchResult.threads,
          config.organizationId,
          config.sourceAccountId
        ).catch((err) => {
          log.error("Failed to trigger intelligence extraction", err, {
            sourceAccountId: config.sourceAccountId,
            phase: config.phase,
            batchSize: batchResult.threads.length,
          });
        });
      } else {
        log.warn("No threads returned from fetch", {
          sourceAccountId: config.sourceAccountId,
          phase: config.phase,
          batchSize: batch.length,
          fetchErrors: fetchResult.errors.length,
        });
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

      log.debug("Gmail phase backfill: batch complete", {
        sourceAccountId: config.sourceAccountId,
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

    log.info("Gmail phase backfill completed", {
      ...result,
      sourceAccountId: config.sourceAccountId,
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
    log.error("Gmail phase backfill failed", error, {
      sourceAccountId: config.sourceAccountId,
      phase: config.phase,
    });
    return result;
  }
}

/**
 * Legacy backfill function for backwards compatibility.
 * @deprecated Use backfillGmailPhase instead
 */
export async function backfillGmail(
  client: GmailEmailClient,
  config: BackfillConfig,
  onProgress?: (progress: number, total: number) => void
): Promise<SyncResult> {
  return await backfillGmailPhase(client, config, (processed, total) => {
    onProgress?.(processed, total);
  });
}

// =============================================================================
// CATCH-UP SYNC (History Expired Recovery)
// =============================================================================

interface CatchUpResult {
  threadsProcessed: number;
  newThreads: number;
  updatedThreads: number;
  messagesProcessed: number;
  errors: SyncError[];
}

/**
 * Perform a catch-up sync when history has expired.
 * Fetches recent threads (last 7 days) to ensure we're up to date.
 *
 * @param client - Gmail client
 * @param sourceAccountId - Source account ID
 * @returns Catch-up sync result
 */
async function performCatchUpSync(
  client: GmailEmailClient,
  sourceAccountId: string
): Promise<CatchUpResult> {
  const result: CatchUpResult = {
    threadsProcessed: 0,
    newThreads: 0,
    updatedThreads: 0,
    messagesProcessed: 0,
    errors: [],
  };

  try {
    // Query for threads modified in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateQuery = `after:${sevenDaysAgo.getFullYear()}/${sevenDaysAgo.getMonth() + 1}/${sevenDaysAgo.getDate()}`;

    log.info("Gmail catch-up sync: fetching recent threads", {
      sourceAccountId,
      query: dateQuery,
    });

    // Collect thread IDs from last 7 days
    const threadIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await client.listThreads({
        query: dateQuery,
        limit: 100,
        cursor: pageToken,
      });

      for (const thread of response.items) {
        threadIds.push(thread.providerThreadId);
      }

      pageToken = response.nextCursor;

      // Safety limit: max 500 threads in catch-up
      if (threadIds.length >= 500) {
        log.warn("Gmail catch-up sync: hit thread limit", {
          sourceAccountId,
          threadCount: threadIds.length,
        });
        break;
      }
    } while (pageToken);

    log.info("Gmail catch-up sync: collected thread IDs", {
      sourceAccountId,
      threadCount: threadIds.length,
    });

    if (threadIds.length === 0) {
      return result;
    }

    // Deduplicate against existing conversations
    const dedupeResult = await batchDeduplicateThreads(
      sourceAccountId,
      threadIds
    );
    const threadsToProcess = [
      ...dedupeResult.newIds,
      // Also re-process some existing threads to catch updates
      ...dedupeResult.existingIds.slice(0, 50),
    ];

    log.info("Gmail catch-up sync: processing threads", {
      sourceAccountId,
      newThreads: dedupeResult.newIds.length,
      existingToUpdate: Math.min(dedupeResult.existingIds.length, 50),
      totalToProcess: threadsToProcess.length,
    });

    // Fetch and process threads
    if (threadsToProcess.length > 0) {
      const batchResult = await fetchAndProcessThreads(
        client,
        sourceAccountId,
        threadsToProcess,
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
  } catch (error) {
    result.errors.push({
      code: "CATCH_UP_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: true,
    });
    log.error("Gmail catch-up sync failed", error, { sourceAccountId });
  }

  return result;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Fetch full thread data and process into unified schema.
 *
 * @param client - Gmail client
 * @param sourceAccountId - Source account ID
 * @param threadIds - Provider thread IDs to fetch
 * @param options - Processing options
 * @returns Batch processing result
 */
async function fetchAndProcessThreads(
  client: GmailEmailClient,
  sourceAccountId: string,
  threadIds: string[],
  options: { skipExisting?: boolean; forceUpdate?: boolean } = {}
): Promise<BatchResult> {
  const threads: EmailThreadWithMessages[] = [];
  const errors: SyncError[] = [];

  // Fetch thread details in batches
  for (const threadId of threadIds) {
    try {
      const thread = await client.getThread(threadId);
      if (thread) {
        threads.push(thread);
      }
    } catch (error) {
      errors.push({
        code: "FETCH_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
        threadId,
        retryable: true,
      });
    }
  }

  // Process fetched threads
  const batchResult = await processBatch(sourceAccountId, threads, options);
  batchResult.errors.push(...errors);

  return batchResult;
}

/**
 * Get initial sync cursor for Gmail (historyId).
 */
export async function getGmailInitialCursor(
  client: GmailEmailClient
): Promise<string> {
  return await client.getInitialCursor();
}
