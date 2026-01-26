// =============================================================================
// CRM SYNC TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for synchronizing contacts with CRM systems:
// - Salesforce
// - HubSpot
// - Pipedrive
//
// Follows the same pattern as email-sync, slack-sync, etc.
//

import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { createCRMProvider } from "../lib/crm";
import type { CRMProvider, CRMPushResult, CRMSyncResult } from "../lib/crm/types";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface CRMSyncPayload {
  sourceAccountId: string;
  forceFull?: boolean;
}

interface CRMPushPayload {
  sourceAccountId: string;
  contactIds?: string[];
}

interface BatchCRMSyncResult {
  success: boolean;
  total: number;
  synced: number;
  contactsProcessed: number;
  errors: string[];
}

// =============================================================================
// CRM SYNC TASKS
// =============================================================================

/**
 * Sync contacts from a CRM source account.
 */
export const syncCRMTask = task({
  id: "crm-sync",
  queue: {
    name: "crm-sync",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes
  run: async (payload: CRMSyncPayload): Promise<CRMSyncResult> => {
    const { sourceAccountId, forceFull = false } = payload;

    log.info("Starting CRM sync", { sourceAccountId, forceFull });

    try {
      const provider = await createCRMProvider(sourceAccountId);
      const result = await provider.syncContacts({
        forceFull,
      });

      log.info("CRM sync completed", {
        sourceAccountId,
        provider: result.provider,
        contactsProcessed: result.contactsProcessed,
        contactsCreated: result.contactsCreated,
        contactsUpdated: result.contactsUpdated,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      log.error("CRM sync failed", error, { sourceAccountId });

      return {
        success: false,
        jobId: crypto.randomUUID(),
        sourceAccountId,
        provider: "salesforce" as CRMProvider, // Will be overwritten
        direction: "pull",
        contactsProcessed: 0,
        contactsCreated: 0,
        contactsUpdated: 0,
        contactsMerged: 0,
        contactsSkipped: 0,
        errors: [
          {
            code: "SYNC_TASK_FAILED",
            message: errorMessage,
            retryable: true,
          },
        ],
        duration: 0,
      };
    }
  },
});

/**
 * Push intelligence data back to CRM.
 */
export const pushCRMTask = task({
  id: "crm-push",
  queue: {
    name: "crm-sync",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 300, // 5 minutes
  run: async (payload: CRMPushPayload): Promise<CRMPushResult> => {
    const { sourceAccountId, contactIds } = payload;

    log.info("Starting CRM push", { sourceAccountId, contactIds: contactIds?.length });

    try {
      const provider = await createCRMProvider(sourceAccountId);
      const result = await provider.pushIntelligence({
        contactIds,
      });

      log.info("CRM push completed", {
        sourceAccountId,
        provider: result.provider,
        contactsPushed: result.contactsPushed,
        contactsFailed: result.contactsFailed,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      log.error("CRM push failed", error, { sourceAccountId });

      return {
        success: false,
        jobId: crypto.randomUUID(),
        sourceAccountId,
        provider: "salesforce" as CRMProvider,
        contactsPushed: 0,
        contactsFailed: 0,
        errors: [
          {
            code: "PUSH_TASK_FAILED",
            message: errorMessage,
            retryable: true,
          },
        ],
        duration: 0,
      };
    }
  },
});

// =============================================================================
// BATCH SYNC TASKS
// =============================================================================

/**
 * Batch sync all CRM accounts for an organization.
 */
export const batchSyncCRMTask = task({
  id: "crm-batch-sync",
  queue: {
    name: "crm-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 1800, // 30 minutes
  run: async (payload: {
    organizationId?: string;
    forceFull?: boolean;
  }): Promise<BatchCRMSyncResult> => {
    const { organizationId, forceFull = false } = payload;

    log.info("Starting batch CRM sync", { organizationId, forceFull });

    // Get all CRM source accounts
    const crmAccounts = await db.query.sourceAccount.findMany({
      where: and(
        inArray(sourceAccount.type, [
          "crm_salesforce",
          "crm_hubspot",
          "crm_pipedrive",
        ]),
        eq(sourceAccount.status, "connected"),
        organizationId ? eq(sourceAccount.organizationId, organizationId) : undefined
      ),
    });

    if (crmAccounts.length === 0) {
      log.info("No CRM accounts found", { organizationId });
      return {
        success: true,
        total: 0,
        synced: 0,
        contactsProcessed: 0,
        errors: [],
      };
    }

    log.info("Found CRM accounts", { count: crmAccounts.length });

    const errors: string[] = [];
    let synced = 0;
    let totalContactsProcessed = 0;

    // Sync each account sequentially to avoid overwhelming CRM APIs
    for (const account of crmAccounts) {
      try {
        const result = await syncCRMTask.triggerAndWait({
          sourceAccountId: account.id,
          forceFull,
        });

        if (result.ok && result.output.success) {
          synced++;
          totalContactsProcessed += result.output.contactsProcessed;
        } else if (result.ok) {
          errors.push(`${account.id}: ${result.output.errors.map((e) => e.message).join(", ")}`);
        } else {
          errors.push(`${account.id}: Task failed`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${account.id}: ${errorMsg}`);
      }
    }

    log.info("Batch CRM sync completed", {
      total: crmAccounts.length,
      synced,
      totalContactsProcessed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: crmAccounts.length,
      synced,
      contactsProcessed: totalContactsProcessed,
      errors,
    };
  },
});

/**
 * Batch push intelligence to all CRM accounts for an organization.
 */
export const batchPushCRMTask = task({
  id: "crm-batch-push",
  queue: {
    name: "crm-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 1800, // 30 minutes
  run: async (payload: {
    organizationId?: string;
  }): Promise<BatchCRMSyncResult> => {
    const { organizationId } = payload;

    log.info("Starting batch CRM push", { organizationId });

    // Get all CRM source accounts with push enabled
    const crmAccounts = await db.query.sourceAccount.findMany({
      where: and(
        inArray(sourceAccount.type, [
          "crm_salesforce",
          "crm_hubspot",
          "crm_pipedrive",
        ]),
        eq(sourceAccount.status, "connected"),
        organizationId ? eq(sourceAccount.organizationId, organizationId) : undefined
      ),
    });

    // Filter to accounts with push enabled
    const pushEnabledAccounts = crmAccounts.filter(
      (account) => (account.settings as { pushEnabled?: boolean } | null)?.pushEnabled
    );

    if (pushEnabledAccounts.length === 0) {
      log.info("No CRM accounts with push enabled", { organizationId });
      return {
        success: true,
        total: 0,
        synced: 0,
        contactsProcessed: 0,
        errors: [],
      };
    }

    log.info("Found CRM accounts with push enabled", {
      count: pushEnabledAccounts.length,
    });

    const errors: string[] = [];
    let synced = 0;
    let totalContactsPushed = 0;

    for (const account of pushEnabledAccounts) {
      try {
        const result = await pushCRMTask.triggerAndWait({
          sourceAccountId: account.id,
        });

        if (result.ok && result.output.success) {
          synced++;
          totalContactsPushed += result.output.contactsPushed;
        } else if (result.ok) {
          errors.push(`${account.id}: ${result.output.errors.map((e) => e.message).join(", ")}`);
        } else {
          errors.push(`${account.id}: Task failed`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push(`${account.id}: ${errorMsg}`);
      }
    }

    log.info("Batch CRM push completed", {
      total: pushEnabledAccounts.length,
      synced,
      totalContactsPushed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: pushEnabledAccounts.length,
      synced,
      contactsProcessed: totalContactsPushed,
      errors,
    };
  },
});

// =============================================================================
// SCHEDULED TASKS
// =============================================================================

/**
 * Hourly CRM sync schedule.
 */
export const crmSyncSchedule = schedules.task({
  id: "crm-sync-scheduled",
  cron: "0 * * * *", // Every hour
  run: async () => {
    log.info("Running scheduled CRM sync");

    const result = await batchSyncCRMTask.triggerAndWait({
      forceFull: false,
    });

    log.info("Scheduled CRM sync completed", result);

    return result;
  },
});

/**
 * Daily CRM push schedule (push intelligence back to CRMs).
 */
export const crmPushSchedule = schedules.task({
  id: "crm-push-scheduled",
  cron: "0 6 * * *", // 6 AM UTC daily
  run: async () => {
    log.info("Running scheduled CRM push");

    const result = await batchPushCRMTask.triggerAndWait({});

    log.info("Scheduled CRM push completed", result);

    return result;
  },
});

// =============================================================================
// ON-DEMAND SYNC (triggered by user)
// =============================================================================

/**
 * Trigger on-demand CRM sync for a specific account.
 */
export const onDemandCRMSyncTask = task({
  id: "crm-sync-on-demand",
  queue: {
    name: "crm-sync",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 1, // No retry for on-demand
  },
  maxDuration: 600,
  run: async (payload: {
    sourceAccountId: string;
    userId: string;
    forceFull?: boolean;
  }): Promise<CRMSyncResult> => {
    const { sourceAccountId, userId, forceFull = false } = payload;

    log.info("Starting on-demand CRM sync", {
      sourceAccountId,
      userId,
      forceFull,
    });

    // Verify account exists and user has access
    const account = await db.query.sourceAccount.findFirst({
      where: eq(sourceAccount.id, sourceAccountId),
    });

    if (!account) {
      throw new Error("Source account not found");
    }

    // Trigger the actual sync
    const result = await syncCRMTask.triggerAndWait({
      sourceAccountId,
      forceFull,
    });

    if (!result.ok) {
      throw new Error("CRM sync task failed");
    }

    return result.output;
  },
});
