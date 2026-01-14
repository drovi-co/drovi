// =============================================================================
// PARALLEL THREAD FETCHING
// =============================================================================
//
// High-performance parallel fetching for large-scale backfill operations.
// Optimized for power users with millions of emails.
//

import type { GmailEmailClient } from "../email-client/gmail";
import type { OutlookEmailClient } from "../email-client/outlook";
import type { EmailThreadWithMessages } from "../email-client/types";
import { log } from "../logger";
import type { SyncError } from "./types";

type EmailClient = GmailEmailClient | OutlookEmailClient;

interface ParallelFetchOptions {
  /** Maximum concurrent requests */
  concurrency: number;
  /** Delay between batches (ms) to respect rate limits */
  batchDelayMs?: number;
  /** Progress callback */
  onProgress?: (fetched: number, total: number) => void;
}

interface ParallelFetchResult {
  threads: EmailThreadWithMessages[];
  errors: SyncError[];
  fetchedCount: number;
  errorCount: number;
  duration: number;
}

/**
 * Fetch multiple threads in parallel with controlled concurrency.
 * Optimized for speed while respecting API rate limits.
 *
 * @param client - Email client (Gmail or Outlook)
 * @param threadIds - Array of provider thread IDs to fetch
 * @param options - Concurrency and progress options
 * @returns Fetched threads and any errors
 */
export async function fetchThreadsParallel(
  client: EmailClient,
  threadIds: string[],
  options: ParallelFetchOptions
): Promise<ParallelFetchResult> {
  const startTime = Date.now();
  const { concurrency, batchDelayMs = 50, onProgress } = options;

  const threads: EmailThreadWithMessages[] = [];
  const errors: SyncError[] = [];
  let fetchedCount = 0;

  // Process in concurrent batches
  for (let i = 0; i < threadIds.length; i += concurrency) {
    const batch = threadIds.slice(i, i + concurrency);

    // Fetch batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (threadId) => {
        const thread = await client.getThread(threadId);
        return { threadId, thread };
      })
    );

    // Process results
    for (const result of results) {
      if (result.status === "fulfilled") {
        if (result.value.thread) {
          // Verify thread has messages before adding
          const msgCount = result.value.thread.messages?.length ?? 0;
          if (msgCount > 0) {
            threads.push(result.value.thread);
            fetchedCount++;
          } else {
            log.warn("Thread fetched but has no messages", {
              threadId: result.value.threadId,
              messageCount: msgCount,
            });
            errors.push({
              code: "NO_MESSAGES",
              message: `Thread ${result.value.threadId} has no messages`,
              threadId: result.value.threadId,
              retryable: true,
            });
          }
        } else {
          // Thread returned null (not found or empty)
          log.debug("Thread fetch returned null", {
            threadId: result.value.threadId,
          });
        }
      } else if (result.status === "rejected") {
        errors.push({
          code: "FETCH_ERROR",
          message:
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error",
          retryable: true,
        });
      }
    }

    // Report progress
    onProgress?.(fetchedCount, threadIds.length);

    // Small delay to respect rate limits
    if (i + concurrency < threadIds.length && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
  }

  const duration = Date.now() - startTime;

  log.info("Parallel fetch completed", {
    total: threadIds.length,
    fetched: fetchedCount,
    errors: errors.length,
    duration,
    throughput: `${Math.round((fetchedCount / duration) * 1000)} threads/sec`,
  });

  return {
    threads,
    errors,
    fetchedCount,
    errorCount: errors.length,
    duration,
  };
}

/**
 * Collect thread IDs for a date range using pagination.
 * Optimized for fast ID collection before parallel fetching.
 *
 * @param client - Email client
 * @param afterDate - Start date (older boundary)
 * @param beforeDate - End date (newer boundary, optional)
 * @param onProgress - Progress callback
 * @returns Array of thread IDs
 */
export async function collectThreadIds(
  client: EmailClient,
  afterDate?: Date,
  beforeDate?: Date,
  onProgress?: (collected: number) => void
): Promise<string[]> {
  const startTime = Date.now();
  const allThreadIds: string[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  log.info("Collecting thread IDs", {
    afterDate: afterDate?.toISOString(),
    beforeDate: beforeDate?.toISOString(),
  });

  do {
    const response = await client.listThreads({
      limit: 500, // Maximum page size for faster collection
      cursor,
      after: afterDate,
      before: beforeDate,
      includeSpamTrash: false,
    });

    const threadIds = response.items.map((t) => t.providerThreadId);
    allThreadIds.push(...threadIds);
    cursor = response.nextCursor;
    pageCount++;

    onProgress?.(allThreadIds.length);

    log.debug("Thread ID collection page", {
      page: pageCount,
      pageSize: threadIds.length,
      total: allThreadIds.length,
      hasMore: response.hasMore,
    });
  } while (cursor);

  const duration = Date.now() - startTime;

  log.info("Thread ID collection complete", {
    total: allThreadIds.length,
    pages: pageCount,
    duration,
    throughput: `${Math.round((allThreadIds.length / duration) * 1000)} IDs/sec`,
  });

  return allThreadIds;
}

/**
 * Chunk an array into smaller batches.
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Calculate date boundaries for a backfill phase.
 */
export function getPhaseDateRange(phase: "priority" | "extended" | "archive"): {
  afterDate?: Date;
  beforeDate?: Date;
} {
  const now = new Date();

  switch (phase) {
    case "priority": {
      // Last 90 days
      const afterDate = new Date(now);
      afterDate.setDate(afterDate.getDate() - 90);
      return { afterDate };
    }
    case "extended": {
      // 90 days to 1 year ago
      const beforeDate = new Date(now);
      beforeDate.setDate(beforeDate.getDate() - 90);
      const afterDate = new Date(now);
      afterDate.setDate(afterDate.getDate() - 365);
      return { afterDate, beforeDate };
    }
    case "archive": {
      // Older than 1 year (no lower bound = full history)
      const beforeDate = new Date(now);
      beforeDate.setDate(beforeDate.getDate() - 365);
      return { beforeDate };
    }
  }
}

/**
 * Estimate time remaining based on current throughput.
 */
export function estimateTimeRemaining(
  processedCount: number,
  totalCount: number,
  elapsedMs: number
): number | undefined {
  if (processedCount === 0 || elapsedMs === 0) {
    return undefined;
  }

  const throughputPerMs = processedCount / elapsedMs;
  const remaining = totalCount - processedCount;
  const estimatedMs = remaining / throughputPerMs;

  return Math.round(estimatedMs / 1000); // Return seconds
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
