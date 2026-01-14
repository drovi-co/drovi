// =============================================================================
// TOKEN REFRESH TRIGGER.DEV TASK
// =============================================================================
//
// Scheduled task that proactively refreshes OAuth tokens before expiration.
// Runs every 5 minutes to check for tokens expiring in the next 10 minutes.
//

import {
  refreshGmailToken,
  refreshOutlookToken,
} from "@memorystack/auth/providers";
import { db } from "@memorystack/db";
import { emailAccount } from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { safeDecryptToken, safeEncryptToken } from "../lib/crypto/tokens";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface RefreshResult {
  accountId: string;
  email: string;
  provider: "gmail" | "outlook";
  success: boolean;
  error?: string;
  requiresReconnection?: boolean;
}

// =============================================================================
// TOKEN REFRESH TASK
// =============================================================================

/**
 * Refresh OAuth tokens for accounts that are about to expire.
 */
export const tokenRefreshTask = task({
  id: "token-refresh",
  queue: {
    name: "token-management",
    concurrencyLimit: 5,
  },
  run: async (payload: { accountId?: string }) => {
    const results: RefreshResult[] = [];

    // If a specific account is provided, only refresh that one
    if (payload.accountId) {
      const account = await db.query.emailAccount.findFirst({
        where: eq(emailAccount.id, payload.accountId),
      });

      if (account) {
        const result = await refreshAccountToken(account);
        results.push(result);
      }

      return { refreshed: results };
    }

    // Otherwise, find all accounts with tokens expiring in the next 10 minutes
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);
    const now = new Date();

    const accountsToRefresh = await db.query.emailAccount.findMany({
      where: and(
        or(
          eq(emailAccount.status, "active"),
          eq(emailAccount.status, "syncing")
        ),
        lt(emailAccount.tokenExpiresAt, tenMinutesFromNow),
        gt(emailAccount.tokenExpiresAt, now) // Don't try to refresh already-expired tokens
      ),
    });

    log.info("Found accounts needing token refresh", {
      count: accountsToRefresh.length,
    });

    // Refresh each account
    for (const account of accountsToRefresh) {
      const result = await refreshAccountToken(account);
      results.push(result);

      // Small delay between requests to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Log summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const needsReconnection = results.filter(
      (r) => r.requiresReconnection
    ).length;

    log.info("Token refresh batch completed", {
      total: results.length,
      successful,
      failed,
      needsReconnection,
    });

    return {
      refreshed: results,
      summary: {
        total: results.length,
        successful,
        failed,
        needsReconnection,
      },
    };
  },
});

/**
 * Refresh token for a single account
 */
async function refreshAccountToken(
  account: typeof emailAccount.$inferSelect
): Promise<RefreshResult> {
  const result: RefreshResult = {
    accountId: account.id,
    email: account.email,
    provider: account.provider as "gmail" | "outlook",
    success: false,
  };

  try {
    // Decrypt the refresh token
    const refreshToken = safeDecryptToken(account.refreshToken);

    // Refresh based on provider
    let newAccessToken: string;
    let newRefreshToken: string;
    let expiresIn: number;

    if (account.provider === "gmail") {
      const tokens = await refreshGmailToken(refreshToken);
      newAccessToken = tokens.accessToken;
      newRefreshToken = refreshToken; // Gmail doesn't rotate refresh tokens
      expiresIn = tokens.expiresIn;
    } else if (account.provider === "outlook") {
      const tokens = await refreshOutlookToken(refreshToken);
      newAccessToken = tokens.accessToken;
      newRefreshToken = tokens.refreshToken; // Outlook may rotate refresh tokens
      expiresIn = tokens.expiresIn;
    } else {
      throw new Error(`Unsupported provider: ${account.provider}`);
    }

    // Update the account with new tokens
    await db
      .update(emailAccount)
      .set({
        accessToken: safeEncryptToken(newAccessToken),
        refreshToken: safeEncryptToken(newRefreshToken),
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(emailAccount.id, account.id));

    log.info("Token refreshed successfully", {
      accountId: account.id,
      email: account.email,
      provider: account.provider,
      expiresIn,
    });

    result.success = true;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    log.error("Token refresh failed", error, {
      accountId: account.id,
      email: account.email,
      provider: account.provider,
    });

    result.error = errorMessage;

    // Check if this is an auth error that requires reconnection
    const isAuthError =
      errorMessage.includes("invalid_grant") ||
      errorMessage.includes("Token has been expired or revoked") ||
      errorMessage.includes("refresh_token") ||
      errorMessage.includes("unauthorized");

    if (isAuthError) {
      result.requiresReconnection = true;

      // Mark the account as expired
      await db
        .update(emailAccount)
        .set({
          status: "expired",
          lastSyncError: "Token refresh failed - reconnection required",
          updatedAt: new Date(),
        })
        .where(eq(emailAccount.id, account.id));

      log.warn("Account marked as expired - requires reconnection", {
        accountId: account.id,
        email: account.email,
      });
    }
  }

  return result;
}

// =============================================================================
// SCHEDULED TRIGGER
// =============================================================================

/**
 * Schedule token refresh to run every 5 minutes
 */
export const tokenRefreshSchedule = schedules.task({
  id: "token-refresh-schedule",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async () => {
    log.info("Starting scheduled token refresh");
    await tokenRefreshTask.trigger({});
    return { scheduled: true };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type { RefreshResult };
