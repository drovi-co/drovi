// =============================================================================
// NOTION OAUTH HANDLER
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  exchangeNotionCode,
  getNotionAuthorizationUrl,
} from "@memorystack/auth/providers/notion";
import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const notionOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate Notion OAuth flow
 * GET /api/oauth/notion/authorize
 *
 * Query params:
 * - organizationId: The organization to connect Notion to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 */
notionOAuth.get("/authorize", async (c) => {
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
        provider: "notion",
        redirectTo: redirectPath,
        timestamp: Date.now(),
        nonce: randomUUID(),
      })
    ).toString("base64url");

    // Generate Notion authorization URL
    const authorizationUrl = getNotionAuthorizationUrl(state);

    log.info("Initiating Notion OAuth flow", { organizationId });

    return c.redirect(authorizationUrl);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Failed to initiate Notion OAuth", { error: errorMsg });

    // Check if it's a configuration error
    if (
      errorMsg.includes("not configured") ||
      errorMsg.includes("NOTION_CLIENT")
    ) {
      return c.json(
        {
          error: "Notion integration not configured",
          message:
            "Please contact your administrator to set up Notion integration.",
          details:
            "Missing NOTION_CLIENT_ID or NOTION_CLIENT_SECRET environment variables.",
        },
        503
      );
    }

    return c.json(
      { error: "Failed to initiate Notion authorization", message: errorMsg },
      500
    );
  }
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * Notion OAuth callback handler
 * GET /api/oauth/notion/callback
 *
 * This endpoint is called by Notion after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
notionOAuth.get("/callback", async (c) => {
  const { code, state, error } = c.req.query();

  // Handle OAuth errors from Notion
  if (error) {
    log.warn("Notion OAuth error", { error });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error)}&source=notion`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("Notion OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=notion`
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
    log.warn("Notion OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=notion`
    );
  }

  const { organizationId, userId, provider, redirectTo } = parsedState;

  // Use custom redirect or default - handle both paths and full URLs
  let redirectPath = redirectTo || "/dashboard/sources";
  // If redirectTo is a full URL, extract just the pathname
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

  if (provider !== "notion") {
    log.warn("Notion OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=notion`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("Notion OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=notion`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging Notion authorization code", { organizationId });
    const tokens = await exchangeNotionCode(code);

    // Extract workspace info from response
    const workspaceId = tokens.workspace_id;
    const workspaceName = tokens.workspace_name ?? "Notion Workspace";
    const botId = tokens.bot_id;
    const ownerId = tokens.owner?.user?.id;
    const ownerEmail = tokens.owner?.user?.person?.email;

    // Check if this workspace is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "notion"),
        eq(sourceAccount.externalId, workspaceId)
      ),
    });

    // Encrypt tokens
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token);

    if (existingAccount) {
      // Update existing account
      log.info("Updating existing Notion account", {
        organizationId,
        workspaceId,
        accountId: existingAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          status: "connected" as const,
          displayName: workspaceName,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 15,
            customSettings: {
              botId,
              ownerId,
              ownerEmail,
              workspaceIcon: tokens.workspace_icon,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingAccount.id));

      // Trigger sync
      try {
        await tasks.trigger("notion-sync", {
          sourceAccountId: existingAccount.id,
          fullSync: true,
        });
      } catch (e) {
        log.warn("Failed to trigger Notion sync", { error: e });
      }

      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?success=true&source=notion`
      );
    }

    // Create new source account
    log.info("Creating new Notion source account", {
      organizationId,
      workspaceId,
      workspaceName,
    });

    await db.insert(sourceAccount).values({
      organizationId,
      addedByUserId: userId,
      type: "notion" as const,
      provider: "notion",
      externalId: workspaceId,
      displayName: workspaceName,
      accessToken: encryptedAccessToken,
      status: "connected" as const,
      settings: {
        syncEnabled: true,
        syncFrequencyMinutes: 15,
        customSettings: {
          botId,
          ownerId,
          ownerEmail,
          workspaceIcon: tokens.workspace_icon,
        },
      },
    });

    // Get the created account ID
    const createdAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "notion"),
        eq(sourceAccount.externalId, workspaceId)
      ),
      columns: { id: true },
    });

    const newSourceAccountId = createdAccount?.id;

    if (newSourceAccountId) {
      // Trigger initial sync
      try {
        await tasks.trigger("notion-sync", {
          sourceAccountId: newSourceAccountId,
          fullSync: true,
        });
        log.info("Triggered initial Notion sync", {
          sourceAccountId: newSourceAccountId,
        });
      } catch (e) {
        log.warn("Failed to trigger initial Notion sync", { error: e });
      }
    }

    log.info("Notion account connected successfully", {
      organizationId,
      workspaceId,
      workspaceName,
      sourceAccountId: newSourceAccountId,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=notion`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Notion OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=notion`
    );
  }
});

export { notionOAuth };
