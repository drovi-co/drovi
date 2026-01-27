import { db } from "@memorystack/db";
import {
  member,
  PLAN_CREDITS,
  PLANS,
  subscription,
} from "@memorystack/db/schema";
import { env } from "@memorystack/env/server";
import { Polar } from "@polar-sh/sdk";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";
import {
  adminAdjustCredits,
  getActivePackages,
  getCreditStatus,
  getTransactionHistory,
  getUsageAnalytics,
} from "../lib/credits";

// =============================================================================
// ROLE VERIFICATION HELPERS
// =============================================================================

async function verifyOrgAdmin(
  userId: string,
  organizationId: string
): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization.",
    });
  }

  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners and admins can perform this action.",
    });
  }
}

// Initialize Polar client for credit purchases
const polarClient = env.POLAR_ACCESS_TOKEN
  ? new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: "sandbox" })
  : null;

export const creditsRouter = router({
  /**
   * Get current credit status for the active organization
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const orgId = ctx.session.session.activeOrganizationId;

    // Return default status if no organization is selected yet
    // This handles the case where user just signed up and hasn't completed onboarding
    if (!orgId) {
      return {
        balance: 0,
        lifetimeCredits: 0,
        lifetimeUsed: 0,
        trialStatus: "none" as const,
        isTrialActive: false,
        trialDaysRemaining: 0,
        trialProgress: 0,
        trialCreditsGranted: 0,
        isLowBalance: false,
        lowBalanceThreshold: 0,
        monthlyAllocationDate: null,
        noOrganization: true,
      };
    }

    const status = await getCreditStatus(orgId);

    if (!status) {
      // Return default status if credits not found (will be created on first use)
      return {
        balance: 0,
        lifetimeCredits: 0,
        lifetimeUsed: 0,
        trialStatus: "none" as const,
        isTrialActive: false,
        trialDaysRemaining: 0,
        trialProgress: 0,
        trialCreditsGranted: 0,
        isLowBalance: false,
        lowBalanceThreshold: 0,
        monthlyAllocationDate: null,
        noOrganization: false,
      };
    }

    return { ...status, noOrganization: false };
  }),

  /**
   * Get transaction history with pagination and filters
   */
  getTransactions: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        type: z
          .enum([
            "purchase",
            "subscription",
            "consumption",
            "refund",
            "trial",
            "bonus",
            "adjustment",
            "expiration",
          ])
          .optional(),
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
      })
    )
    .query(({ ctx, input }) => {
      const orgId = ctx.session.session.activeOrganizationId;

      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No organization selected",
        });
      }

      return getTransactionHistory({
        organizationId: orgId,
        limit: input.limit,
        offset: input.offset,
        type: input.type,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
      });
    }),

  /**
   * Get available credit packages for purchase
   */
  getPackages: protectedProcedure.query(() => {
    return getActivePackages();
  }),

  /**
   * Get usage analytics for the active organization
   */
  getUsageAnalytics: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(30),
      })
    )
    .query(({ ctx, input }) => {
      const orgId = ctx.session.session.activeOrganizationId;

      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No organization selected",
        });
      }

      return getUsageAnalytics(orgId, input.days);
    }),

  /**
   * Get plan credit information
   */
  getPlanCredits: protectedProcedure.query(() => {
    return PLAN_CREDITS;
  }),

  /**
   * Admin: Adjust credits for an organization
   * Only organization owners and admins can perform this action.
   */
  adminAdjustCredits: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        amount: z.number(),
        reason: z.string().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify user is admin/owner of the organization
      await verifyOrgAdmin(userId, input.organizationId);

      return adminAdjustCredits({
        organizationId: input.organizationId,
        adminUserId: userId,
        amount: input.amount,
        reason: input.reason,
      });
    }),

  /**
   * Purchase a credit package via Polar checkout
   */
  purchasePackage: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!polarClient) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Payment system not configured",
        });
      }

      const orgId = ctx.session.session.activeOrganizationId;
      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No organization selected",
        });
      }

      // Get the package to find the Polar product ID
      const packages = await getActivePackages();
      const pkg = packages.find((p) => p.id === input.packageId);

      if (!pkg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Credit package not found",
        });
      }

      if (!pkg.polarProductId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This package is not available for purchase",
        });
      }

      // Create Polar checkout session
      const checkout = await polarClient.checkouts.create({
        products: [pkg.polarProductId],
        successUrl: `${env.CORS_ORIGIN}/dashboard/billing?success=credits`,
        metadata: {
          organizationId: orgId,
          userId: ctx.session.user.id,
          packageId: input.packageId,
          credits: String(pkg.credits + pkg.bonusCredits),
        },
      });

      return { checkoutUrl: checkout.url };
    }),

  // ===========================================================================
  // SUBSCRIPTION QUERIES
  // ===========================================================================

  /**
   * Get current subscription details for the active organization
   */
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const orgId = ctx.session.session.activeOrganizationId;

    if (!orgId) {
      return null;
    }

    const sub = await db.query.subscription.findFirst({
      where: eq(subscription.organizationId, orgId),
    });

    if (!sub) {
      return null;
    }

    // Get plan details
    const planDetails =
      sub.planType === "enterprise" ? PLANS.enterprise : PLANS.pro;

    // Calculate trial days remaining
    const trialDaysRemaining = sub.trialEndsAt
      ? Math.max(
          0,
          Math.ceil(
            (sub.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          )
        )
      : 0;

    return {
      id: sub.id,
      planType: sub.planType,
      planName: planDetails.name,
      status: sub.status,
      seatCount: sub.seatCount,
      pricePerSeat: sub.pricePerSeat / 100, // Convert from cents to dollars
      monthlyTotal: (sub.seatCount * sub.pricePerSeat) / 100,
      trialEndsAt: sub.trialEndsAt,
      trialDaysRemaining,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      features: planDetails.features,
      limits: planDetails.limits,
      createdAt: sub.createdAt,
    };
  }),

  /**
   * Get all available plans with their features
   */
  getPlans: protectedProcedure.query(() => {
    return {
      pro: {
        ...PLANS.pro,
        pricePerUser: PLANS.pro.pricePerUser,
      },
      enterprise: {
        ...PLANS.enterprise,
        pricePerUser: null, // Custom pricing
      },
    };
  }),

  /**
   * Request an upgrade to Pro plan
   * Creates a Polar checkout session for subscription
   */
  upgradeToPro: protectedProcedure.mutation(async ({ ctx }) => {
    if (!polarClient) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Payment system not configured",
      });
    }

    const orgId = ctx.session.session.activeOrganizationId;
    if (!orgId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No organization selected",
      });
    }

    // Check if Pro product is configured
    if (!env.POLAR_PRO_PRODUCT_ID) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Pro subscription not available",
      });
    }

    // Create Polar checkout session
    const checkout = await polarClient.checkouts.create({
      products: [env.POLAR_PRO_PRODUCT_ID],
      successUrl: `${env.CORS_ORIGIN}/dashboard/billing?success=subscription`,
      metadata: {
        organizationId: orgId,
        userId: ctx.session.user.id,
        planType: "pro",
      },
    });

    return { checkoutUrl: checkout.url };
  }),

  /**
   * Request an upgrade to Enterprise plan (contact sales)
   */
  requestEnterprise: protectedProcedure
    .input(
      z.object({
        companySize: z.string().optional(),
        useCase: z.string().optional(),
        contactEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.session.session.activeOrganizationId;

      // TODO: Send notification to sales team
      // For now, just return success with contact instructions
      console.log(`[sales] Enterprise request from org ${orgId}:`, input);

      return {
        success: true,
        message:
          "Thank you for your interest! Our team will contact you within 24 hours to discuss Enterprise pricing.",
      };
    }),
});
