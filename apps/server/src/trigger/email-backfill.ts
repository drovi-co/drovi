// =============================================================================
// EMAIL BACKFILL TRIGGER.DEV TASKS
// =============================================================================
//
// Multi-phase backfill for power users with millions of emails.
// Automatically imports full email history in priority order:
//
// Phase 1 (Priority):  Last 90 days    - High concurrency, immediate value
// Phase 2 (Extended):  90 days → 1 year - Medium concurrency, background
// Phase 3 (Archive):   1+ years → ALL   - Steady concurrency, full history
//

import { db } from "@memorystack/db";
import { type BackfillProgress, emailAccount } from "@memorystack/db/schema";
import { task } from "@trigger.dev/sdk";
import { eq } from "drizzle-orm";
import { safeDecryptToken } from "../lib/crypto/tokens";
import {
  createEmailClient,
  type GmailEmailClient,
  type OutlookEmailClient,
} from "../lib/email-client";
import { log } from "../lib/logger";
import { backfillGmailPhase } from "../lib/sync/gmail-sync";
import { backfillOutlookPhase } from "../lib/sync/outlook-sync";
import { getPhaseDateRange } from "../lib/sync/parallel-fetch";
import {
  BACKFILL_CONCURRENCY,
  type BackfillPhase,
  type PhaseBackfillResult,
} from "../lib/sync/types";

// =============================================================================
// TYPES
// =============================================================================

interface PhaseBackfillPayload {
  accountId: string;
  phase: "priority" | "extended" | "archive";
}

interface BackfillOrchestratorPayload {
  accountId: string;
}

// =============================================================================
// PHASE-SPECIFIC BACKFILL TASKS
// =============================================================================

/**
 * Priority Phase Backfill (Last 90 days)
 *
 * High-concurrency import for immediate value.
 * Goal: Complete in < 5 minutes for typical accounts.
 */
export const priorityBackfillTask = task({
  id: "email-backfill-priority",
  queue: {
    name: "email-backfill-priority",
    concurrencyLimit: BACKFILL_CONCURRENCY.priority.queueConcurrency,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max
  run: async (payload: PhaseBackfillPayload): Promise<PhaseBackfillResult> => {
    return await executePhaseBackfill(payload.accountId, "priority");
  },
});

/**
 * Extended Phase Backfill (90 days to 1 year)
 *
 * Medium-concurrency background import.
 * Runs after priority phase completes.
 */
export const extendedBackfillTask = task({
  id: "email-backfill-extended",
  queue: {
    name: "email-backfill-extended",
    concurrencyLimit: BACKFILL_CONCURRENCY.extended.queueConcurrency,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 1800, // 30 minutes max
  run: async (payload: PhaseBackfillPayload): Promise<PhaseBackfillResult> => {
    return await executePhaseBackfill(payload.accountId, "extended");
  },
});

/**
 * Archive Phase Backfill (1+ years to full history)
 *
 * Steady background import for complete history.
 * Can run for hours for power users with millions of emails.
 */
export const archiveBackfillTask = task({
  id: "email-backfill-archive",
  queue: {
    name: "email-backfill-archive",
    concurrencyLimit: BACKFILL_CONCURRENCY.archive.queueConcurrency,
  },
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 300_000,
    factor: 2,
  },
  maxDuration: 3600, // 1 hour max per run (will resume if needed)
  run: async (payload: PhaseBackfillPayload): Promise<PhaseBackfillResult> => {
    return await executePhaseBackfill(payload.accountId, "archive");
  },
});

// =============================================================================
// BACKFILL ORCHESTRATOR
// =============================================================================

/**
 * Orchestrates the full backfill process across all phases.
 *
 * Triggered when a new account is connected. Automatically:
 * 1. Starts priority phase immediately
 * 2. Chains to extended phase when priority completes
 * 3. Chains to archive phase when extended completes
 * 4. Updates progress throughout for UI feedback
 */
export const backfillOrchestratorTask = task({
  id: "email-backfill-orchestrator",
  queue: {
    name: "email-backfill-orchestrator",
    concurrencyLimit: 20, // Can orchestrate many accounts
  },
  run: async (
    payload: BackfillOrchestratorPayload
  ): Promise<{ started: boolean; accountId: string }> => {
    const { accountId } = payload;

    log.info("Backfill orchestrator starting", { accountId });

    // Verify account exists
    const account = await db.query.emailAccount.findFirst({
      where: eq(emailAccount.id, accountId),
    });

    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    // Check if already backfilling
    const progress = account.backfillProgress as BackfillProgress | null;
    if (
      progress &&
      progress.phase !== "idle" &&
      progress.phase !== "complete"
    ) {
      log.warn("Backfill already in progress", {
        accountId,
        currentPhase: progress.phase,
      });
      return { started: false, accountId };
    }

    // Initialize backfill progress
    await updateBackfillProgress(accountId, {
      phase: "priority",
      totalThreads: 0,
      processedThreads: 0,
      totalMessages: 0,
      phaseProgress: 0,
      overallProgress: 0,
      phaseStartedAt: new Date().toISOString(),
      errorCount: 0,
    });

    // Start priority phase
    await priorityBackfillTask.trigger({
      accountId,
      phase: "priority",
    });

    log.info("Backfill orchestrator: priority phase triggered", { accountId });

    return { started: true, accountId };
  },
});

/**
 * Auto-trigger backfill when new account is connected.
 */
export const autoBackfillTask = task({
  id: "email-auto-backfill",
  queue: {
    name: "email-backfill-orchestrator",
    concurrencyLimit: 20,
  },
  run: async (payload: {
    accountId: string;
  }): Promise<{ triggered: boolean }> => {
    const { accountId } = payload;

    log.info("Auto-backfill triggered for new account", { accountId });

    await backfillOrchestratorTask.trigger({ accountId });

    return { triggered: true };
  },
});

// =============================================================================
// PHASE EXECUTION
// =============================================================================

/**
 * Execute a specific backfill phase for an account.
 */
async function executePhaseBackfill(
  accountId: string,
  phase: "priority" | "extended" | "archive"
): Promise<PhaseBackfillResult> {
  log.info(`Starting ${phase} phase backfill`, { accountId });

  // Get account
  const account = await db.query.emailAccount.findFirst({
    where: eq(emailAccount.id, accountId),
  });

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // Update status
  await db
    .update(emailAccount)
    .set({ status: "syncing", updatedAt: new Date() })
    .where(eq(emailAccount.id, accountId));

  try {
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

    // Get date range for phase
    const dateRange = getPhaseDateRange(phase);
    const concurrency = BACKFILL_CONCURRENCY[phase];

    // Execute provider-specific backfill
    let result: PhaseBackfillResult;

    const backfillConfig = {
      accountId,
      organizationId: account.organizationId,
      phase,
      afterDate: dateRange.afterDate,
      beforeDate: dateRange.beforeDate,
      batchSize: concurrency.batchSize,
      threadFetchConcurrency: concurrency.threadFetchConcurrency,
    };

    if (account.provider === "gmail") {
      result = await backfillGmailPhase(
        client as GmailEmailClient,
        backfillConfig,
        async (processed, total, estimated) => {
          await updatePhaseProgress(
            accountId,
            phase,
            processed,
            total,
            estimated
          );
        }
      );
    } else if (account.provider === "outlook") {
      result = await backfillOutlookPhase(
        client as OutlookEmailClient,
        backfillConfig,
        async (processed, total, estimated) => {
          await updatePhaseProgress(
            accountId,
            phase,
            processed,
            total,
            estimated
          );
        }
      );
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    // Handle phase completion
    if (result.phaseComplete) {
      await handlePhaseComplete(accountId, phase, result);
    }

    // Update account status
    await db
      .update(emailAccount)
      .set({
        status: "active",
        lastSyncAt: new Date(),
        lastSyncError: result.success ? null : result.errors[0]?.message,
        updatedAt: new Date(),
      })
      .where(eq(emailAccount.id, accountId));

    log.info(`${phase} phase backfill completed`, {
      accountId,
      ...result,
    });

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Update error state
    await db
      .update(emailAccount)
      .set({
        status: "active",
        lastSyncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(emailAccount.id, accountId));

    // Increment error count in progress
    const currentProgress = await getBackfillProgress(accountId);
    if (currentProgress) {
      await updateBackfillProgress(accountId, {
        ...currentProgress,
        lastError: errorMessage,
        errorCount: currentProgress.errorCount + 1,
      });
    }

    log.error(`${phase} phase backfill failed`, error, { accountId });

    return {
      success: false,
      jobId: crypto.randomUUID(),
      accountId,
      type: "backfill",
      phase,
      phaseComplete: false,
      threadsProcessed: 0,
      messagesProcessed: 0,
      newThreads: 0,
      updatedThreads: 0,
      newMessages: 0,
      updatedMessages: 0,
      errors: [
        { code: "PHASE_FAILED", message: errorMessage, retryable: true },
      ],
      duration: 0,
    };
  }
}

// =============================================================================
// PROGRESS TRACKING
// =============================================================================

/**
 * Update phase progress in database.
 */
async function updatePhaseProgress(
  accountId: string,
  phase: BackfillPhase,
  processed: number,
  total: number,
  estimatedSeconds?: number
): Promise<void> {
  const phaseProgress = total > 0 ? Math.round((processed / total) * 100) : 0;

  // Calculate overall progress (priority = 0-33%, extended = 33-66%, archive = 66-100%)
  const phaseWeights = {
    priority: 0,
    extended: 33,
    archive: 66,
    complete: 100,
    idle: 0,
  };
  const phaseContribution = {
    priority: 33,
    extended: 33,
    archive: 34,
    complete: 0,
    idle: 0,
  };
  const overallProgress =
    phaseWeights[phase] +
    Math.round((phaseProgress / 100) * phaseContribution[phase]);

  const currentProgress = await getBackfillProgress(accountId);

  await updateBackfillProgress(accountId, {
    ...currentProgress,
    phase,
    totalThreads: total,
    processedThreads: processed,
    phaseProgress,
    overallProgress,
    estimatedTimeRemaining: estimatedSeconds,
  } as BackfillProgress);
}

/**
 * Handle phase completion and trigger next phase.
 */
async function handlePhaseComplete(
  accountId: string,
  phase: "priority" | "extended" | "archive",
  result: PhaseBackfillResult
): Promise<void> {
  const currentProgress = await getBackfillProgress(accountId);
  const now = new Date().toISOString();

  // Update progress with completion timestamp
  const updates: Partial<BackfillProgress> = {
    ...currentProgress,
    totalMessages:
      (currentProgress?.totalMessages ?? 0) + result.messagesProcessed,
  };

  if (phase === "priority") {
    updates.priorityCompletedAt = now;
  } else if (phase === "extended") {
    updates.extendedCompletedAt = now;
  } else if (phase === "archive") {
    updates.archiveCompletedAt = now;
  }

  await updateBackfillProgress(accountId, updates as BackfillProgress);

  // Trigger next phase
  if (phase === "priority") {
    log.info("Priority phase complete, triggering extended phase", {
      accountId,
    });
    await updateBackfillProgress(accountId, {
      ...updates,
      phase: "extended",
      phaseStartedAt: now,
      processedThreads: 0,
      totalThreads: 0,
      phaseProgress: 0,
    } as BackfillProgress);
    await extendedBackfillTask.trigger({ accountId, phase: "extended" });
  } else if (phase === "extended") {
    log.info("Extended phase complete, triggering archive phase", {
      accountId,
    });
    await updateBackfillProgress(accountId, {
      ...updates,
      phase: "archive",
      phaseStartedAt: now,
      processedThreads: 0,
      totalThreads: 0,
      phaseProgress: 0,
    } as BackfillProgress);
    await archiveBackfillTask.trigger({ accountId, phase: "archive" });
  } else if (phase === "archive") {
    log.info("Archive phase complete, full backfill finished", { accountId });
    await updateBackfillProgress(accountId, {
      ...updates,
      phase: "complete",
      overallProgress: 100,
      phaseProgress: 100,
    } as BackfillProgress);

    // Set sync cursor for incremental sync
    // The cursor should have been set by the phase backfill
  }
}

/**
 * Get current backfill progress.
 */
async function getBackfillProgress(
  accountId: string
): Promise<BackfillProgress | null> {
  const account = await db.query.emailAccount.findFirst({
    where: eq(emailAccount.id, accountId),
    columns: { backfillProgress: true },
  });

  return (account?.backfillProgress as BackfillProgress) ?? null;
}

/**
 * Update backfill progress in database.
 */
async function updateBackfillProgress(
  accountId: string,
  progress: BackfillProgress
): Promise<void> {
  await db
    .update(emailAccount)
    .set({
      backfillProgress: progress,
      updatedAt: new Date(),
    })
    .where(eq(emailAccount.id, accountId));
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { PhaseBackfillPayload, BackfillOrchestratorPayload };
