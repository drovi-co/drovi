import { processCreditPurchase } from "@memorystack/api/lib/credits";
import { env } from "@memorystack/env/server";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { Hono } from "hono";
import { log } from "../../lib/logger";

const polarWebhook = new Hono();

polarWebhook.post("/", async (c) => {
  const requestBody = await c.req.text();
  const webhookHeaders = {
    "webhook-id": c.req.header("webhook-id") ?? "",
    "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
    "webhook-signature": c.req.header("webhook-signature") ?? "",
  };

  let webhookPayload: ReturnType<typeof validateEvent>;
  try {
    webhookPayload = validateEvent(
      requestBody,
      webhookHeaders,
      env.POLAR_WEBHOOK_SECRET ?? ""
    );
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      log.warn("Polar webhook verification failed", { error: error.message });
      return c.json({ error: "Invalid webhook signature" }, 403);
    }
    throw error;
  }

  log.info("Polar webhook received", { type: webhookPayload.type });

  try {
    switch (webhookPayload.type) {
      case "checkout.created":
        // Checkout started - can log for analytics
        log.info("Checkout created", {
          checkoutId: webhookPayload.data.id,
          productId: webhookPayload.data.productId,
        });
        break;

      case "checkout.updated":
        // Checkout updated (e.g., payment processing)
        if (webhookPayload.data.status === "succeeded") {
          const metadata = webhookPayload.data.metadata as Record<
            string,
            string
          > | null;

          if (metadata?.organizationId && metadata?.credits) {
            const credits = Number.parseInt(metadata.credits, 10);

            if (!Number.isNaN(credits) && credits > 0) {
              await processCreditPurchase({
                organizationId: metadata.organizationId,
                credits,
                polarCheckoutId: webhookPayload.data.id,
                packageId: metadata.packageId,
              });

              log.info("Credit purchase processed", {
                organizationId: metadata.organizationId,
                credits,
                checkoutId: webhookPayload.data.id,
              });
            }
          }
        }
        break;

      case "subscription.created":
      case "subscription.updated":
        // Handle subscription changes for plan credits
        log.info("Subscription event", {
          subscriptionId: webhookPayload.data.id,
          status: webhookPayload.data.status,
        });
        break;

      case "subscription.canceled":
        log.info("Subscription canceled", {
          subscriptionId: webhookPayload.data.id,
        });
        break;

      default:
        log.debug("Unhandled webhook type", { type: webhookPayload.type });
    }

    return c.json({ received: true });
  } catch (error) {
    log.error("Error processing Polar webhook", error);
    return c.json({ error: "Webhook processing failed" }, 500);
  }
});

export { polarWebhook };
