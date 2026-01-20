// =============================================================================
// EMAIL SYNC TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for incremental email synchronization.
// Runs on schedule and on-demand to keep Evidence Store current.
//

import { db } from "@memorystack/db";
import { emailAccount } from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { log } from "../lib/logger";
import {
  getAccountsForSync,
  isAccountSyncing,
  performIncrementalSync,
  type SyncResult,
} from "../lib/sync";
import { batchAnalyzeThreadsTask } from "./thread-analysis";

// =============================================================================
// TYPES
// =============================================================================

interface SyncPayload {
  /** Specific account ID to sync (optional) */
  accountId?: string;
  /** Organization ID to sync all accounts for (optional) */
  organizationId?: string;
  /** Force sync even if recently synced */
  force?: boolean;
}

interface BatchSyncResult {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  results: SyncResult[];
}

// =============================================================================
// INCREMENTAL SYNC TASK
// =============================================================================

/**
 * Incremental sync task - syncs new/changed emails for accounts.
 *
 * Can be triggered:
 * - On schedule (every 5 minutes for all active accounts)
 * - On-demand for a specific account
 * - On-demand for all accounts in an organization
 */
export const syncEmailsTask = task({
  id: "email-sync",
  queue: {
    name: "email-sync",
    concurrencyLimit: 10, // Max 10 concurrent syncs
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  run: async (payload: SyncPayload): Promise<BatchSyncResult> => {
    const result: BatchSyncResult = {
      total: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    // Get accounts to sync
    let accounts: Awaited<ReturnType<typeof getAccountsForSync>>;

    if (payload.accountId) {
      // Single account sync
      const account = await db.query.emailAccount.findFirst({
        where: eq(emailAccount.id, payload.accountId),
      });
      accounts = account ? [account] : [];
    } else {
      // Batch sync for all accounts (optionally filtered by org)
      accounts = await getAccountsForSync(payload.organizationId);
    }

    log.info("Email sync starting", {
      accountCount: accounts.length,
      organizationId: payload.organizationId,
      accountId: payload.accountId,
    });

    result.total = accounts.length;

    for (const account of accounts) {
      // Skip if already syncing (unless forced)
      if (!payload.force && (await isAccountSyncing(account.id))) {
        log.debug("Skipping account - already syncing", {
          accountId: account.id,
        });
        result.skipped++;
        continue;
      }

      // Skip if recently synced (unless forced)
      if (!payload.force && account.lastSyncAt) {
        const syncInterval =
          (account.settings as { syncFrequencyMinutes?: number } | null)
            ?.syncFrequencyMinutes ?? 5;
        const minSyncInterval = syncInterval * 60 * 1000; // Convert to ms
        const timeSinceLastSync = Date.now() - account.lastSyncAt.getTime();

        if (timeSinceLastSync < minSyncInterval) {
          log.debug("Skipping account - recently synced", {
            accountId: account.id,
            timeSinceLastSync,
            minSyncInterval,
          });
          result.skipped++;
          continue;
        }
      }

      try {
        const syncResult = await performIncrementalSync(account.id);
        result.results.push(syncResult);

        if (syncResult.success) {
          result.successful++;

          // Trigger AI analysis for new threads
          if (syncResult.newThreads > 0) {
            log.info("Triggering AI analysis for new threads", {
              accountId: account.id,
              newThreads: syncResult.newThreads,
            });

            await batchAnalyzeThreadsTask.trigger({
              accountId: account.id,
              limit: Math.min(syncResult.newThreads, 50),
              force: false,
            });
          }
        } else {
          result.failed++;
        }

        log.info("Account sync completed", {
          accountId: account.id,
          success: syncResult.success,
          threadsProcessed: syncResult.threadsProcessed,
          newThreads: syncResult.newThreads,
          errors: syncResult.errors.length,
        });
      } catch (error) {
        result.failed++;
        log.error("Account sync failed", error, {
          accountId: account.id,
        });
      }

      // Small delay between accounts to avoid overwhelming
      if (accounts.indexOf(account) < accounts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    log.info("Email sync batch completed", {
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      skipped: result.skipped,
    });

    return result;
  },
});

// =============================================================================
// ON-DEMAND SYNC TASK
// =============================================================================

/**
 * On-demand sync task for immediate account sync.
 * Has higher priority than scheduled sync.
 */
export const syncEmailsOnDemandTask = task({
  id: "email-sync-on-demand",
  queue: {
    name: "email-sync-priority",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 10_000,
    factor: 2,
  },
  run: async (payload: { accountId: string }): Promise<SyncResult> => {
    log.info("On-demand sync starting", { accountId: payload.accountId });

    const result = await performIncrementalSync(payload.accountId);

    // Trigger AI analysis for new threads
    if (result.success && result.newThreads > 0) {
      log.info("Triggering AI analysis for new threads", {
        accountId: payload.accountId,
        newThreads: result.newThreads,
      });

      await batchAnalyzeThreadsTask.trigger({
        accountId: payload.accountId,
        limit: Math.min(result.newThreads, 50),
        force: false,
      });
    }

    log.info("On-demand sync completed", {
      accountId: payload.accountId,
      success: result.success,
      threadsProcessed: result.threadsProcessed,
      newThreads: result.newThreads,
    });

    return result;
  },
});

// =============================================================================
// SCHEDULED SYNC
// =============================================================================

/**
 * Scheduled task to sync all active accounts every 5 minutes.
 */
export const syncEmailsSchedule = schedules.task({
  id: "email-sync-schedule",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async () => {
    log.info("Starting scheduled email sync");

    // Find accounts that need syncing
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const accountsToSync = await db.query.emailAccount.findMany({
      where: and(
        or(
          eq(emailAccount.status, "active"),
          eq(emailAccount.status, "syncing")
        ),
        or(
          // Never synced
          isNull(emailAccount.lastSyncAt),
          // Not synced in last 5 minutes
          lte(emailAccount.lastSyncAt, fiveMinutesAgo)
        )
      ),
      columns: { id: true },
    });

    if (accountsToSync.length === 0) {
      log.info("No accounts need syncing");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger sync task for each account
    for (const account of accountsToSync) {
      await syncEmailsTask.trigger({
        accountId: account.id,
      });
    }

    log.info("Scheduled email sync triggered", {
      accountsTriggered: accountsToSync.length,
    });

    return { scheduled: true, accountsTriggered: accountsToSync.length };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type { SyncPayload, BatchSyncResult };
