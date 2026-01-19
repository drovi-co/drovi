// =============================================================================
// SLACK OAUTH HANDLER
// =============================================================================

import {
  exchangeSlackCode,
  getSlackAuthorizationUrl,
} from "@memorystack/auth/providers/slack";
import { db } from "@memorystack/db";
import { slackTeam, sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const slackOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate Slack OAuth flow
 * GET /api/oauth/slack/authorize
 *
 * Query params:
 * - organizationId: The organization to connect Slack to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 */
slackOAuth.get("/authorize", async (c) => {
  const { organizationId, userId, redirect } = c.req.query();

  if (!organizationId) {
    return c.json({ error: "organizationId is required" }, 400);
  }

  if (!userId) {
    return c.json({ error: "userId is required" }, 400);
  }

  // Create state token with user info
  const state = Buffer.from(
    JSON.stringify({
      organizationId,
      userId,
      provider: "slack",
      redirectTo: redirect || "/dashboard/sources",
      timestamp: Date.now(),
      nonce: randomUUID(),
    })
  ).toString("base64url");

  // Generate Slack authorization URL
  const authorizationUrl = getSlackAuthorizationUrl(state, {
    team: undefined, // Allow user to choose workspace
  });

  log.info("Initiating Slack OAuth flow", { organizationId });

  return c.redirect(authorizationUrl);
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * Slack OAuth callback handler
 * GET /api/oauth/slack/callback
 *
 * This endpoint is called by Slack after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
slackOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from Slack
  if (error) {
    log.warn("Slack OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error_description || error)}&source=slack`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("Slack OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=slack`
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
    log.warn("Slack OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=slack`
    );
  }

  const { organizationId, userId, provider, redirectTo } = parsedState;

  // Use custom redirect or default
  const redirectPath = redirectTo || "/dashboard/sources";

  if (provider !== "slack") {
    log.warn("Slack OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=slack`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("Slack OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=slack`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging Slack authorization code", { organizationId });
    const tokens = await exchangeSlackCode(code);

    if (!tokens.ok) {
      log.error("Slack token exchange failed", { error: tokens.error });
      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(tokens.error ?? "token_exchange_failed")}&source=slack`
      );
    }

    // Extract team and user info from response
    const teamId = tokens.team?.id ?? "";
    const teamName = tokens.team?.name ?? "Slack Workspace";
    const botUserId = tokens.bot_user_id ?? "";
    const authedUserId = tokens.authed_user?.id ?? "";

    // Check if this workspace is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "slack"),
        eq(sourceAccount.externalId, teamId)
      ),
    });

    // Encrypt tokens
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token ?? "");

    if (existingAccount) {
      // Update existing account
      log.info("Updating existing Slack account", {
        organizationId,
        teamId,
        accountId: existingAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          status: "connected" as const,
          displayName: teamName,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 5,
            syncDirectMessages: true,
            syncPrivateChannels: false,
            customSettings: {
              botUserId,
              authedUserId,
              scopes: tokens.scope?.split(",") ?? [],
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingAccount.id));

      // Trigger sync
      try {
        await tasks.trigger("slack-sync", {
          sourceAccountId: existingAccount.id,
          fullSync: true,
        });
      } catch (e) {
        log.warn("Failed to trigger Slack sync", { error: e });
      }

      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?success=true&source=slack`
      );
    }

    // Create new source account
    const sourceAccountId = randomUUID();

    log.info("Creating new Slack source account", {
      organizationId,
      teamId,
      teamName,
    });

    await db.insert(sourceAccount).values({
      organizationId,
      addedByUserId: userId,
      type: "slack" as const,
      provider: "slack",
      externalId: teamId,
      displayName: teamName,
      accessToken: encryptedAccessToken,
      status: "connected" as const,
      settings: {
        syncEnabled: true,
        syncFrequencyMinutes: 5,
        syncDirectMessages: true,
        syncPrivateChannels: false,
        customSettings: {
          botUserId,
          authedUserId,
          scopes: tokens.scope?.split(",") ?? [],
        },
      },
    });

    // Get the created account ID
    const createdAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "slack"),
        eq(sourceAccount.externalId, teamId)
      ),
      columns: { id: true },
    });

    const newSourceAccountId = createdAccount?.id ?? sourceAccountId;

    // Create team record
    await db.insert(slackTeam).values({
      sourceAccountId: newSourceAccountId,
      slackTeamId: teamId,
      name: teamName,
      isEnterpriseInstall: tokens.is_enterprise_install ?? false,
      enterpriseId: tokens.enterprise?.id,
      enterpriseName: tokens.enterprise?.name,
    });

    // Trigger initial sync
    try {
      await tasks.trigger("slack-sync", {
        sourceAccountId: newSourceAccountId,
        fullSync: true,
      });
      log.info("Triggered initial Slack sync", { sourceAccountId: newSourceAccountId });
    } catch (e) {
      log.warn("Failed to trigger initial Slack sync", { error: e });
    }

    log.info("Slack account connected successfully", {
      organizationId,
      teamId,
      teamName,
      sourceAccountId: newSourceAccountId,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=slack`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Slack OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=slack`
    );
  }
});

export { slackOAuth };
