import { createHash, randomBytes } from "node:crypto";
import { db } from "@memorystack/db";
import { apiKey } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// Generate a secure API key
function generateApiKey(): { key: string; prefix: string; hash: string } {
  // Generate 32 random bytes and encode as base64
  const keyBytes = randomBytes(32);
  const key = `lm_${keyBytes.toString("base64url")}`;
  const prefix = key.slice(0, 11); // "lm_" + first 8 chars
  const hash = createHash("sha256").update(key).digest("hex");
  return { key, prefix, hash };
}

// Verify an API key
export function verifyApiKey(key: string, hash: string): boolean {
  const computedHash = createHash("sha256").update(key).digest("hex");
  return computedHash === hash;
}

const scopeSchema = z.enum([
  "read:data",
  "write:data",
  "read:analytics",
  "admin",
]);

export const apiKeysRouter = router({
  /**
   * List all API keys for the current user
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const keys = await db.query.apiKey.findMany({
      where: eq(apiKey.userId, userId),
      orderBy: [desc(apiKey.createdAt)],
    });

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      rateLimit: k.rateLimit,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
    }));
  }),

  /**
   * Create a new API key
   * Returns the full key only once - it cannot be retrieved again
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        scopes: z.array(scopeSchema).optional(),
        expiresInDays: z.number().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check existing keys limit (max 10 per user)
      const existingKeys = await db.query.apiKey.findMany({
        where: eq(apiKey.userId, userId),
      });

      if (existingKeys.length >= 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maximum of 10 API keys allowed per user",
        });
      }

      // Generate the key
      const { key, prefix, hash } = generateApiKey();
      const id = crypto.randomUUID();

      // Calculate expiration
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Create the key
      await db.insert(apiKey).values({
        id,
        userId,
        name: input.name,
        keyHash: hash,
        keyPrefix: prefix,
        scopes: input.scopes ?? ["read:data"],
        expiresAt,
      });

      // Return the full key - this is the only time it will be shown
      return {
        id,
        name: input.name,
        key, // Full key - show only once!
        keyPrefix: prefix,
        scopes: input.scopes ?? ["read:data"],
        expiresAt,
        createdAt: new Date(),
      };
    }),

  /**
   * Delete an API key
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const key = await db.query.apiKey.findFirst({
        where: (k, { and, eq }) =>
          and(eq(k.id, input.id), eq(k.userId, userId)),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      await db.delete(apiKey).where(eq(apiKey.id, input.id));

      return { success: true };
    }),

  /**
   * Regenerate an API key (creates new key with same settings)
   */
  regenerate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Find existing key
      const existingKey = await db.query.apiKey.findFirst({
        where: (k, { and, eq }) =>
          and(eq(k.id, input.id), eq(k.userId, userId)),
      });

      if (!existingKey) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      // Generate new key
      const { key, prefix, hash } = generateApiKey();

      // Update the key
      await db
        .update(apiKey)
        .set({
          keyHash: hash,
          keyPrefix: prefix,
          lastUsedAt: null,
        })
        .where(eq(apiKey.id, input.id));

      return {
        id: input.id,
        name: existingKey.name,
        key, // Full key - show only once!
        keyPrefix: prefix,
        scopes: existingKey.scopes,
        expiresAt: existingKey.expiresAt,
      };
    }),

  /**
   * Update API key metadata (name, scopes)
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        scopes: z.array(scopeSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify ownership
      const key = await db.query.apiKey.findFirst({
        where: (k, { and, eq }) =>
          and(eq(k.id, input.id), eq(k.userId, userId)),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      const updates: Partial<typeof apiKey.$inferInsert> = {};
      if (input.name) {
        updates.name = input.name;
      }
      if (input.scopes) {
        updates.scopes = input.scopes;
      }

      await db.update(apiKey).set(updates).where(eq(apiKey.id, input.id));

      return { success: true };
    }),
});
