// =============================================================================
// EMAIL SYNC TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for incremental email synchronization.
// Runs on schedule and on-demand to keep Evidence Store current.
// Intelligence extraction is handled by the Python backend via orchestratorExtractTask.
//

import { db } from "@memorystack/db";
import { conversation, sourceAccount } from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { log } from "../lib/logger";
import {
  getAccountsForSync,
  isAccountSyncing,
  performIncrementalSync,
  type SyncResult,
} from "../lib/sync";
import { orchestratorExtractTask } from "./intelligence-extraction";

// =============================================================================
// TYPES
// =============================================================================

interface SyncPayload {
  /** Specific source account ID to sync (optional) */
  sourceAccountId?: string;
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

    if (payload.sourceAccountId) {
      // Single account sync - use sourceAccount table
      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, payload.sourceAccountId),
          eq(sourceAccount.type, "email")
        ),
      });
      accounts = account ? [account] : [];
    } else {
      // Batch sync for all accounts (optionally filtered by org)
      accounts = await getAccountsForSync(payload.organizationId);
    }

    log.info("Email sync starting", {
      accountCount: accounts.length,
      organizationId: payload.organizationId,
      sourceAccountId: payload.sourceAccountId,
    });

    result.total = accounts.length;

    for (const account of accounts) {
      // Skip if already syncing (unless forced)
      if (!payload.force && (await isAccountSyncing(account.id))) {
        log.debug("Skipping account - already syncing", {
          sourceAccountId: account.id,
        });
        result.skipped++;
        continue;
      }

      // Skip if recently synced (unless forced)
      if (!payload.force && account.lastSyncAt) {
        const settings = account.settings as {
          syncFrequencyMinutes?: number;
        } | null;
        const syncInterval = settings?.syncFrequencyMinutes ?? 5;
        const minSyncInterval = syncInterval * 60 * 1000; // Convert to ms
        const timeSinceLastSync = Date.now() - account.lastSyncAt.getTime();

        if (timeSinceLastSync < minSyncInterval) {
          log.debug("Skipping account - recently synced", {
            sourceAccountId: account.id,
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

          // Trigger intelligence extraction for new conversations
          if (syncResult.newThreads > 0) {
            log.info(
              "Triggering intelligence extraction for new conversations",
              {
                sourceAccountId: account.id,
                newConversations: syncResult.newThreads,
              }
            );

            // Get recent conversations for this account
            const recentConversations = await db.query.conversation.findMany({
              where: eq(conversation.sourceAccountId, account.id),
              orderBy: [desc(conversation.createdAt)],
              limit: Math.min(syncResult.newThreads, 50),
              with: {
                messages: {
                  orderBy: (m, { asc }) => [asc(m.messageIndex)],
                },
              },
            });

            // Trigger intelligence extraction for each conversation
            for (const conv of recentConversations) {
              if (conv.messages.length > 0) {
                // Combine messages into content for extraction
                const content = conv.messages
                  .map((m) => {
                    const from = m.senderName ?? m.senderEmail ?? "Unknown";
                    const body = m.bodyText ?? "";
                    return `From: ${from}\n${body}`;
                  })
                  .join("\n\n---\n\n");

                await orchestratorExtractTask.trigger({
                  organizationId: account.organizationId,
                  sourceType: "email",
                  content,
                  sourceId: account.id,
                  conversationId: conv.id,
                  userEmail: account.externalId,
                });
              }
            }
          }
        } else {
          result.failed++;
        }

        log.info("Account sync completed", {
          sourceAccountId: account.id,
          success: syncResult.success,
          threadsProcessed: syncResult.threadsProcessed,
          newThreads: syncResult.newThreads,
          errors: syncResult.errors.length,
        });
      } catch (error) {
        result.failed++;
        log.error("Account sync failed", error, {
          sourceAccountId: account.id,
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
  run: async (payload: { sourceAccountId: string }): Promise<SyncResult> => {
    log.info("On-demand sync starting", {
      sourceAccountId: payload.sourceAccountId,
    });

    const result = await performIncrementalSync(payload.sourceAccountId);

    // Get account for organization ID
    const account = await db.query.sourceAccount.findFirst({
      where: eq(sourceAccount.id, payload.sourceAccountId),
    });

    // Trigger intelligence extraction for new conversations
    if (result.success && result.newThreads > 0 && account) {
      log.info("Triggering intelligence extraction for new conversations", {
        sourceAccountId: payload.sourceAccountId,
        newConversations: result.newThreads,
      });

      // Get recent conversations
      const recentConversations = await db.query.conversation.findMany({
        where: eq(conversation.sourceAccountId, payload.sourceAccountId),
        orderBy: [desc(conversation.createdAt)],
        limit: Math.min(result.newThreads, 50),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
        },
      });

      // Trigger intelligence extraction for each conversation
      for (const conv of recentConversations) {
        if (conv.messages.length > 0) {
          const content = conv.messages
            .map((m) => {
              const from = m.senderName ?? m.senderEmail ?? "Unknown";
              const body = m.bodyText ?? "";
              return `From: ${from}\n${body}`;
            })
            .join("\n\n---\n\n");

          await orchestratorExtractTask.trigger({
            organizationId: account.organizationId,
            sourceType: "email",
            content,
            sourceId: account.id,
            conversationId: conv.id,
            userEmail: account.externalId,
          });
        }
      }
    }

    log.info("On-demand sync completed", {
      sourceAccountId: payload.sourceAccountId,
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

    const accountsToSync = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.type, "email"),
        or(
          eq(sourceAccount.status, "connected"),
          eq(sourceAccount.status, "syncing")
        ),
        or(
          // Never synced
          isNull(sourceAccount.lastSyncAt),
          // Not synced in last 5 minutes
          lte(sourceAccount.lastSyncAt, fiveMinutesAgo)
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
        sourceAccountId: account.id,
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
