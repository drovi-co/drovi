import { db } from "@memorystack/db";
import {
  creditPackage,
  creditTransaction,
  organizationCredits,
  PLAN_CREDITS,
  TOKEN_TO_CREDIT_RATIO,
  TRIAL_CONFIG,
} from "@memorystack/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert token count to credits
 * @param tokens - Number of tokens used
 * @returns Number of credits (rounded up)
 */
export function tokensToCredits(tokens: number): number {
  return Math.ceil(tokens / TOKEN_TO_CREDIT_RATIO);
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Core Credit Functions
// ============================================================================

/**
 * Get or create organization credits with trial initialization
 * @param organizationId - Organization ID
 * @returns Organization credits record
 */
export async function getOrCreateOrgCredits(organizationId: string) {
  // Try to find existing credits
  const existing = await db.query.organizationCredits.findFirst({
    where: eq(organizationCredits.organizationId, organizationId),
  });

  if (existing) {
    return existing;
  }

  // Create new credits with trial
  const now = new Date();
  const trialEndsAt = new Date(
    now.getTime() + TRIAL_CONFIG.durationDays * 24 * 60 * 60 * 1000
  );

  const id = generateId();

  await db.insert(organizationCredits).values({
    id,
    organizationId,
    balance: TRIAL_CONFIG.credits,
    lifetimeCredits: TRIAL_CONFIG.credits,
    lifetimeUsed: 0,
    trialStatus: "active",
    trialStartedAt: now,
    trialEndsAt,
    trialCreditsGranted: TRIAL_CONFIG.credits,
  });

  // Record trial credit transaction
  await db.insert(creditTransaction).values({
    id: generateId(),
    organizationId,
    type: "trial",
    amount: TRIAL_CONFIG.credits,
    balanceBefore: 0,
    balanceAfter: TRIAL_CONFIG.credits,
    description: `Trial credits: ${TRIAL_CONFIG.credits} credits for ${TRIAL_CONFIG.durationDays} days`,
    referenceType: "trial_activation",
  });

  return db.query.organizationCredits.findFirst({
    where: eq(organizationCredits.organizationId, organizationId),
  });
}

/**
 * Check if organization has sufficient credits
 * @param organizationId - Organization ID
 * @param required - Required credits
 * @returns Object with hasCredits boolean and current balance
 */
export async function checkCredits(organizationId: string, required: number) {
  const credits = await getOrCreateOrgCredits(organizationId);

  if (!credits) {
    return { hasCredits: false, balance: 0, required };
  }

  return {
    hasCredits: credits.balance >= required,
    balance: credits.balance,
    required,
  };
}

/**
 * Deduct credits for AI consumption with full audit trail
 * Uses database transaction for atomicity
 */
export function deductCredits(params: {
  organizationId: string;
  userId?: string;
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
  model?: string;
  requestId?: string;
  description?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const creditsToDeduct = tokensToCredits(params.tokensUsed);

  return db.transaction(async (tx) => {
    // Get current credits with row lock
    const credits = await tx.query.organizationCredits.findFirst({
      where: eq(organizationCredits.organizationId, params.organizationId),
    });

    if (!credits) {
      throw new Error("Organization credits not found");
    }

    if (credits.balance < creditsToDeduct) {
      throw new Error("Insufficient credits");
    }

    const newBalance = credits.balance - creditsToDeduct;

    // Update balance
    await tx
      .update(organizationCredits)
      .set({
        balance: newBalance,
        lifetimeUsed: credits.lifetimeUsed + creditsToDeduct,
      })
      .where(eq(organizationCredits.organizationId, params.organizationId));

    // Record transaction
    await tx.insert(creditTransaction).values({
      id: generateId(),
      organizationId: params.organizationId,
      userId: params.userId,
      type: "consumption",
      amount: -creditsToDeduct,
      balanceBefore: credits.balance,
      balanceAfter: newBalance,
      description:
        params.description ?? `AI usage: ${params.tokensUsed} tokens`,
      referenceId: params.requestId,
      referenceType: "ai_request",
      tokensUsed: params.tokensUsed,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      model: params.model,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    return {
      creditsDeducted: creditsToDeduct,
      balanceBefore: credits.balance,
      balanceAfter: newBalance,
      tokensUsed: params.tokensUsed,
    };
  });
}

/**
 * Add credits to organization (for purchases, subscriptions, bonuses)
 */
export function addCredits(params: {
  organizationId: string;
  userId?: string;
  amount: number;
  type: "purchase" | "subscription" | "bonus" | "refund" | "adjustment";
  description: string;
  referenceId?: string;
  referenceType?: string;
  metadata?: Record<string, unknown>;
}) {
  return db.transaction(async (tx) => {
    // Get current credits
    const credits = await tx.query.organizationCredits.findFirst({
      where: eq(organizationCredits.organizationId, params.organizationId),
    });

    if (!credits) {
      throw new Error("Organization credits not found");
    }

    const newBalance = credits.balance + params.amount;

    // Update balance
    await tx
      .update(organizationCredits)
      .set({
        balance: newBalance,
        lifetimeCredits: credits.lifetimeCredits + params.amount,
      })
      .where(eq(organizationCredits.organizationId, params.organizationId));

    // Record transaction
    await tx.insert(creditTransaction).values({
      id: generateId(),
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      balanceBefore: credits.balance,
      balanceAfter: newBalance,
      description: params.description,
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      metadata: params.metadata,
    });

    return {
      creditsAdded: params.amount,
      balanceBefore: credits.balance,
      balanceAfter: newBalance,
    };
  });
}

/**
 * Update organization plan and allocate monthly credits
 */
export function updateOrgPlan(
  organizationId: string,
  plan: "free" | "pro" | "enterprise"
) {
  const monthlyCredits = PLAN_CREDITS[plan];

  return db.transaction(async (tx) => {
    const credits = await tx.query.organizationCredits.findFirst({
      where: eq(organizationCredits.organizationId, organizationId),
    });

    if (!credits) {
      throw new Error("Organization credits not found");
    }

    const newBalance = credits.balance + monthlyCredits;

    // Update balance and trial status
    await tx
      .update(organizationCredits)
      .set({
        balance: newBalance,
        lifetimeCredits: credits.lifetimeCredits + monthlyCredits,
        trialStatus:
          credits.trialStatus === "active" ? "converted" : credits.trialStatus,
        monthlyAllocationDate: new Date(),
      })
      .where(eq(organizationCredits.organizationId, organizationId));

    // Record transaction
    await tx.insert(creditTransaction).values({
      id: generateId(),
      organizationId,
      type: "subscription",
      amount: monthlyCredits,
      balanceBefore: credits.balance,
      balanceAfter: newBalance,
      description: `Monthly ${plan} plan allocation: ${monthlyCredits} credits`,
      referenceType: "plan_subscription",
    });

    return {
      plan,
      creditsAllocated: monthlyCredits,
      balanceAfter: newBalance,
    };
  });
}

/**
 * Mark trial as expired
 */
export async function expireTrial(organizationId: string) {
  await db
    .update(organizationCredits)
    .set({ trialStatus: "expired" })
    .where(eq(organizationCredits.organizationId, organizationId));
}

/**
 * Get full credit status for UI
 */
export async function getCreditStatus(organizationId: string) {
  const credits = await getOrCreateOrgCredits(organizationId);

  if (!credits) {
    return null;
  }

  const now = new Date();
  const isTrialActive =
    credits.trialStatus === "active" &&
    credits.trialEndsAt &&
    credits.trialEndsAt > now;

  let trialDaysRemaining = 0;
  let trialProgress = 0;

  if (isTrialActive && credits.trialStartedAt && credits.trialEndsAt) {
    const totalTrialMs =
      credits.trialEndsAt.getTime() - credits.trialStartedAt.getTime();
    const elapsedMs = now.getTime() - credits.trialStartedAt.getTime();
    trialProgress = Math.min(100, Math.round((elapsedMs / totalTrialMs) * 100));
    trialDaysRemaining = Math.max(
      0,
      Math.ceil(
        (credits.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )
    );
  }

  // Check low balance threshold (10% of monthly free tier)
  const lowBalanceThreshold = Math.round(PLAN_CREDITS.free * 0.1);
  const isLowBalance = credits.balance <= lowBalanceThreshold;

  return {
    balance: credits.balance,
    lifetimeCredits: credits.lifetimeCredits,
    lifetimeUsed: credits.lifetimeUsed,
    trialStatus: credits.trialStatus,
    isTrialActive,
    trialDaysRemaining,
    trialProgress,
    trialCreditsGranted: credits.trialCreditsGranted,
    isLowBalance,
    lowBalanceThreshold,
    monthlyAllocationDate: credits.monthlyAllocationDate,
  };
}

// ============================================================================
// Transaction History
// ============================================================================

/**
 * Get paginated transaction history
 */
export async function getTransactionHistory(params: {
  organizationId: string;
  limit?: number;
  offset?: number;
  type?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const {
    organizationId,
    limit = 20,
    offset = 0,
    type,
    startDate,
    endDate,
  } = params;

  const conditions = [eq(creditTransaction.organizationId, organizationId)];

  if (type) {
    conditions.push(
      eq(creditTransaction.type, type as typeof creditTransaction.type._.data)
    );
  }
  if (startDate) {
    conditions.push(gte(creditTransaction.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(creditTransaction.createdAt, endDate));
  }

  const transactions = await db.query.creditTransaction.findMany({
    where: and(...conditions),
    orderBy: [desc(creditTransaction.createdAt)],
    limit,
    offset,
    with: {
      user: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(creditTransaction)
    .where(and(...conditions));

  return {
    transactions,
    total: countResult[0]?.count ?? 0,
    hasMore: offset + transactions.length < (countResult[0]?.count ?? 0),
  };
}

// ============================================================================
// Credit Packages
// ============================================================================

/**
 * Get active credit packages
 */
export function getActivePackages() {
  return db.query.creditPackage.findMany({
    where: eq(creditPackage.active, true),
    orderBy: [creditPackage.sortOrder],
  });
}

/**
 * Get package by Polar product ID
 */
export function getPackageByPolarId(polarProductId: string) {
  return db.query.creditPackage.findFirst({
    where: eq(creditPackage.polarProductId, polarProductId),
  });
}

/**
 * Process credit package purchase
 */
export async function processCreditPurchase(params: {
  organizationId: string;
  userId?: string;
  credits?: number;
  packageId?: string;
  polarCheckoutId: string;
}) {
  let totalCredits = params.credits ?? 0;
  let description = `Credit purchase: ${totalCredits} credits`;

  if (params.packageId) {
    const pkg = await db.query.creditPackage.findFirst({
      where: eq(creditPackage.id, params.packageId),
    });

    if (pkg) {
      totalCredits = pkg.credits + pkg.bonusCredits;
      description = `${pkg.name}: ${pkg.credits} credits${pkg.bonusCredits > 0 ? ` + ${pkg.bonusCredits} bonus` : ""}`;
    }
  }

  if (totalCredits <= 0) {
    throw new Error("Invalid credit amount");
  }

  return addCredits({
    organizationId: params.organizationId,
    userId: params.userId,
    amount: totalCredits,
    type: "purchase",
    description,
    referenceId: params.polarCheckoutId,
    referenceType: "polar_checkout",
    metadata: {
      packageId: params.packageId,
      polarCheckoutId: params.polarCheckoutId,
    },
  });
}

// ============================================================================
// Usage Analytics
// ============================================================================

/**
 * Get daily usage analytics for the last N days
 */
export async function getUsageAnalytics(organizationId: string, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const transactions = await db.query.creditTransaction.findMany({
    where: and(
      eq(creditTransaction.organizationId, organizationId),
      eq(creditTransaction.type, "consumption"),
      gte(creditTransaction.createdAt, startDate)
    ),
    orderBy: [creditTransaction.createdAt],
  });

  // Group by day
  const dailyUsage = new Map<
    string,
    { credits: number; tokens: number; requests: number }
  >();

  for (const tx of transactions) {
    const date = tx.createdAt.toISOString().split("T")[0];
    const existing = dailyUsage.get(date) ?? {
      credits: 0,
      tokens: 0,
      requests: 0,
    };

    dailyUsage.set(date, {
      credits: existing.credits + Math.abs(tx.amount),
      tokens: existing.tokens + (tx.tokensUsed ?? 0),
      requests: existing.requests + 1,
    });
  }

  // Group by model
  const modelUsage = new Map<
    string,
    { credits: number; tokens: number; requests: number }
  >();

  for (const tx of transactions) {
    const model = tx.model ?? "unknown";
    const existing = modelUsage.get(model) ?? {
      credits: 0,
      tokens: 0,
      requests: 0,
    };

    modelUsage.set(model, {
      credits: existing.credits + Math.abs(tx.amount),
      tokens: existing.tokens + (tx.tokensUsed ?? 0),
      requests: existing.requests + 1,
    });
  }

  // Calculate totals
  let totalCredits = 0;
  let totalTokens = 0;
  let totalRequests = 0;

  for (const tx of transactions) {
    totalCredits += Math.abs(tx.amount);
    totalTokens += tx.tokensUsed ?? 0;
    totalRequests += 1;
  }

  return {
    daily: Array.from(dailyUsage.entries()).map(([date, data]) => ({
      date,
      ...data,
    })),
    byModel: Array.from(modelUsage.entries()).map(([model, data]) => ({
      model,
      ...data,
    })),
    totals: {
      credits: totalCredits,
      tokens: totalTokens,
      requests: totalRequests,
    },
    period: {
      start: startDate,
      end: new Date(),
      days,
    },
  };
}

// ============================================================================
// Admin Functions
// ============================================================================

/**
 * Admin credit adjustment
 */
export function adminAdjustCredits(params: {
  organizationId: string;
  adminUserId: string;
  amount: number;
  reason: string;
}) {
  return addCredits({
    organizationId: params.organizationId,
    userId: params.adminUserId,
    amount: params.amount,
    type: "adjustment",
    description: `Admin adjustment: ${params.reason}`,
    referenceType: "admin_adjustment",
    metadata: {
      adminUserId: params.adminUserId,
      reason: params.reason,
    },
  });
}

/**
 * Get organizations with low balance for notifications
 */
export function getOrganizationsWithLowBalance(threshold = 10) {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  return db.query.organizationCredits.findMany({
    where: and(
      lte(organizationCredits.balance, threshold),
      // Only get those not notified in last 24 hours
      sql`(${organizationCredits.lastLowBalanceNotification} IS NULL OR ${organizationCredits.lastLowBalanceNotification} < ${oneDayAgo})`
    ),
  });
}

/**
 * Update low balance notification timestamp
 */
export async function markLowBalanceNotified(organizationId: string) {
  await db
    .update(organizationCredits)
    .set({ lastLowBalanceNotification: new Date() })
    .where(eq(organizationCredits.organizationId, organizationId));
}

/**
 * Get expired trials for processing
 */
export function getExpiredTrials() {
  const now = new Date();

  return db.query.organizationCredits.findMany({
    where: and(
      eq(organizationCredits.trialStatus, "active"),
      lte(organizationCredits.trialEndsAt, now)
    ),
  });
}

/**
 * Process monthly credit allocations
 */
export async function processMonthlyAllocations() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get all orgs that haven't received allocation this month
  const orgsNeedingAllocation = await db.query.organizationCredits.findMany({
    where: sql`(${organizationCredits.monthlyAllocationDate} IS NULL OR ${organizationCredits.monthlyAllocationDate} < ${firstOfMonth})`,
    with: {
      organization: true,
    },
  });

  const results = [];

  for (const credits of orgsNeedingAllocation) {
    if (!credits.organization) {
      continue;
    }

    const plan = (credits.organization as { plan?: string }).plan ?? "free";
    const monthlyCredits =
      PLAN_CREDITS[plan as keyof typeof PLAN_CREDITS] ?? PLAN_CREDITS.free;

    await db.transaction(async (tx) => {
      const newBalance = credits.balance + monthlyCredits;

      await tx
        .update(organizationCredits)
        .set({
          balance: newBalance,
          lifetimeCredits: credits.lifetimeCredits + monthlyCredits,
          monthlyAllocationDate: now,
        })
        .where(eq(organizationCredits.id, credits.id));

      await tx.insert(creditTransaction).values({
        id: generateId(),
        organizationId: credits.organizationId,
        type: "subscription",
        amount: monthlyCredits,
        balanceBefore: credits.balance,
        balanceAfter: newBalance,
        description: `Monthly ${plan} plan allocation: ${monthlyCredits} credits`,
        referenceType: "monthly_allocation",
      });
    });

    results.push({
      organizationId: credits.organizationId,
      plan,
      creditsAllocated: monthlyCredits,
    });
  }

  return results;
}
