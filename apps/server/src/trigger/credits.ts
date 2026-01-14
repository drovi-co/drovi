import { schedules, task } from "@trigger.dev/sdk";

// ============================================================================
// Scheduled Tasks
// ============================================================================

/**
 * Process monthly credit allocations
 * Runs on the 1st of every month at 1 AM
 */
export const processMonthlyCredits = schedules.task({
  id: "process-monthly-credits",
  cron: "0 1 1 * *", // 1st of every month at 1 AM
  run: async () => {
    const { processMonthlyAllocations } = await import(
      "@memorystack/api/lib/credits"
    );

    const results = await processMonthlyAllocations();

    return {
      processedCount: results.length,
      allocations: results,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Process expired trials
 * Runs every hour to check for and expire trials
 */
export const processExpiredTrials = schedules.task({
  id: "process-expired-trials",
  cron: "0 * * * *", // Every hour
  run: async () => {
    const { getExpiredTrials, expireTrial } = await import(
      "@memorystack/api/lib/credits"
    );

    const expiredTrials = await getExpiredTrials();
    const results = [];

    for (const trial of expiredTrials) {
      await expireTrial(trial.organizationId);
      results.push({
        organizationId: trial.organizationId,
        expiredAt: new Date().toISOString(),
      });
    }

    return {
      expiredCount: results.length,
      expired: results,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Send low balance notifications
 * Runs daily at 9 AM
 */
export const sendLowBalanceNotifications = schedules.task({
  id: "send-low-balance-notifications",
  cron: "0 9 * * *", // 9 AM every day
  run: async () => {
    const { getOrganizationsWithLowBalance, markLowBalanceNotified } =
      await import("@memorystack/api/lib/credits");
    const { db } = await import("@memorystack/db");
    const { organization, member } = await import("@memorystack/db/schema");
    const { eq } = await import("drizzle-orm");

    const lowBalanceOrgs = await getOrganizationsWithLowBalance(10);
    const notified = [];

    for (const orgCredits of lowBalanceOrgs) {
      // Get organization details
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, orgCredits.organizationId),
      });

      if (!org) {
        continue;
      }

      // Get organization owners/admins to notify
      const orgMembers = await db.query.member.findMany({
        where: eq(member.organizationId, orgCredits.organizationId),
        with: {
          user: true,
        },
      });

      const admins = orgMembers.filter(
        (m) => m.role === "owner" || m.role === "admin"
      );

      // Here you would send email notifications
      // For now, just mark as notified
      await markLowBalanceNotified(orgCredits.organizationId);

      notified.push({
        organizationId: orgCredits.organizationId,
        organizationName: org.name,
        balance: orgCredits.balance,
        adminsNotified: admins.length,
      });
    }

    return {
      notifiedCount: notified.length,
      notifications: notified,
      timestamp: new Date().toISOString(),
    };
  },
});

// ============================================================================
// Event-driven Tasks
// ============================================================================

/**
 * Handle credit purchase from Polar webhook
 */
export const handleCreditPurchaseTask = task({
  id: "handle-credit-purchase",
  run: async (payload: {
    organizationId: string;
    userId?: string;
    packageId: string;
    polarCheckoutId: string;
  }) => {
    const { processCreditPurchase } = await import(
      "@memorystack/api/lib/credits"
    );

    const result = await processCreditPurchase({
      organizationId: payload.organizationId,
      userId: payload.userId,
      packageId: payload.packageId,
      polarCheckoutId: payload.polarCheckoutId,
    });

    return {
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Handle subscription change (plan upgrade/downgrade)
 */
export const handleSubscriptionChangeTask = task({
  id: "handle-subscription-change",
  run: async (payload: {
    organizationId: string;
    plan: "free" | "pro" | "enterprise";
    polarSubscriptionId?: string;
  }) => {
    const { updateOrgPlan } = await import("@memorystack/api/lib/credits");

    const result = await updateOrgPlan(payload.organizationId, payload.plan);

    return {
      success: true,
      ...result,
      polarSubscriptionId: payload.polarSubscriptionId,
      timestamp: new Date().toISOString(),
    };
  },
});

/**
 * Send credit usage summary email
 * Can be triggered weekly or monthly
 */
export const sendCreditUsageSummary = task({
  id: "send-credit-usage-summary",
  run: async (payload: {
    organizationId: string;
    period: "weekly" | "monthly";
  }) => {
    const { getUsageAnalytics, getCreditStatus } = await import(
      "@memorystack/api/lib/credits"
    );
    const { db } = await import("@memorystack/db");
    const { organization } = await import("@memorystack/db/schema");
    const { eq } = await import("drizzle-orm");

    const days = payload.period === "weekly" ? 7 : 30;

    const [analytics, status, org] = await Promise.all([
      getUsageAnalytics(payload.organizationId, days),
      getCreditStatus(payload.organizationId),
      db.query.organization.findFirst({
        where: eq(organization.id, payload.organizationId),
      }),
    ]);

    // Here you would send the email with the analytics
    // For now, just return the data

    return {
      organizationId: payload.organizationId,
      organizationName: org?.name,
      period: payload.period,
      balance: status?.balance,
      usage: analytics.totals,
      timestamp: new Date().toISOString(),
    };
  },
});
