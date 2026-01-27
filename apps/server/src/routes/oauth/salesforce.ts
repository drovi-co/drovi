// =============================================================================
// SALESFORCE OAUTH HANDLER
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  exchangeSalesforceCode,
  getSalesforceAuthorizationUrl,
  getSalesforceUserInfo,
} from "@memorystack/auth/providers/salesforce";
import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const salesforceOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate Salesforce OAuth flow
 * GET /api/oauth/salesforce/authorize
 *
 * Query params:
 * - organizationId: The organization to connect Salesforce to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 * - sandbox: Optional flag to use Salesforce sandbox environment
 */
salesforceOAuth.get("/authorize", async (c) => {
  const { organizationId, userId, redirect, sandbox } = c.req.query();

  if (!organizationId) {
    return c.json({ error: "organizationId is required" }, 400);
  }

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  const redirectPath = redirect || "/dashboard/sources";
  const useSandbox = sandbox === "true";

  try {
    // Create state token with user info
    const state = Buffer.from(
      JSON.stringify({
        organizationId,
        userId,
        provider: "salesforce",
        redirectTo: redirectPath,
        useSandbox,
        timestamp: Date.now(),
        nonce: randomUUID(),
      })
    ).toString("base64url");

    // Generate Salesforce authorization URL
    const authorizationUrl = getSalesforceAuthorizationUrl(state, {
      useSandbox,
      prompt: "consent",
    });

    log.info("Initiating Salesforce OAuth flow", {
      organizationId,
      useSandbox,
    });

    return c.redirect(authorizationUrl);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Failed to initiate Salesforce OAuth", { error: errorMsg });

    if (
      errorMsg.includes("not configured") ||
      errorMsg.includes("SALESFORCE_CLIENT")
    ) {
      return c.json(
        {
          error: "Salesforce integration not configured",
          message:
            "Please contact your administrator to set up Salesforce integration.",
          details:
            "Missing SALESFORCE_CLIENT_ID or SALESFORCE_CLIENT_SECRET environment variables.",
        },
        503
      );
    }

    return c.json(
      {
        error: "Failed to initiate Salesforce authorization",
        message: errorMsg,
      },
      500
    );
  }
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * Salesforce OAuth callback handler
 * GET /api/oauth/salesforce/callback
 *
 * This endpoint is called by Salesforce after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
salesforceOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from Salesforce
  if (error) {
    log.warn("Salesforce OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error_description || error)}&source=salesforce`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("Salesforce OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=salesforce`
    );
  }

  // Parse state
  let parsedState: {
    organizationId: string;
    userId: string;
    provider: string;
    redirectTo: string;
    useSandbox: boolean;
    timestamp: number;
    nonce: string;
  };

  try {
    parsedState = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    log.warn("Salesforce OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=salesforce`
    );
  }

  const { organizationId, userId, provider, redirectTo, useSandbox } =
    parsedState;

  // Use custom redirect or default
  let redirectPath = redirectTo || "/dashboard/sources";
  if (
    redirectPath.startsWith("http://") ||
    redirectPath.startsWith("https://")
  ) {
    try {
      const url = new URL(redirectPath);
      redirectPath = url.pathname + url.search;
    } catch {
      redirectPath = "/dashboard/sources";
    }
  }

  if (provider !== "salesforce") {
    log.warn("Salesforce OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=salesforce`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("Salesforce OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=salesforce`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging Salesforce authorization code", { organizationId });
    const tokens = await exchangeSalesforceCode(code, { useSandbox });

    // Get user info
    const userInfo = await getSalesforceUserInfo(
      tokens.access_token,
      tokens.instance_url
    );

    // Use Salesforce org ID as the external ID
    const externalId = userInfo.organizationId;
    const displayName = `Salesforce (${userInfo.username})`;

    // Check if this Salesforce org is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "crm_salesforce"),
        eq(sourceAccount.externalId, externalId)
      ),
    });

    // Encrypt tokens
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token);
    const encryptedRefreshToken = await safeEncryptToken(tokens.refresh_token);

    if (existingAccount) {
      // Update existing account
      log.info("Updating existing Salesforce account", {
        organizationId,
        externalId,
        accountId: existingAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          status: "connected" as const,
          displayName,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 60,
            customSettings: {
              instanceUrl: tokens.instance_url,
              userId: userInfo.userId,
              username: userInfo.username,
              useSandbox,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingAccount.id));

      // Trigger sync
      try {
        await tasks.trigger("crm-sync", {
          sourceAccountId: existingAccount.id,
          forceFull: true,
        });
      } catch (e) {
        log.warn("Failed to trigger Salesforce sync", { error: e });
      }

      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?success=true&source=salesforce`
      );
    }

    // Create new source account
    log.info("Creating new Salesforce source account", {
      organizationId,
      externalId,
      username: userInfo.username,
    });

    const result = await db
      .insert(sourceAccount)
      .values({
        organizationId,
        addedByUserId: userId,
        type: "crm_salesforce" as const,
        provider: "salesforce",
        externalId,
        displayName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        status: "connected" as const,
        settings: {
          syncEnabled: true,
          syncFrequencyMinutes: 60,
          crmSettings: {
            pushEnabled: false, // Disabled by default, user can enable
            syncDirection: "pull",
            instanceUrl: tokens.instance_url,
          },
          customSettings: {
            userId: userInfo.userId,
            username: userInfo.username,
            useSandbox,
          },
        },
      })
      .returning({ id: sourceAccount.id });

    const newAccount = result[0];
    if (!newAccount) {
      throw new Error("Failed to create Salesforce account");
    }

    // Trigger initial sync
    try {
      await tasks.trigger("crm-sync", {
        sourceAccountId: newAccount.id,
        forceFull: true,
      });
      log.info("Triggered initial Salesforce sync", {
        sourceAccountId: newAccount.id,
      });
    } catch (e) {
      log.warn("Failed to trigger initial Salesforce sync", { error: e });
    }

    log.info("Salesforce account connected successfully", {
      organizationId,
      externalId,
      sourceAccountId: newAccount.id,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=salesforce`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Salesforce OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=salesforce`
    );
  }
});

export { salesforceOAuth };
