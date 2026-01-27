import { db } from "@memorystack/db";
import { subscription } from "@memorystack/db/schema";
import { initTRPC, TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Paid procedure - requires active subscription or trial
 * Use for core features that require a paid plan
 */
export const paidProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const orgId = ctx.session.session.activeOrganizationId;

  if (!orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No active organization",
    });
  }

  const sub = await db.query.subscription.findFirst({
    where: eq(subscription.organizationId, orgId),
  });

  // No subscription - user hasn't finalized signup
  if (!sub) {
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: "Please complete your account setup to access this feature.",
    });
  }

  // Active subscription - proceed
  if (sub.status === "active") {
    return next({ ctx: { ...ctx, subscription: sub } });
  }

  // Trial - check if still valid
  if (sub.status === "trial") {
    if (sub.trialEndsAt && sub.trialEndsAt > new Date()) {
      return next({ ctx: { ...ctx, subscription: sub } });
    }
    throw new TRPCError({
      code: "PAYMENT_REQUIRED",
      message: "Your trial has expired. Please upgrade to continue.",
    });
  }

  // Past due - grace period, allow access but notify
  if (sub.status === "past_due") {
    return next({ ctx: { ...ctx, subscription: sub } });
  }

  // Canceled or expired - block access
  throw new TRPCError({
    code: "PAYMENT_REQUIRED",
    message: "Your subscription has ended. Please resubscribe to continue.",
  });
});

/**
 * Enterprise procedure - requires enterprise plan
 * Use for enterprise-only features like SSO, SCIM, etc.
 */
export const enterpriseProcedure = paidProcedure.use(async ({ ctx, next }) => {
  const sub = ctx.subscription;

  if (sub.planType !== "enterprise") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This feature requires an Enterprise plan.",
    });
  }

  return next();
});
