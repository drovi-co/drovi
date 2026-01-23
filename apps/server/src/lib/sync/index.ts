// =============================================================================
// EMAIL SYNC ORCHESTRATION
// =============================================================================
//
// Coordinates sync operations across email accounts and providers.
// Handles job management, concurrency control, and error recovery.
//

import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { and, eq, or } from "drizzle-orm";
import { safeDecryptToken } from "../crypto/tokens";
import {
  createEmailClient,
  type GmailEmailClient,
  type OutlookEmailClient,
} from "../email-client";
import { log } from "../logger";
import { syncGmailIncremental } from "./gmail-sync";
import { syncOutlookIncremental } from "./outlook-sync";
import type { BackfillConfig, ProviderSyncOptions, SyncResult } from "./types";

export * from "./deduplication";
export {
  backfillGmail,
  backfillGmailPhase,
  syncGmailIncremental,
} from "./gmail-sync";
export {
  backfillOutlook,
  backfillOutlookPhase,
  syncOutlookIncremental,
} from "./outlook-sync";
export * from "./parallel-fetch";
export * from "./processor";
// Re-export types and modules
export * from "./types";

// =============================================================================
// ACCOUNT FETCHING
// =============================================================================

/**
 * Get email account with decrypted tokens.
 */
export async function getAccountForSync(accountId: string) {
  const account = await db.query.sourceAccount.findFirst({
    where: and(
      eq(sourceAccount.id, accountId),
      eq(sourceAccount.type, "email")
    ),
  });

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return account;
}

/**
 * Get all active accounts that need syncing.
 */
export async function getAccountsForSync(organizationId?: string) {
  const conditions = [
    eq(sourceAccount.type, "email"),
    or(
      eq(sourceAccount.status, "connected"),
      eq(sourceAccount.status, "syncing")
    ),
  ];

  if (organizationId) {
    conditions.push(eq(sourceAccount.organizationId, organizationId));
  }

  return await db.query.sourceAccount.findMany({
    where: and(...conditions),
  });
}

// =============================================================================
// SYNC ORCHESTRATION
// =============================================================================

/**
 * Perform incremental sync for an account.
 *
 * @param accountId - Email account ID
 * @returns Sync result
 */
export async function performIncrementalSync(
  accountId: string
): Promise<SyncResult> {
  const account = await getAccountForSync(accountId);

  // Update status to syncing
  await db
    .update(sourceAccount)
    .set({ status: "syncing", updatedAt: new Date() })
    .where(eq(sourceAccount.id, accountId));

  try {
    // Create email client
    const client = createEmailClient({
      account,
      skipCache: true,
      decryptToken: safeDecryptToken,
    });

    // Check if token needs refresh
    if (client.needsRefresh()) {
      await client.refreshToken();
      // Update tokens in database
      const newTokenInfo = client.getTokenInfo();
      await db
        .update(sourceAccount)
        .set({
          accessToken: newTokenInfo.accessToken,
          refreshToken: newTokenInfo.refreshToken,
          tokenExpiresAt: newTokenInfo.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, accountId));
    }

    // Perform provider-specific sync
    const options: ProviderSyncOptions = {
      cursor: account.syncCursor ?? undefined,
    };

    let result: SyncResult;

    if (account.provider === "gmail") {
      result = await syncGmailIncremental(
        client as GmailEmailClient,
        accountId,
        options
      );
    } else if (account.provider === "outlook") {
      result = await syncOutlookIncremental(
        client as OutlookEmailClient,
        accountId,
        options
      );
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    // Update account with new cursor and stats
    await db
      .update(sourceAccount)
      .set({
        status: "connected",
        syncCursor: result.newCursor ?? account.syncCursor,
        lastSyncAt: new Date(),
        lastSyncError: result.success ? null : result.errors[0]?.message,
        updatedAt: new Date(),
      })
      .where(eq(sourceAccount.id, accountId));

    return result;
  } catch (error) {
    // Update status back to active (or error state)
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await db
      .update(sourceAccount)
      .set({
        status: "connected",
        lastSyncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(sourceAccount.id, accountId));

    log.error("Incremental sync failed", error, { accountId });

    return {
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
      errors: [
        {
          code: "SYNC_FAILED",
          message: errorMessage,
          retryable: true,
        },
      ],
      duration: 0,
    };
  }
}

/**
 * Perform a single-phase backfill for an account.
 *
 * NOTE: For production use, prefer the multi-phase backfill via Trigger.dev tasks
 * (priorityBackfillTask, extendedBackfillTask, archiveBackfillTask) which:
 * - Import full history automatically (not just 90 days)
 * - Use parallel fetching for speed
 * - Chain phases automatically
 * - Provide progress tracking for UI
 *
 * This function is kept for backwards compatibility and testing.
 *
 * @param accountId - Email account ID
 * @param onProgress - Progress callback
 * @param phase - Which phase to run (defaults to priority for last 90 days)
 * @returns Sync result
 */
export async function performBackfill(
  accountId: string,
  onProgress?: (progress: number, total: number) => void,
  phase: "priority" | "extended" | "archive" = "priority"
): Promise<SyncResult> {
  const account = await getAccountForSync(accountId);

  // Update status to syncing
  await db
    .update(sourceAccount)
    .set({ status: "syncing", updatedAt: new Date() })
    .where(eq(sourceAccount.id, accountId));

  try {
    // Create email client
    const client = createEmailClient({
      account,
      skipCache: true,
      decryptToken: safeDecryptToken,
    });

    // Check if token needs refresh
    if (client.needsRefresh()) {
      await client.refreshToken();
      // Update tokens in database
      const newTokenInfo = client.getTokenInfo();
      await db
        .update(sourceAccount)
        .set({
          accessToken: newTokenInfo.accessToken,
          refreshToken: newTokenInfo.refreshToken,
          tokenExpiresAt: newTokenInfo.expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, accountId));
    }

    // Get date range for phase
    const { getPhaseDateRange } = await import("./parallel-fetch");
    const { BACKFILL_CONCURRENCY } = await import("./types");

    const dateRange = getPhaseDateRange(phase);
    const concurrency = BACKFILL_CONCURRENCY[phase];

    const config: BackfillConfig = {
      sourceAccountId: accountId, // TODO: Migrate to sourceAccount
      organizationId: account.organizationId,
      phase,
      afterDate: dateRange.afterDate,
      beforeDate: dateRange.beforeDate,
      batchSize: concurrency.batchSize,
      threadFetchConcurrency: concurrency.threadFetchConcurrency,
    };

    let result: SyncResult;

    if (account.provider === "gmail") {
      const { backfillGmailPhase } = await import("./gmail-sync");
      result = await backfillGmailPhase(
        client as GmailEmailClient,
        config,
        (processed, total) => onProgress?.(processed, total)
      );
    } else if (account.provider === "outlook") {
      const { backfillOutlookPhase } = await import("./outlook-sync");
      result = await backfillOutlookPhase(
        client as OutlookEmailClient,
        config,
        (processed, total) => onProgress?.(processed, total)
      );
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    // Update account with new cursor and stats
    await db
      .update(sourceAccount)
      .set({
        status: "connected",
        syncCursor: result.newCursor ?? account.syncCursor,
        lastSyncAt: new Date(),
        lastSyncError: result.success ? null : result.errors[0]?.message,
        updatedAt: new Date(),
      })
      .where(eq(sourceAccount.id, accountId));

    return result;
  } catch (error) {
    // Update status back to active (or error state)
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await db
      .update(sourceAccount)
      .set({
        status: "connected",
        lastSyncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(sourceAccount.id, accountId));

    log.error("Backfill failed", error, { accountId });

    return {
      success: false,
      jobId: crypto.randomUUID(),
      accountId,
      type: "backfill",
      threadsProcessed: 0,
      messagesProcessed: 0,
      newThreads: 0,
      updatedThreads: 0,
      newMessages: 0,
      updatedMessages: 0,
      errors: [
        {
          code: "BACKFILL_FAILED",
          message: errorMessage,
          retryable: true,
        },
      ],
      duration: 0,
    };
  }
}

// =============================================================================
// SYNC STATUS
// =============================================================================

/**
 * Get sync status for an account.
 */
export async function getSyncStatus(accountId: string) {
  const account = await db.query.sourceAccount.findFirst({
    where: eq(sourceAccount.id, accountId),
    columns: {
      id: true,
      status: true,
      syncCursor: true,
      lastSyncAt: true,
      lastSyncError: true,
    },
  });

  if (!account) {
    return null;
  }

  return {
    accountId: account.id,
    status: account.status,
    hasCursor: !!account.syncCursor,
    lastSyncAt: account.lastSyncAt,
    lastSyncError: account.lastSyncError,
    needsBackfill: !account.syncCursor,
  };
}

/**
 * Check if an account is currently syncing.
 */
export async function isAccountSyncing(accountId: string): Promise<boolean> {
  const account = await db.query.sourceAccount.findFirst({
    where: eq(sourceAccount.id, accountId),
    columns: { status: true },
  });

  return account?.status === "syncing";
}
