// =============================================================================
// GMAIL WATCH RENEWAL TRIGGER.DEV TASK
// =============================================================================
//
// Scheduled task that renews Gmail Watch subscriptions before they expire.
// Gmail Watch expires after 7 days, so we renew watches expiring within 24 hours.
//

import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, or } from "drizzle-orm";
import { safeDecryptToken } from "../lib/crypto/tokens";
import { GmailEmailClient } from "../lib/email-client";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface WatchRenewalResult {
  sourceAccountId: string;
  email: string;
  success: boolean;
  newExpiration?: string;
  historyId?: string;
  error?: string;
}

// =============================================================================
// WATCH RENEWAL TASK
// =============================================================================

/**
 * Renew Gmail Watch subscriptions for accounts with expiring watches.
 */
export const watchRenewalTask = task({
  id: "watch-renewal",
  queue: {
    name: "email-sync",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  run: async (payload: {
    sourceAccountId?: string;
  }): Promise<{
    results: WatchRenewalResult[];
    summary: { total: number; successful: number; failed: number };
  }> => {
    const results: WatchRenewalResult[] = [];

    // Skip if Pub/Sub topic not configured
    if (!env.GMAIL_PUBSUB_TOPIC) {
      log.info("Gmail Pub/Sub topic not configured - skipping watch renewal");
      return {
        results: [],
        summary: { total: 0, successful: 0, failed: 0 },
      };
    }

    // Find accounts that need watch renewal
    let accountsToRenew: Awaited<
      ReturnType<typeof db.query.sourceAccount.findMany>
    >;

    if (payload.sourceAccountId) {
      // Renew specific account
      const account = await db.query.sourceAccount.findFirst({
        where: and(
          eq(sourceAccount.id, payload.sourceAccountId),
          eq(sourceAccount.type, "email"),
          eq(sourceAccount.provider, "gmail")
        ),
      });
      accountsToRenew = account ? [account] : [];
    } else {
      // Find Gmail accounts with watches expiring in the next 24 hours
      const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      accountsToRenew = await db.query.sourceAccount.findMany({
        where: and(
          eq(sourceAccount.type, "email"),
          eq(sourceAccount.provider, "gmail"),
          or(
            eq(sourceAccount.status, "connected"),
            eq(sourceAccount.status, "syncing")
          )
        ),
      });

      // Filter to accounts with expiring or missing watches
      accountsToRenew = accountsToRenew.filter((account) => {
        const settings = account.settings as {
          watchExpiration?: string;
        } | null;
        if (!settings?.watchExpiration) {
          // No watch set up - needs renewal
          return true;
        }
        const expiration = new Date(settings.watchExpiration);
        // Expiring within 24 hours
        return expiration < oneDayFromNow;
      });
    }

    log.info("Found accounts needing watch renewal", {
      count: accountsToRenew.length,
    });

    // Renew each watch
    for (const account of accountsToRenew) {
      const result = await renewAccountWatch(account);
      results.push(result);

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Log summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    log.info("Watch renewal batch completed", {
      total: results.length,
      successful,
      failed,
    });

    return {
      results,
      summary: {
        total: results.length,
        successful,
        failed,
      },
    };
  },
});

/**
 * Renew watch for a single account
 */
async function renewAccountWatch(
  account: typeof sourceAccount.$inferSelect
): Promise<WatchRenewalResult> {
  const email = account.externalId; // externalId contains the email for email accounts

  const result: WatchRenewalResult = {
    sourceAccountId: account.id,
    email,
    success: false,
  };

  try {
    // Decrypt tokens
    const accessToken = safeDecryptToken(account.accessToken ?? "");
    const refreshToken = safeDecryptToken(account.refreshToken ?? "");

    // Setup new watch
    const client = new GmailEmailClient(
      email,
      accessToken,
      refreshToken,
      account.tokenExpiresAt ?? new Date()
    );
    const watchResult = await client.setupWatch(
      env.GMAIL_PUBSUB_TOPIC as string
    );

    // Update account with new watch info
    // Note: We update syncCursor only if it's not already set (initial setup)
    // During normal operation, the sync task manages syncCursor
    const currentSettings =
      (account.settings as unknown as Record<string, unknown>) ?? {};
    const updateData: Record<string, unknown> = {
      settings: {
        ...currentSettings,
        watchExpiration: watchResult.expiration,
      },
      updatedAt: new Date(),
    };

    // Only update syncCursor if not already set
    if (!account.syncCursor) {
      updateData.syncCursor = watchResult.historyId;
    }

    await db
      .update(sourceAccount)
      .set(updateData)
      .where(eq(sourceAccount.id, account.id));

    log.info("Watch renewed successfully", {
      sourceAccountId: account.id,
      email,
      expiration: watchResult.expiration,
      historyId: watchResult.historyId,
    });

    result.success = true;
    result.newExpiration = watchResult.expiration;
    result.historyId = watchResult.historyId;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    log.error("Watch renewal failed", error, {
      sourceAccountId: account.id,
      email,
    });

    result.error = errorMessage;

    // Check if this is an auth error
    const isAuthError =
      errorMessage.includes("401") ||
      errorMessage.includes("invalid_grant") ||
      errorMessage.includes("Token has been expired");

    if (isAuthError) {
      log.warn(
        "Watch renewal failed due to auth error - may need reconnection",
        {
          sourceAccountId: account.id,
          email,
        }
      );
    }
  }

  return result;
}

// =============================================================================
// SCHEDULED TRIGGER
// =============================================================================

/**
 * Schedule watch renewal to run every 6 hours.
 * Gmail Watch expires after 7 days, so checking 4x daily ensures we catch any
 * expiring watches well before they expire.
 */
export const watchRenewalSchedule = schedules.task({
  id: "watch-renewal-schedule",
  cron: "0 */6 * * *", // Every 6 hours (at minute 0)
  run: async () => {
    log.info("Starting scheduled watch renewal");
    await watchRenewalTask.trigger({});
    return { scheduled: true };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type { WatchRenewalResult };
