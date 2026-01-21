// =============================================================================
// GOOGLE DOCS OAUTH HANDLER
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  exchangeGoogleDocsCode,
  getGoogleDocsAuthorizationUrl,
  testGoogleDocsAuth,
} from "@memorystack/auth/providers/google-docs";
import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

const googleDocsOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate Google Docs OAuth flow
 * GET /api/oauth/google-docs/authorize
 *
 * Query params:
 * - organizationId: The organization to connect Google Docs to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 */
googleDocsOAuth.get("/authorize", async (c) => {
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
      provider: "google_docs",
      redirectTo: redirect || "/dashboard/sources",
      timestamp: Date.now(),
      nonce: randomUUID(),
    })
  ).toString("base64url");

  // Generate Google authorization URL
  const authorizationUrl = getGoogleDocsAuthorizationUrl(state, {
    forceConsent: true, // Ensure we get a refresh token
  });

  log.info("Initiating Google Docs OAuth flow", { organizationId });

  return c.redirect(authorizationUrl);
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * Google Docs OAuth callback handler
 * GET /api/oauth/google-docs/callback
 *
 * This endpoint is called by Google after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
googleDocsOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from Google
  if (error) {
    log.warn("Google Docs OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error_description || error)}&source=google_docs`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("Google Docs OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=google_docs`
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
    log.warn("Google Docs OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=google_docs`
    );
  }

  const { organizationId, userId, provider, redirectTo } = parsedState;

  // Use custom redirect or default - handle both paths and full URLs
  let redirectPath = redirectTo || "/dashboard/sources";
  // If redirectTo is a full URL, extract just the pathname
  if (redirectPath.startsWith("http://") || redirectPath.startsWith("https://")) {
    try {
      const url = new URL(redirectPath);
      redirectPath = url.pathname + url.search;
    } catch {
      redirectPath = "/dashboard/sources";
    }
  }

  if (provider !== "google_docs") {
    log.warn("Google Docs OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=google_docs`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("Google Docs OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=google_docs`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging Google Docs authorization code", { organizationId });
    const tokens = await exchangeGoogleDocsCode(code);

    // Get user info
    const userInfo = await testGoogleDocsAuth(tokens.access_token);

    const userEmail = userInfo.email;
    const userName = userInfo.name;
    const googleUserId = userInfo.id;

    // Check if this Google account is already connected to this organization
    const existingAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "google_docs"),
        eq(sourceAccount.externalId, userEmail)
      ),
    });

    // Encrypt tokens
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? await safeEncryptToken(tokens.refresh_token)
      : null;

    if (existingAccount) {
      // Update existing account
      log.info("Updating existing Google Docs account", {
        organizationId,
        googleUserId,
        accountId: existingAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken ?? existingAccount.refreshToken,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          status: "connected" as const,
          displayName: userName ?? userEmail,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 15,
            customSettings: {
              googleUserId,
              scopes: tokens.scope?.split(" ") ?? [],
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingAccount.id));

      // Trigger sync
      try {
        await tasks.trigger("google-docs-sync", {
          sourceAccountId: existingAccount.id,
          fullSync: true,
        });
      } catch (e) {
        log.warn("Failed to trigger Google Docs sync", { error: e });
      }

      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?success=true&source=google_docs`
      );
    }

    // Create new source account
    log.info("Creating new Google Docs source account", {
      organizationId,
      googleUserId,
      userEmail,
    });

    await db.insert(sourceAccount).values({
      organizationId,
      addedByUserId: userId,
      type: "google_docs" as const,
      provider: "google",
      externalId: userEmail, // Use email as externalId for Google
      displayName: userName ?? userEmail,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      status: "connected" as const,
      settings: {
        syncEnabled: true,
        syncFrequencyMinutes: 15,
        customSettings: {
          googleUserId,
          userEmail,
          scopes: tokens.scope?.split(" ") ?? [],
        },
      },
    });

    // Get the created account ID
    const createdAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "google_docs"),
        eq(sourceAccount.externalId, userEmail)
      ),
      columns: { id: true },
    });

    const newSourceAccountId = createdAccount?.id;

    if (newSourceAccountId) {
      // Trigger initial sync
      try {
        await tasks.trigger("google-docs-sync", {
          sourceAccountId: newSourceAccountId,
          fullSync: true,
        });
        log.info("Triggered initial Google Docs sync", {
          sourceAccountId: newSourceAccountId,
        });
      } catch (e) {
        log.warn("Failed to trigger initial Google Docs sync", { error: e });
      }
    }

    log.info("Google Docs account connected successfully", {
      organizationId,
      googleUserId,
      userEmail,
      sourceAccountId: newSourceAccountId,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=google_docs`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("Google Docs OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=google_docs`
    );
  }
});

export { googleDocsOAuth };
