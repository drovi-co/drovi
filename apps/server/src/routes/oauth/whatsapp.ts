// =============================================================================
// WHATSAPP OAUTH HANDLER
// =============================================================================

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  exchangeWhatsAppCode,
  getWhatsAppAuthorizationUrl,
  getWhatsAppBusinessAccounts,
  getWhatsAppPhoneNumbers,
} from "@memorystack/auth/providers/whatsapp";
import { db } from "@memorystack/db";
import {
  sourceAccount,
  whatsappBusinessAccount,
  whatsappPhoneNumber,
} from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { tasks } from "@trigger.dev/sdk";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { safeEncryptToken } from "../../lib/crypto/tokens";
import { log } from "../../lib/logger";

// =============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify the webhook signature from Meta
 * Uses HMAC-SHA256 to verify the request came from Meta
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  appSecret: string
): boolean {
  if (!signature) {
    return false;
  }

  // Signature format: "sha256=<hex_digest>"
  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const providedHash = signature.slice(expectedPrefix.length);
  const expectedHash = createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(providedHash, "hex"),
      Buffer.from(expectedHash, "hex")
    );
  } catch {
    // If buffers are different lengths, timingSafeEqual throws
    return false;
  }
}

const whatsappOAuth = new Hono();

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Initiate WhatsApp OAuth flow
 * GET /api/oauth/whatsapp/authorize
 *
 * Query params:
 * - organizationId: The organization to connect WhatsApp to
 * - userId: The user initiating the connection
 * - redirect: Optional custom redirect URL after auth
 */
whatsappOAuth.get("/authorize", async (c) => {
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
      provider: "whatsapp",
      redirectTo: redirect || "/dashboard/sources",
      timestamp: Date.now(),
      nonce: randomUUID(),
    })
  ).toString("base64url");

  // Generate WhatsApp authorization URL
  const authorizationUrl = getWhatsAppAuthorizationUrl(state);

  log.info("Initiating WhatsApp OAuth flow", { organizationId });

  return c.redirect(authorizationUrl);
});

// =============================================================================
// CALLBACK ENDPOINT
// =============================================================================

/**
 * WhatsApp OAuth callback handler
 * GET /api/oauth/whatsapp/callback
 *
 * This endpoint is called by Meta after user authorization.
 * It exchanges the authorization code for tokens and creates the source account.
 */
whatsappOAuth.get("/callback", async (c) => {
  const { code, state, error, error_description } = c.req.query();

  // Handle OAuth errors from Meta
  if (error) {
    log.warn("WhatsApp OAuth error", { error, error_description });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=${encodeURIComponent(error_description || error)}&source=whatsapp`
    );
  }

  // Validate required parameters
  if (!(code && state)) {
    log.warn("WhatsApp OAuth callback missing parameters", {
      hasCode: !!code,
      hasState: !!state,
    });
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_request&source=whatsapp`
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
    log.warn("WhatsApp OAuth invalid state encoding");
    return c.redirect(
      `${env.CORS_ORIGIN}/dashboard/sources?error=invalid_state&source=whatsapp`
    );
  }

  const { organizationId, userId, provider, redirectTo } = parsedState;

  // Use custom redirect or default
  const redirectPath = redirectTo || "/dashboard/sources";

  if (provider !== "whatsapp") {
    log.warn("WhatsApp OAuth state has wrong provider", { provider });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=invalid_provider&source=whatsapp`
    );
  }

  // Validate state timestamp (10 minute expiry)
  if (Date.now() - parsedState.timestamp > 10 * 60 * 1000) {
    log.warn("WhatsApp OAuth state expired");
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=state_expired&source=whatsapp`
    );
  }

  try {
    // Exchange code for tokens
    log.info("Exchanging WhatsApp authorization code", { organizationId });
    const tokens = await exchangeWhatsAppCode(code);

    // Get WhatsApp Business Accounts
    log.info("Fetching WhatsApp Business Accounts", { organizationId });
    const wabaAccounts = await getWhatsAppBusinessAccounts(tokens.access_token);

    if (wabaAccounts.length === 0) {
      log.warn("No WhatsApp Business Accounts found", { organizationId });
      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?error=no_whatsapp_accounts&source=whatsapp`
      );
    }

    // Use the first WABA (or could let user choose)
    const waba = wabaAccounts[0];
    if (!waba) {
      // This should never happen due to the length check above, but TypeScript needs assurance
      return c.redirect(
        `${env.CORS_ORIGIN}${redirectPath}?error=no_whatsapp_accounts&source=whatsapp`
      );
    }

    // Check if this WABA is already connected to this organization
    const existingSourceAccount = await db.query.sourceAccount.findFirst({
      where: and(
        eq(sourceAccount.organizationId, organizationId),
        eq(sourceAccount.type, "whatsapp"),
        eq(sourceAccount.externalId, waba.id)
      ),
    });

    // Encrypt access token
    const encryptedAccessToken = await safeEncryptToken(tokens.access_token);

    let sourceAccountId: string;

    if (existingSourceAccount) {
      // Update existing account
      sourceAccountId = existingSourceAccount.id;
      log.info("Updating existing WhatsApp account", {
        organizationId,
        wabaId: waba.id,
        accountId: existingSourceAccount.id,
      });

      await db
        .update(sourceAccount)
        .set({
          accessToken: encryptedAccessToken,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          status: "connected" as const,
          displayName: waba.name,
          settings: {
            syncEnabled: true,
            syncFrequencyMinutes: 5,
            customSettings: {
              wabaId: waba.id,
              messageTemplateNamespace: waba.message_template_namespace,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, existingSourceAccount.id));
    } else {
      // Create new source account
      sourceAccountId = randomUUID();

      log.info("Creating new WhatsApp source account", {
        organizationId,
        wabaId: waba.id,
        wabaName: waba.name,
      });

      await db.insert(sourceAccount).values({
        id: sourceAccountId,
        organizationId,
        addedByUserId: userId,
        type: "whatsapp" as const,
        provider: "meta",
        externalId: waba.id,
        displayName: waba.name,
        accessToken: encryptedAccessToken,
        tokenExpiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        status: "connected" as const,
        settings: {
          syncEnabled: true,
          syncFrequencyMinutes: 5,
          customSettings: {
            wabaId: waba.id,
            messageTemplateNamespace: waba.message_template_namespace,
          },
        },
      });

      // Create WABA record
      await db.insert(whatsappBusinessAccount).values({
        sourceAccountId,
        wabaId: waba.id,
        name: waba.name,
        timezoneId: waba.timezone_id,
        messageTemplateNamespace: waba.message_template_namespace,
      });

      // Get phone numbers
      const phoneNumbers = await getWhatsAppPhoneNumbers(
        waba.id,
        tokens.access_token
      );

      // Get WABA record ID
      const wabaRecord = await db.query.whatsappBusinessAccount.findFirst({
        where: and(
          eq(whatsappBusinessAccount.sourceAccountId, sourceAccountId),
          eq(whatsappBusinessAccount.wabaId, waba.id)
        ),
        columns: { id: true },
      });

      if (wabaRecord && phoneNumbers.length > 0) {
        // Insert phone numbers
        await db.insert(whatsappPhoneNumber).values(
          phoneNumbers.map((pn) => ({
            wabaId: wabaRecord.id,
            phoneNumberId: pn.id,
            displayPhoneNumber: pn.display_phone_number,
            verifiedName: pn.verified_name,
            qualityRating: pn.quality_rating,
            codeVerificationStatus: pn.code_verification_status,
          }))
        );
      }
    }

    // Trigger initial sync
    try {
      await tasks.trigger("whatsapp-sync", {
        sourceAccountId,
        fullSync: true,
      });
      log.info("Triggered initial WhatsApp sync", { sourceAccountId });
    } catch (e) {
      log.warn("Failed to trigger initial WhatsApp sync", { error: e });
    }

    log.info("WhatsApp account connected successfully", {
      organizationId,
      wabaId: waba.id,
      wabaName: waba.name,
      sourceAccountId,
    });

    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?success=true&source=whatsapp`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error("WhatsApp OAuth callback error", { error: errorMsg });
    return c.redirect(
      `${env.CORS_ORIGIN}${redirectPath}?error=${encodeURIComponent(errorMsg)}&source=whatsapp`
    );
  }
});

// =============================================================================
// WEBHOOK ENDPOINT
// =============================================================================

/**
 * WhatsApp webhook verification
 * GET /api/oauth/whatsapp/webhook
 *
 * Meta sends a verification request when setting up webhooks.
 */
whatsappOAuth.get("/webhook", async (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  // Check if this is a verification request
  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    log.info("WhatsApp webhook verified");
    return c.text(challenge ?? "");
  }

  log.warn("WhatsApp webhook verification failed", { mode, token });
  return c.json({ error: "Verification failed" }, 403);
});

/**
 * WhatsApp webhook handler
 * POST /api/oauth/whatsapp/webhook
 *
 * Receives incoming messages and status updates from WhatsApp.
 */
whatsappOAuth.post("/webhook", async (c) => {
  // Get the raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Hub-Signature-256");

  // Verify webhook signature if app secret is configured
  if (env.WHATSAPP_APP_SECRET) {
    if (!verifyWebhookSignature(rawBody, signature, env.WHATSAPP_APP_SECRET)) {
      log.warn("WhatsApp webhook signature verification failed", {
        hasSignature: !!signature,
      });
      return c.json({ error: "Invalid signature" }, 401);
    }
  } else {
    log.warn(
      "WhatsApp webhook received without signature verification - WHATSAPP_APP_SECRET not configured"
    );
  }

  // Parse the payload from raw body
  const payload = JSON.parse(rawBody);

  log.info("WhatsApp webhook received", {
    object: payload.object,
    entries: payload.entry?.length ?? 0,
  });

  // Process webhook events
  if (payload.object === "whatsapp_business_account") {
    for (const entry of payload.entry ?? []) {
      const changes = entry.changes ?? [];

      for (const change of changes) {
        if (change.field === "messages") {
          const value = change.value;

          // Process incoming messages
          if (value.messages) {
            for (const message of value.messages) {
              log.info("WhatsApp message received", {
                from: message.from,
                type: message.type,
                messageId: message.id,
              });

              // Trigger message processing
              try {
                await tasks.trigger("whatsapp-message-received", {
                  wabaId: entry.id,
                  phoneNumberId: value.metadata.phone_number_id,
                  message,
                  contacts: value.contacts,
                });
              } catch (e) {
                log.warn("Failed to trigger WhatsApp message processing", {
                  error: e,
                });
              }
            }
          }

          // Process status updates
          if (value.statuses) {
            for (const status of value.statuses) {
              log.info("WhatsApp status update", {
                messageId: status.id,
                status: status.status,
                recipientId: status.recipient_id,
              });
            }
          }
        }
      }
    }
  }

  // Always return 200 to acknowledge receipt
  return c.json({ success: true });
});

export { whatsappOAuth };
