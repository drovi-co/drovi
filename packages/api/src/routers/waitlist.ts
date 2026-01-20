import { db } from "@memorystack/db";
import { inviteCode, waitlistApplication } from "@memorystack/db/schema";
import { tasks } from "@trigger.dev/sdk";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../index";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a unique invite code like "DROVI-ABC123"
 */
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `DROVI-${code}`;
}

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

// =============================================================================
// ROUTER
// =============================================================================

export const waitlistRouter = router({
  // ===========================================================================
  // PUBLIC PROCEDURES
  // ===========================================================================

  /**
   * Submit a waitlist application (public, no auth required)
   */
  submit: publicProcedure
    .input(
      z.object({
        email: z.string().email("Please enter a valid email"),
        name: z.string().min(2, "Name must be at least 2 characters"),
        company: z.string().optional(),
        role: z.string().optional(),
        useCase: z
          .string()
          .max(1000, "Use case must be under 1000 characters")
          .optional(),
        referralSource: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Check if email already exists
      const existing = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.email, input.email.toLowerCase()),
      });

      if (existing) {
        // Return success even if exists (prevent email enumeration)
        return { success: true, message: "Application received" };
      }

      // Create application
      const [newApplication] = await db
        .insert(waitlistApplication)
        .values({
          email: input.email.toLowerCase(),
          name: input.name,
          company: input.company,
          role: input.role,
          useCase: input.useCase,
          referralSource: input.referralSource,
        })
        .returning({ id: waitlistApplication.id });

      // Trigger confirmation email via Trigger.dev task
      if (newApplication) {
        await tasks.trigger("send-waitlist-confirmation-email", {
          applicationId: newApplication.id,
          email: input.email.toLowerCase(),
          userName: input.name,
        });
      }

      return { success: true, message: "Application received" };
    }),

  /**
   * Check application status by email (public)
   */
  checkStatus: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .query(async ({ input }) => {
      const application = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.email, input.email.toLowerCase()),
        with: { inviteCode: true },
      });

      if (!application) {
        return { found: false };
      }

      return {
        found: true,
        status: application.status,
        submittedAt: application.createdAt,
        // Don't expose invite code here - it comes via email
      };
    }),

  /**
   * Validate an invite code (public, for signup flow)
   */
  validateCode: publicProcedure
    .input(z.object({ code: z.string().min(1) }))
    .query(async ({ input }) => {
      const code = await db.query.inviteCode.findFirst({
        where: eq(inviteCode.code, input.code.toUpperCase()),
        with: { waitlistApplication: true },
      });

      if (!code) {
        return { valid: false, reason: "Invalid invite code" };
      }

      if (code.usedAt) {
        return {
          valid: false,
          reason: "This invite code has already been used",
        };
      }

      if (code.expiresAt && code.expiresAt < new Date()) {
        return { valid: false, reason: "This invite code has expired" };
      }

      return {
        valid: true,
        email: code.waitlistApplication.email,
        name: code.waitlistApplication.name,
      };
    }),

  /**
   * Mark invite code as used (called during OAuth callback)
   */
  useCode: publicProcedure
    .input(z.object({ code: z.string(), userId: z.string() }))
    .mutation(async ({ input }) => {
      const codeRecord = await db.query.inviteCode.findFirst({
        where: eq(inviteCode.code, input.code.toUpperCase()),
      });

      if (!codeRecord || codeRecord.usedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or already used invite code",
        });
      }

      // Mark code as used
      await db
        .update(inviteCode)
        .set({
          usedAt: new Date(),
          usedByUserId: input.userId,
        })
        .where(eq(inviteCode.id, codeRecord.id));

      // Update application status
      await db
        .update(waitlistApplication)
        .set({ status: "converted" })
        .where(eq(waitlistApplication.id, codeRecord.waitlistApplicationId));

      return { success: true };
    }),

  // ===========================================================================
  // ADMIN PROCEDURES
  // ===========================================================================

  /**
   * List all waitlist applications (admin only)
   */
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        status: z
          .enum(["pending", "approved", "rejected", "converted", "all"])
          .default("all"),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const conditions = [];

      if (input.status !== "all") {
        conditions.push(eq(waitlistApplication.status, input.status));
      }

      if (input.search) {
        conditions.push(
          or(
            like(waitlistApplication.email, `%${input.search}%`),
            like(waitlistApplication.name, `%${input.search}%`),
            like(waitlistApplication.company, `%${input.search}%`)
          )
        );
      }

      const applications = await db.query.waitlistApplication.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(waitlistApplication.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          inviteCode: true,
          reviewedBy: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      const totalResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(waitlistApplication)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return {
        applications,
        total: Number(totalResult[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Get waitlist statistics (admin only)
   */
  getStats: adminProcedure.query(async () => {
    const [pending] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistApplication)
      .where(eq(waitlistApplication.status, "pending"));

    const [approved] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistApplication)
      .where(eq(waitlistApplication.status, "approved"));

    const [rejected] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistApplication)
      .where(eq(waitlistApplication.status, "rejected"));

    const [converted] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistApplication)
      .where(eq(waitlistApplication.status, "converted"));

    const [unusedCodes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(inviteCode)
      .where(isNull(inviteCode.usedAt));

    // New applications in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [newLast7Days] = await db
      .select({ count: sql<number>`count(*)` })
      .from(waitlistApplication)
      .where(gte(waitlistApplication.createdAt, sevenDaysAgo));

    return {
      pending: Number(pending?.count ?? 0),
      approved: Number(approved?.count ?? 0),
      rejected: Number(rejected?.count ?? 0),
      converted: Number(converted?.count ?? 0),
      unusedCodes: Number(unusedCodes?.count ?? 0),
      newLast7Days: Number(newLast7Days?.count ?? 0),
    };
  }),

  /**
   * Get single application details (admin only)
   */
  getById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const application = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.id, input.id),
        with: {
          inviteCode: {
            with: {
              usedByUser: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          reviewedBy: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      return application;
    }),

  /**
   * Approve an application and generate invite code (admin only)
   */
  approve: adminProcedure
    .input(
      z.object({
        applicationId: z.string(),
        adminNotes: z.string().optional(),
        expiresInDays: z.number().min(1).max(90).optional(), // Optional expiration
      })
    )
    .mutation(async ({ input, ctx }) => {
      const application = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.id, input.applicationId),
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      if (application.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only approve pending applications",
        });
      }

      // Generate unique invite code
      let code: string;
      let attempts = 0;
      do {
        code = generateInviteCode();
        const existing = await db.query.inviteCode.findFirst({
          where: eq(inviteCode.code, code),
        });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Update application
      await db
        .update(waitlistApplication)
        .set({
          status: "approved",
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
          adminNotes: input.adminNotes,
        })
        .where(eq(waitlistApplication.id, input.applicationId));

      // Create invite code
      await db.insert(inviteCode).values({
        code,
        waitlistApplicationId: input.applicationId,
        expiresAt,
        lastEmailSentAt: new Date(),
        emailSendCount: 1,
      });

      // Trigger approval email with invite code via Trigger.dev
      await tasks.trigger("send-waitlist-approval-email", {
        applicationId: input.applicationId,
        email: application.email,
        userName: application.name,
        inviteCode: code,
      });

      return { success: true, code };
    }),

  /**
   * Reject an application (admin only)
   */
  reject: adminProcedure
    .input(
      z.object({
        applicationId: z.string(),
        reason: z.string().optional(),
        adminNotes: z.string().optional(),
        sendEmail: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const application = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.id, input.applicationId),
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      await db
        .update(waitlistApplication)
        .set({
          status: "rejected",
          reviewedById: ctx.session.user.id,
          reviewedAt: new Date(),
          rejectionReason: input.reason,
          adminNotes: input.adminNotes,
        })
        .where(eq(waitlistApplication.id, input.applicationId));

      // Note: Rejection emails are not sent automatically to avoid negative user experience.
      // If needed in the future, add a sendRejectionEmail task and trigger it when input.sendEmail is true.

      return { success: true };
    }),

  /**
   * Resend invite email (admin only)
   */
  resendInvite: adminProcedure
    .input(z.object({ applicationId: z.string() }))
    .mutation(async ({ input }) => {
      const application = await db.query.waitlistApplication.findFirst({
        where: eq(waitlistApplication.id, input.applicationId),
        with: { inviteCode: true },
      });

      if (!application) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Application not found",
        });
      }

      if (application.status !== "approved" || !application.inviteCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Can only resend for approved applications with invite codes",
        });
      }

      // Update email tracking
      await db
        .update(inviteCode)
        .set({
          lastEmailSentAt: new Date(),
          emailSendCount: (application.inviteCode.emailSendCount ?? 0) + 1,
        })
        .where(eq(inviteCode.id, application.inviteCode.id));

      // Trigger invite email via Trigger.dev
      await tasks.trigger("send-waitlist-approval-email", {
        applicationId: input.applicationId,
        email: application.email,
        userName: application.name,
        inviteCode: application.inviteCode.code,
      });

      return { success: true };
    }),

  /**
   * Update admin notes (admin only)
   */
  updateNotes: adminProcedure
    .input(
      z.object({
        applicationId: z.string(),
        adminNotes: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await db
        .update(waitlistApplication)
        .set({ adminNotes: input.adminNotes })
        .where(eq(waitlistApplication.id, input.applicationId));

      return { success: true };
    }),
});
