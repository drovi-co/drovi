// =============================================================================
// GMAIL PUSH NOTIFICATION WEBHOOK
// =============================================================================
//
// Receives push notifications from Google Pub/Sub when Gmail changes occur.
// Triggers instant incremental sync for affected accounts.
//
// Setup requires:
// 1. Google Cloud Pub/Sub topic configured
// 2. Push subscription pointing to this endpoint
// 3. Gmail Watch API registered for each email account
//

import { db } from "@memorystack/db";
import { sourceAccount } from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { log } from "../../lib/logger";
import { syncEmailsOnDemandTask } from "../../trigger/email-sync";

const gmailWebhook = new Hono();

// =============================================================================
// TYPES
// =============================================================================

interface PubSubMessage {
  message: {
    data: string; // Base64 encoded
    messageId: string;
    publishTime: string;
    attributes?: Record<string, string>;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

// =============================================================================
// WEBHOOK HANDLER
// =============================================================================

gmailWebhook.post("/", async (c) => {
  // Verify webhook secret if configured
  const authHeader = c.req.header("Authorization");
  if (env.GMAIL_WEBHOOK_SECRET) {
    const expectedToken = `Bearer ${env.GMAIL_WEBHOOK_SECRET}`;
    if (authHeader !== expectedToken) {
      log.warn("Gmail webhook unauthorized - invalid token");
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  let body: PubSubMessage;
  try {
    body = await c.req.json();
  } catch {
    log.warn("Gmail webhook - invalid JSON body");
    return c.json({ error: "Invalid request body" }, 400);
  }

  // Validate Pub/Sub message structure
  if (!body.message?.data) {
    log.warn("Gmail webhook - missing message data");
    return c.json({ error: "Missing message data" }, 400);
  }

  // Decode the base64 message data
  let notification: GmailNotification;
  try {
    const decodedData = Buffer.from(body.message.data, "base64").toString(
      "utf-8"
    );
    notification = JSON.parse(decodedData);
  } catch {
    log.warn("Gmail webhook - failed to decode message data");
    return c.json({ error: "Invalid message data" }, 400);
  }

  const { emailAddress, historyId } = notification;

  if (!(emailAddress && historyId)) {
    log.warn("Gmail webhook - missing emailAddress or historyId", {
      hasEmail: !!emailAddress,
      hasHistoryId: !!historyId,
    });
    return c.json({ error: "Missing required fields" }, 400);
  }

  log.info("Gmail push notification received", {
    emailAddress,
    historyId,
    messageId: body.message.messageId,
  });

  // Find the email account by email address
  const account = await db.query.sourceAccount.findFirst({
    where: and(
      eq(sourceAccount.type, "email"),
      eq(sourceAccount.externalId, emailAddress)
    ),
    columns: {
      id: true,
      status: true,
      organizationId: true,
    },
  });

  if (!account) {
    log.warn("Gmail webhook - account not found", { emailAddress });
    // Return 200 to acknowledge receipt (don't retry for unknown accounts)
    return c.json({
      received: true,
      skipped: true,
      reason: "account_not_found",
    });
  }

  if (account.status !== "connected" && account.status !== "syncing") {
    log.info("Gmail webhook - account not active", {
      emailAddress,
      status: account.status,
    });
    return c.json({
      received: true,
      skipped: true,
      reason: "account_inactive",
    });
  }

  // Trigger instant sync with debouncing
  // Note: We don't update syncCursor here - the sync task will handle cursor management
  // The historyId in the notification tells us changes occurred, but we still need to
  // fetch all changes since our last known cursor
  // Using debounce to avoid triggering multiple syncs for rapid notifications
  try {
    await syncEmailsOnDemandTask.trigger(
      { sourceAccountId: account.id },
      {
        debounce: {
          key: `gmail-push-${account.id}`,
          delay: "2s", // Wait 2 seconds to batch rapid notifications
          mode: "trailing", // Use the latest historyId
        },
      }
    );

    log.info("Gmail push sync triggered", {
      accountId: account.id,
      emailAddress,
      historyId,
    });
  } catch (error) {
    log.error("Failed to trigger Gmail push sync", error, {
      accountId: account.id,
      emailAddress,
    });
    // Still return 200 to prevent Pub/Sub retries for trigger failures
  }

  return c.json({ received: true, triggered: true });
});

// =============================================================================
// VERIFICATION ENDPOINT
// =============================================================================

// Google Cloud Pub/Sub may send GET requests for subscription verification
gmailWebhook.get("/", (c) => {
  return c.json({ status: "ok", service: "gmail-push-notifications" });
});

export { gmailWebhook };
