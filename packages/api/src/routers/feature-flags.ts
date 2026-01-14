import { db } from "@memorystack/db";
import { featureFlag } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import {
  createFeatureFlag,
  deleteFeatureFlag,
  getAllFeatureFlags,
  isFeatureEnabled,
  updateFeatureFlag,
} from "../lib/feature-flags";

export const featureFlagsRouter = router({
  /**
   * Check if a feature is enabled for the current user
   */
  isEnabled: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ ctx, input }) => {
      const enabled = await isFeatureEnabled(input.key, {
        userId: ctx.session.user.id,
        organizationId: ctx.session.session.activeOrganizationId ?? undefined,
      });

      return { enabled };
    }),

  /**
   * Get all feature flags with their status for the current user
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    return await getAllFeatureFlags({
      userId: ctx.session.user.id,
      organizationId: ctx.session.session.activeOrganizationId ?? undefined,
    });
  }),

  /**
   * List all feature flags (admin only)
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    // Check if user is admin
    if (ctx.session.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required",
      });
    }

    const flags = await db.query.featureFlag.findMany({
      orderBy: [desc(featureFlag.createdAt)],
    });

    return flags.map((f) => ({
      id: f.id,
      key: f.key,
      name: f.name,
      description: f.description,
      enabled: f.enabled,
      percentage: Number.parseInt(f.percentage ?? "0", 10),
      allowedUsers: f.allowedUsers ?? [],
      allowedOrganizations: f.allowedOrganizations ?? [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    }));
  }),

  /**
   * Create a feature flag (admin only)
   */
  create: protectedProcedure
    .input(
      z.object({
        key: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9_-]+$/),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        enabled: z.boolean().default(false),
        percentage: z.number().min(0).max(100).default(0),
        allowedUsers: z.array(z.string()).optional(),
        allowedOrganizations: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is admin
      if (ctx.session.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      // Check if key already exists
      const existing = await db.query.featureFlag.findFirst({
        where: eq(featureFlag.key, input.key),
      });

      if (existing) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A feature flag with this key already exists",
        });
      }

      return createFeatureFlag(input);
    }),

  /**
   * Update a feature flag (admin only)
   */
  update: protectedProcedure
    .input(
      z.object({
        key: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        enabled: z.boolean().optional(),
        percentage: z.number().min(0).max(100).optional(),
        allowedUsers: z.array(z.string()).optional(),
        allowedOrganizations: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user is admin
      if (ctx.session.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      const { key, ...data } = input;

      // Check if flag exists
      const existing = await db.query.featureFlag.findFirst({
        where: eq(featureFlag.key, key),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feature flag not found",
        });
      }

      await updateFeatureFlag(key, data);

      return { success: true };
    }),

  /**
   * Delete a feature flag (admin only)
   */
  delete: protectedProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if user is admin
      if (ctx.session.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      // Check if flag exists
      const existing = await db.query.featureFlag.findFirst({
        where: eq(featureFlag.key, input.key),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feature flag not found",
        });
      }

      await deleteFeatureFlag(input.key);

      return { success: true };
    }),
});
