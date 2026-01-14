import { db } from "@memorystack/db";
import { auditLog, member, organization, user } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, like, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// Admin-only middleware
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return await next();
});

export const adminRouter = router({
  /**
   * List all organizations (admin only)
   */
  listOrganizations: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input.search) {
        conditions.push(
          or(
            like(organization.name, `%${input.search}%`),
            like(organization.slug, `%${input.search}%`)
          )
        );
      }

      const orgs = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          logo: organization.logo,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(organization.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get member counts for each org
      const orgsWithCounts = await Promise.all(
        orgs.map(async (org) => {
          const memberCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(member)
            .where(eq(member.organizationId, org.id));

          return {
            ...org,
            memberCount: Number(memberCount[0]?.count ?? 0),
            plan: "free", // Default plan - integrate with Polar subscription data as needed
          };
        })
      );

      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(organization)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        organizations: orgsWithCounts,
        total: Number(totalResult[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * List all users (admin only)
   */
  listUsers: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
        role: z.enum(["user", "admin"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input.search) {
        conditions.push(
          or(
            like(user.name, `%${input.search}%`),
            like(user.email, `%${input.search}%`)
          )
        );
      }

      if (input.role) {
        conditions.push(eq(user.role, input.role));
      }

      const users = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
          banned: user.banned,
        })
        .from(user)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(user.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(user)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        users,
        total: Number(totalResult[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * List all audit logs (admin only - no org filter)
   */
  listAuditLogs: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        action: z.string().optional(),
        level: z.enum(["info", "warning", "error", "critical"]).optional(),
        userId: z.string().optional(),
        organizationId: z.string().optional(),
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input.action) {
        conditions.push(eq(auditLog.action, input.action));
      }

      if (input.level) {
        conditions.push(eq(auditLog.level, input.level));
      }

      if (input.userId) {
        conditions.push(eq(auditLog.userId, input.userId));
      }

      if (input.organizationId) {
        conditions.push(eq(auditLog.organizationId, input.organizationId));
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
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        logs,
        total: Number(totalResult[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get admin dashboard stats
   */
  getStats: adminProcedure.query(async () => {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(user);

    const [orgCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organization);

    const [auditCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLog);

    // Get new users in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [newUsersCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(user)
      .where(gte(user.createdAt, sevenDaysAgo));

    return {
      totalUsers: Number(userCount?.count ?? 0),
      totalOrganizations: Number(orgCount?.count ?? 0),
      totalAuditLogs: Number(auditCount?.count ?? 0),
      newUsersLast7Days: Number(newUsersCount?.count ?? 0),
    };
  }),
});
