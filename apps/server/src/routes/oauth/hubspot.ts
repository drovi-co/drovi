// =============================================================================
// HUBSPOT OAUTH HANDLER
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  exchangeHubSpotCode,
  getHubSpotAccountInfo,
  getHubSpotAuthorizationUrl,
  getHubSpotTokenInfo,
} from "@memorystack/auth/providers/hubspot";
import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const hubspotOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate HubSpot OAuth flow
 * GET /api/oauth/hubspot/authorize
 *
 * Query params:
 * - organizationId: The organization to connect HubSpot to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 */
hubspotOAuth.get("/authorize", async (c) => {
  const { organizationId, userId, redirect } = c.req.query();

  if (!organizationId) {
    return c.json({ error: "organizationId is required" }, 400);
  }

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  const redirectPath = redirect || "/dashboard/sources";

  try {
    // Create state token with user info
    const state = Buffer.from(
      JSON.stringify({
        organizationId,
        userId,
        provider: "hubspot",
        redirectTo: redirectPath,
        timestamp: Date.now(),
        nonce: randomUUID(),
      })
    ).toString("base64url");

    // Generate HubSpot authorization URL
    const authorizationUrl = getHubSpotAuthorizationUrl(state);

    log.info("Initiating HubSpot OAuth flow", { organizationId });

    return c.redirect(authorizationUrl);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Failed to initiate HubSpot OAuth", { error: errorMsg });

    if (
      errorMsg.includes("not configured") ||
      errorMsg.includes("HUBSPOT_CLIENT")
    ) {
      return c.json(
        {
          error: "HubSpot integration not configured",
          message:
            "Please contact your administrator to set up HubSpot integration.",
          details:
            "Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET environment variables.",
        },
        503
      );
    }

    return c.json(
      { error: "Failed to initiate HubSpot authorization", message: errorMsg },
      500
    );
  }
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * HubSpot OAuth callback handler
 * GET /api/oauth/hubspot/callback
 *
 * This endpoint is called by HubSpot after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
hubspotOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from HubSpot
  if (error) {
    log.warn("HubSpot OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error_description || error)}&source=hubspot`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("HubSpot OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=hubspot`
    );
  }

  // Parse state
  let parsedState: {
    organizationId: string;
    userId: string;
    provider: string;
    redirectTo: string;
    timestamp: number;
    nonce: string;
  };

  try {
    parsedState = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    log.warn("HubSpot OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=hubspot`
    );
  }

  const { organizationId, userId, provider, redirectTo } = parsedState;

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

  if (provider !== "hubspot") {
    log.warn("HubSpot OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=hubspot`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("HubSpot OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=hubspot`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging HubSpot authorization code", { organizationId });
    const tokens = await exchangeHubSpotCode(code);

    // Get token info (includes hub ID and user info)
    const tokenInfo = await getHubSpotTokenInfo(tokens.access_token);

    // Get account info
    let accountInfo: Awaited<ReturnType<typeof getHubSpotAccountInfo>> | null =
      null;
    try {
      accountInfo = await getHubSpotAccountInfo(tokens.access_token);
    } catch (e) {
      log.warn("Failed to get HubSpot account info", { error: e });
    }

    // Use HubSpot portal ID as the external ID
    const externalId = tokenInfo.hubId.toString();
    const displayName = `HubSpot (${tokenInfo.hubDomain || tokenInfo.user})`;

    // Check if this HubSpot portal is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "crm_hubspot"),
        eq(sourceAccount.externalId, externalId)
      ),
    });

    // Encrypt tokens
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token);
    const encryptedRefreshToken = await safeEncryptToken(tokens.refresh_token);

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    if (existingAccount) {
      // Update existing account
      log.info("Updating existing HubSpot account", {
        organizationId,
        externalId,
        accountId: existingAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          tokenExpiresAt,
          status: "connected" as const,
          displayName,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 60,
            customSettings: {
              hubId: tokenInfo.hubId,
              hubDomain: tokenInfo.hubDomain,
              userId: tokenInfo.userId,
              userEmail: tokenInfo.user,
              scopes: tokenInfo.scopes,
              accountType: accountInfo?.accountType,
              timeZone: accountInfo?.timeZone,
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
        log.warn("Failed to trigger HubSpot sync", { error: e });
      }

      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?success=true&source=hubspot`
      );
    }

    // Create new source account
    log.info("Creating new HubSpot source account", {
      organizationId,
      externalId,
      hubDomain: tokenInfo.hubDomain,
    });

    const result = await db
      .insert(sourceAccount)
      .values({
        organizationId,
        addedByUserId: userId,
        type: "crm_hubspot" as const,
        provider: "hubspot",
        externalId,
        displayName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt,
        status: "connected" as const,
        settings: {
          syncEnabled: true,
          syncFrequencyMinutes: 60,
          crmSettings: {
            pushEnabled: false, // Disabled by default, user can enable
            syncDirection: "pull",
          },
          customSettings: {
            hubId: tokenInfo.hubId,
            hubDomain: tokenInfo.hubDomain,
            userId: tokenInfo.userId,
            userEmail: tokenInfo.user,
            scopes: tokenInfo.scopes,
            accountType: accountInfo?.accountType,
            timeZone: accountInfo?.timeZone,
          },
        },
      })
      .returning({ id: sourceAccount.id });

    const newAccount = result[0];
    if (!newAccount) {
      throw new Error("Failed to create HubSpot account");
    }

    // Trigger initial sync
    try {
      await tasks.trigger("crm-sync", {
        sourceAccountId: newAccount.id,
        forceFull: true,
      });
      log.info("Triggered initial HubSpot sync", {
        sourceAccountId: newAccount.id,
      });
    } catch (e) {
      log.warn("Failed to trigger initial HubSpot sync", { error: e });
    }

    log.info("HubSpot account connected successfully", {
      organizationId,
      externalId,
      sourceAccountId: newAccount.id,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=hubspot`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("HubSpot OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=hubspot`
    );
  }
});

export { hubspotOAuth };
