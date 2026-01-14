import { createHmac, randomBytes } from "node:crypto";
import { db } from "@memorystack/db";
import { webhook, webhookDelivery } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// Available webhook events
export const WEBHOOK_EVENTS = [
  "user.created",
  "user.updated",
  "user.deleted",
  "organization.created",
  "organization.updated",
  "organization.deleted",
  "member.invited",
  "member.joined",
  "member.removed",
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
] as const;

const eventSchema = z.enum(WEBHOOK_EVENTS);

/**
 * Generate a webhook signature for payload verification
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const signaturePayload = `${timestamp}.${payload}`;
  return createHmac("sha256", secret).update(signaturePayload).digest("hex");
}

/**
 * Generate a secure webhook secret
 */
function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export const webhooksRouter = router({
  /**
   * List all webhooks for the current user
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const webhooks = await db.query.webhook.findMany({
      where: eq(webhook.userId, userId),
      orderBy: [desc(webhook.createdAt)],
    });

    return webhooks.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events,
      enabled: w.enabled,
      failureCount: Number.parseInt(w.failureCount ?? "0", 10),
      lastTriggeredAt: w.lastTriggeredAt,
      lastSuccessAt: w.lastSuccessAt,
      lastFailureAt: w.lastFailureAt,
      createdAt: w.createdAt,
    }));
  }),

  /**
   * Get a single webhook with its secret
   */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.id), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      return {
        id: wh.id,
        name: wh.name,
        url: wh.url,
        secret: wh.secret,
        events: wh.events,
        enabled: wh.enabled,
        failureCount: Number.parseInt(wh.failureCount ?? "0", 10),
        lastTriggeredAt: wh.lastTriggeredAt,
        lastSuccessAt: wh.lastSuccessAt,
        lastFailureAt: wh.lastFailureAt,
        createdAt: wh.createdAt,
      };
    }),

  /**
   * Create a new webhook
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        url: z.string().url(),
        events: z.array(eventSchema).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check webhook limit (max 10 per user)
      const existingWebhooks = await db.query.webhook.findMany({
        where: eq(webhook.userId, userId),
      });

      if (existingWebhooks.length >= 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maximum of 10 webhooks allowed per user",
        });
      }

      const id = crypto.randomUUID();
      const secret = generateWebhookSecret();

      await db.insert(webhook).values({
        id,
        userId,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        enabled: true,
      });

      return {
        id,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        enabled: true,
        createdAt: new Date(),
      };
    }),

  /**
   * Update a webhook
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        url: z.string().url().optional(),
        events: z.array(eventSchema).min(1).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.id), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      const updates: Partial<typeof webhook.$inferInsert> = {};
      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.url !== undefined) {
        updates.url = input.url;
      }
      if (input.events !== undefined) {
        updates.events = input.events;
      }
      if (input.enabled !== undefined) {
        updates.enabled = input.enabled;
      }

      await db.update(webhook).set(updates).where(eq(webhook.id, input.id));

      return { success: true };
    }),

  /**
   * Delete a webhook
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.id), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      await db.delete(webhook).where(eq(webhook.id, input.id));

      return { success: true };
    }),

  /**
   * Regenerate webhook secret
   */
  regenerateSecret: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.id), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      const newSecret = generateWebhookSecret();

      await db
        .update(webhook)
        .set({ secret: newSecret })
        .where(eq(webhook.id, input.id));

      return { secret: newSecret };
    }),

  /**
   * Get webhook delivery history
   */
  getDeliveries: protectedProcedure
    .input(
      z.object({
        webhookId: z.string(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify webhook ownership
      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.webhookId), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      const deliveries = await db.query.webhookDelivery.findMany({
        where: eq(webhookDelivery.webhookId, input.webhookId),
        orderBy: [desc(webhookDelivery.createdAt)],
        limit: input.limit,
      });

      return deliveries.map((d) => ({
        id: d.id,
        event: d.event,
        statusCode: d.statusCode,
        success: d.success,
        duration: d.duration,
        attempts: Number.parseInt(d.attempts ?? "1", 10),
        createdAt: d.createdAt,
      }));
    }),

  /**
   * Test webhook by sending a test event
   */
  test: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const wh = await db.query.webhook.findFirst({
        where: and(eq(webhook.id, input.id), eq(webhook.userId, userId)),
      });

      if (!wh) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook not found",
        });
      }

      // Send test webhook
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = JSON.stringify({
        event: "test",
        timestamp: new Date().toISOString(),
        data: {
          message: "This is a test webhook event",
        },
      });

      const signature = generateWebhookSignature(payload, wh.secret, timestamp);

      const startTime = Date.now();
      let statusCode: string | undefined;
      let success = false;
      let responseBody: string | undefined;

      try {
        const response = await fetch(wh.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": `t=${timestamp},v1=${signature}`,
            "X-Webhook-Event": "test",
          },
          body: payload,
        });

        statusCode = String(response.status);
        success = response.ok;
        responseBody = await response.text().catch(() => undefined);
      } catch (error) {
        statusCode = "0";
        responseBody = error instanceof Error ? error.message : "Unknown error";
      }

      const duration = String(Date.now() - startTime);

      // Log the delivery
      await db.insert(webhookDelivery).values({
        id: crypto.randomUUID(),
        webhookId: wh.id,
        event: "test",
        payload,
        statusCode,
        responseBody: responseBody?.slice(0, 1000),
        duration,
        success,
      });

      return {
        success,
        statusCode,
        duration: Number.parseInt(duration, 10),
        responseBody: responseBody?.slice(0, 500),
      };
    }),

  /**
   * Get available webhook events
   */
  getAvailableEvents: protectedProcedure.query(() => {
    return WEBHOOK_EVENTS.map((event) => ({
      event,
      category: event.split(".")[0],
      action: event.split(".")[1],
    }));
  }),
});
