import { db } from "@memorystack/db";
import { AuditActions, auditLog } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

export const auditRouter = router({
  /**
   * List audit logs for the current user's active organization
   */
  list: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        action: z.string().optional(),
        resource: z.string().optional(),
        userId: z.string().optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const orgId =
        input.organizationId ?? ctx.session.session.activeOrganizationId;

      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No organization selected",
        });
      }

      const conditions = [eq(auditLog.organizationId, orgId)];

      if (input.action) {
        conditions.push(eq(auditLog.action, input.action));
      }

      if (input.resource) {
        conditions.push(eq(auditLog.resource, input.resource));
      }

      if (input.userId) {
        conditions.push(eq(auditLog.userId, input.userId));
      }

      if (input.fromDate) {
        conditions.push(gte(auditLog.createdAt, new Date(input.fromDate)));
      }

      if (input.toDate) {
        conditions.push(lte(auditLog.createdAt, new Date(input.toDate)));
      }

      const logs = await db
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(and(...conditions));

      return {
        logs,
        total: countResult[0]?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get a single audit log entry
   */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const log = await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.id, input.id))
        .limit(1);

      if (!log[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Audit log not found",
        });
      }

      // Verify user has access to this organization's logs
      const orgId = ctx.session.session.activeOrganizationId;
      if (log[0].organizationId && log[0].organizationId !== orgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Access denied",
        });
      }

      return log[0];
    }),

  /**
   * Get available actions for filtering
   */
  getActions: protectedProcedure.query(() => {
    return Object.values(AuditActions);
  }),

  /**
   * Get audit log statistics for the organization
   */
  stats: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().optional(),
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const orgId =
        input.organizationId ?? ctx.session.session.activeOrganizationId;

      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No organization selected",
        });
      }

      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - input.days);

      const logs = await db
        .select({
          action: auditLog.action,
          count: sql<number>`count(*)`,
        })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, orgId),
            gte(auditLog.createdAt, fromDate)
          )
        )
        .groupBy(auditLog.action);

      const totalCount = logs.reduce((acc, log) => acc + Number(log.count), 0);

      return {
        byAction: logs,
        total: totalCount,
        period: input.days,
      };
    }),
});
