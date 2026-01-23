// =============================================================================
// OUTLOOK OAUTH CALLBACK HANDLER
// =============================================================================

import { parseOAuthState } from "@memorystack/api/routers/email-accounts";
import {
  exchangeOutlookCode,
  getOutlookUserInfo,
  validateOutlookScopes,
} from "@memorystack/auth/providers";
import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const outlookOAuth = new Hono();

/**
 * Outlook OAuth callback handler
 * GET /api/oauth/outlook/callback
 *
 * This endpoint is called by Microsoft after user authorization.
 * It exchanges the authorization code for tokens and creates the email account.
 *
 * Email accounts are scoped to organizations, not individual users.
 */
outlookOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from Microsoft
  if (error) {
    log.warn("Outlook OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/email-accounts?error=${encodeURIComponent(error_description || error)}`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("Outlook OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/email-accounts?error=invalid_request`
    );
  }

  // Parse and validate state token
  const parsedState = parseOAuthState(state);

  if (!parsedState.isValid) {
    log.warn("Outlook OAuth invalid state", { state: state.substring(0, 20) });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/email-accounts?error=invalid_state`
    );
  }

  const { userId, organizationId, provider, redirectTo } = parsedState;

  // Use custom redirect or default - handle both paths and full URLs
  let redirectPath = redirectTo || "/dashboard/email-accounts";
  // If redirectTo is a full URL, extract just the pathname
  if (
    redirectPath.startsWith("http://") ||
    redirectPath.startsWith("https://")
  ) {
    try {
      const url = new URL(redirectPath);
      redirectPath = url.pathname + url.search;
    } catch {
      redirectPath = "/dashboard/email-accounts";
    }
  }

  if (provider !== "outlook") {
    log.warn("Outlook OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging Outlook authorization code", {
      userId,
      organizationId,
    });
    const tokens = await exchangeOutlookCode(code);

    // Validate scopes
    if (!validateOutlookScopes(tokens.scope)) {
      log.warn("Outlook OAuth insufficient scopes", {
        userId,
        organizationId,
        scopes: tokens.scope,
      });
      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?error=insufficient_scopes`
      );
    }

    // Get user info from Microsoft Graph
    const userInfo = await getOutlookUserInfo(tokens.accessToken);

    // Check if this email is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "email"),
        eq(sourceAccount.externalId, userInfo.email)
      ),
    });

    let accountId: string;

    if (existingAccount) {
      // Update existing account (reconnection)
      if (existingAccount.status === "revoked") {
        log.info("Reactivating revoked Outlook account", {
          userId,
          organizationId,
          email: userInfo.email,
        });
      } else {
        log.info("Updating existing Outlook account tokens", {
          userId,
          organizationId,
          email: userInfo.email,
        });
      }

      await db
        .update(sourceAccount)
        .set({
          accessToken: safeEncryptToken(tokens.accessToken),
          refreshToken: safeEncryptToken(tokens.refreshToken),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          status: "connected",
          displayName: userInfo.displayName,
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingAccount.id));

      accountId = existingAccount.id;
    } else {
      // Create new account for this organization
      log.info("Creating new Outlook account", {
        userId,
        organizationId,
        email: userInfo.email,
      });

      const result = await db
        .insert(sourceAccount)
        .values({
          organizationId,
          addedByUserId: userId,
          type: "email",
          provider: "outlook",
          externalId: userInfo.email,
          displayName: userInfo.displayName,
          accessToken: safeEncryptToken(tokens.accessToken),
          refreshToken: safeEncryptToken(tokens.refreshToken),
          tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
          status: "connected",
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 5,
          },
        })
        .returning({ id: sourceAccount.id });

      const newAccount = result[0];
      if (!newAccount) {
        throw new Error("Failed to create email account");
      }
      accountId = newAccount.id;
    }

    // Trigger initial sync job - starts multi-phase backfill orchestration
    try {
      await tasks.trigger("email-backfill-orchestrator", {
        accountId,
      });
      log.info("Triggered email backfill orchestrator", { accountId });
    } catch (triggerError) {
      // Don't fail the OAuth flow if trigger fails
      log.error("Failed to trigger email backfill orchestrator", triggerError, {
        accountId,
      });
    }

    // Redirect to success page
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&provider=outlook&accountId=${accountId}`
    );
  } catch (error) {
    log.error("Outlook OAuth callback error", error, {
      userId,
      organizationId,
    });

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMessage)}`
    );
  }
});

export { outlookOAuth };
