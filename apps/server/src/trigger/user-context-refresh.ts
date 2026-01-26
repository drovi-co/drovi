// =============================================================================
// USER CONTEXT REFRESH TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for refreshing UserProfile dynamic context.
// From Supermemory research: The "RAM layer" should be kept fresh
// with user's current focus, recent topics, and active projects.
//

import { db } from "@memorystack/db";
import {
  commitment,
  decision,
  sourceAccount,
  unifiedIntelligenceObject,
} from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface UserContextRefreshResult {
  success: boolean;
  userId: string;
  organizationId: string;
  updatedFields: string[];
  error?: string;
}

interface BatchRefreshResult {
  success: boolean;
  total: number;
  processed: number;
  errors: string[];
}

interface DynamicContext {
  currentFocus: string[];
  recentTopics: string[];
  activeProjects: string[];
  unreadCommitmentsCount: number;
  overdueCommitmentsCount: number;
  pendingDecisionsCount: number;
  moodIndicator: "busy" | "stressed" | "normal" | "relaxed" | null;
}

// =============================================================================
// SINGLE USER CONTEXT REFRESH
// =============================================================================

/**
 * Refresh dynamic context for a specific user.
 * Updates UserProfile in FalkorDB with:
 * - current_focus: Inferred from recent activity
 * - recent_topics: From last 24h conversations
 * - active_project_ids: Projects user is involved in
 * - Counts: unread commitments, overdue, pending decisions
 */
export const refreshUserContextTask = task({
  id: "user-context-refresh",
  queue: {
    name: "user-context",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 120,
  run: async (payload: {
    userId: string;
    organizationId: string;
  }): Promise<UserContextRefreshResult> => {
    const { userId, organizationId } = payload;

    log.info("Refreshing user context", { userId, organizationId });

    const updatedFields: string[] = [];

    try {
      // Calculate dynamic context from PostgreSQL data
      const dynamicContext = await calculateDynamicContext(
        userId,
        organizationId
      );

      // Update FalkorDB UserProfile
      const graphUpdated = await updateGraphUserProfile(
        userId,
        organizationId,
        dynamicContext
      );

      if (graphUpdated) {
        updatedFields.push(
          "currentFocus",
          "recentTopics",
          "activeProjects",
          "counts",
          "moodIndicator"
        );
      }

      // Invalidate cache
      await invalidateUserCache(userId, organizationId);

      log.info("User context refreshed", {
        userId,
        organizationId,
        updatedFields,
        context: dynamicContext,
      });

      return {
        success: true,
        userId,
        organizationId,
        updatedFields,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("User context refresh failed", error, {
        userId,
        organizationId,
      });

      return {
        success: false,
        userId,
        organizationId,
        updatedFields,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH CONTEXT REFRESH
// =============================================================================

/**
 * Refresh context for all active users.
 * Runs on schedule to keep the "RAM layer" fresh.
 */
export const batchRefreshUserContextTask = task({
  id: "user-context-batch-refresh",
  queue: {
    name: "user-context-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (payload: {
    organizationIds?: string[];
  }): Promise<BatchRefreshResult> => {
    const { organizationIds } = payload;

    log.info("Starting batch user context refresh", {
      specificOrgs: organizationIds?.length,
    });

    // Get all active source accounts (users with connected accounts)
    const accounts = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.status, "connected"),
        organizationIds
          ? inArray(sourceAccount.organizationId, organizationIds)
          : undefined
      ),
      columns: {
        organizationId: true,
        addedByUserId: true,
      },
    });

    // Deduplicate by user+org
    const uniqueUsers = new Map<string, { userId: string; orgId: string }>();
    for (const account of accounts) {
      const key = `${account.addedByUserId}:${account.organizationId}`;
      if (!uniqueUsers.has(key)) {
        uniqueUsers.set(key, {
          userId: account.addedByUserId,
          orgId: account.organizationId,
        });
      }
    }

    log.info("Found users for context refresh", { count: uniqueUsers.size });

    const errors: string[] = [];
    let processed = 0;

    // Process in chunks
    const chunkSize = 10;
    const users = Array.from(uniqueUsers.values());

    for (let i = 0; i < users.length; i += chunkSize) {
      const chunk = users.slice(i, i + chunkSize);

      const results = await Promise.all(
        chunk.map(async ({ userId, orgId }) => {
          try {
            const handle = await refreshUserContextTask.triggerAndWait({
              userId,
              organizationId: orgId,
            });
            return handle;
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : "Unknown error";
            return { success: false, error: errorMsg };
          }
        })
      );

      for (const result of results) {
        processed++;
        if (result && typeof result === "object" && "success" in result) {
          if (!result.success && "error" in result && result.error) {
            errors.push(result.error);
          }
        }
      }
    }

    log.info("Batch user context refresh completed", {
      total: users.length,
      processed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: users.length,
      processed,
      errors,
    };
  },
});

// =============================================================================
// SCHEDULED REFRESH (EVERY 15 MINUTES)
// =============================================================================

/**
 * Scheduled task that triggers batch context refresh.
 * Runs every 15 minutes to keep user profiles fresh.
 */
export const userContextRefreshSchedule = schedules.task({
  id: "user-context-scheduled-refresh",
  cron: "*/15 * * * *", // Every 15 minutes
  run: async () => {
    log.info("Running scheduled user context refresh");

    const result = await batchRefreshUserContextTask.triggerAndWait({});

    log.info("Scheduled user context refresh completed", result);

    return result;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate dynamic context from PostgreSQL data.
 */
async function calculateDynamicContext(
  userId: string,
  organizationId: string
): Promise<DynamicContext> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Get recent UIOs to extract topics and focus
  const recentUios = await db.query.unifiedIntelligenceObject.findMany({
    where: and(
      eq(unifiedIntelligenceObject.organizationId, organizationId),
      eq(unifiedIntelligenceObject.status, "active"),
      gte(unifiedIntelligenceObject.lastUpdatedAt, twentyFourHoursAgo)
    ),
    columns: {
      id: true,
      type: true,
      canonicalTitle: true,
    },
    orderBy: [desc(unifiedIntelligenceObject.lastUpdatedAt)],
    limit: 50,
  });

  // Extract topics from UIO titles (simplified - could use LLM for better extraction)
  const recentTopics = extractTopicsFromTitles(
    recentUios.map((u) => u.canonicalTitle)
  );

  // Get current focus from high-priority/recent items
  const currentFocus = recentUios
    .filter((u) => u.type === "commitment" || u.type === "decision")
    .slice(0, 5)
    .map((u) => u.canonicalTitle);

  // Count commitments
  const commitmentCounts = await db
    .select({
      status: commitment.status,
    })
    .from(commitment)
    .where(
      and(
        eq(commitment.organizationId, organizationId),
        eq(commitment.isUserDismissed, false),
        inArray(commitment.status, ["pending", "in_progress", "waiting", "overdue"])
      )
    );

  const overdueCount = commitmentCounts.filter(
    (c) => c.status === "overdue"
  ).length;
  const activeCount = commitmentCounts.filter(
    (c) => c.status !== "overdue"
  ).length;

  // Count pending decisions
  const pendingDecisions = await db.query.decision.findMany({
    where: and(
      eq(decision.organizationId, organizationId),
      eq(decision.status, "pending"),
      eq(decision.isUserDismissed, false)
    ),
    columns: { id: true },
  });

  // Determine mood indicator based on workload
  const moodIndicator = determineMoodIndicator(
    activeCount,
    overdueCount,
    pendingDecisions.length
  );

  return {
    currentFocus,
    recentTopics,
    activeProjects: [], // TODO: Extract from project UIOs
    unreadCommitmentsCount: activeCount,
    overdueCommitmentsCount: overdueCount,
    pendingDecisionsCount: pendingDecisions.length,
    moodIndicator,
  };
}

/**
 * Extract topics from UIO titles using simple keyword extraction.
 */
function extractTopicsFromTitles(titles: string[]): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
  ]);

  const wordCounts = new Map<string, number>();

  for (const title of titles) {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));

    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  // Return top 10 most frequent words as topics
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

/**
 * Determine mood indicator based on workload metrics.
 */
function determineMoodIndicator(
  activeCount: number,
  overdueCount: number,
  pendingDecisions: number
): "busy" | "stressed" | "normal" | "relaxed" | null {
  const totalWorkload = activeCount + pendingDecisions;

  if (overdueCount > 5 || totalWorkload > 20) {
    return "stressed";
  }
  if (overdueCount > 0 || totalWorkload > 10) {
    return "busy";
  }
  if (totalWorkload < 3) {
    return "relaxed";
  }
  return "normal";
}

/**
 * Update UserProfile in FalkorDB.
 */
async function updateGraphUserProfile(
  userId: string,
  organizationId: string,
  context: DynamicContext
): Promise<boolean> {
  try {
    // Import graph client dynamically to avoid circular deps
    const { callPythonIntelligence } = await import("../lib/intelligence");

    // Call Python service to update graph
    // This is a simplified approach - in production, you'd have a dedicated endpoint
    await callPythonIntelligence("/graph/user-profile/update", {
      userId,
      organizationId,
      dynamicContext: {
        currentFocus: context.currentFocus,
        recentTopics: context.recentTopics,
        activeProjectIds: context.activeProjects,
        unreadCommitmentsCount: context.unreadCommitmentsCount,
        overdueCommitmentsCount: context.overdueCommitmentsCount,
        pendingDecisionsCount: context.pendingDecisionsCount,
        moodIndicator: context.moodIndicator,
        dynamicUpdatedAt: new Date().toISOString(),
      },
    });

    return true;
  } catch (error) {
    log.warn("Failed to update graph user profile", { error, userId });
    // Return true anyway - we don't want to fail the task for graph errors
    // The context calculation is still valuable for caching
    return false;
  }
}

/**
 * Invalidate user context cache in Redis.
 */
async function invalidateUserCache(
  userId: string,
  organizationId: string
): Promise<void> {
  try {
    // Import cache service dynamically
    const { callPythonIntelligence } = await import("../lib/intelligence");

    await callPythonIntelligence("/memory/cache/invalidate", {
      type: "user_context",
      userId,
      organizationId,
    });
  } catch (error) {
    // Cache invalidation is non-critical
    log.debug("Failed to invalidate user cache", { error, userId });
  }
}

// =============================================================================
// EVENT-TRIGGERED REFRESH
// =============================================================================

/**
 * Refresh user context after significant events.
 * Call this after:
 * - New commitment extracted
 * - Decision made
 * - Commitment completed/status changed
 */
export const refreshUserContextOnEventTask = task({
  id: "user-context-refresh-on-event",
  queue: {
    name: "user-context",
    concurrencyLimit: 20,
  },
  retry: {
    maxAttempts: 1,
  },
  maxDuration: 60,
  run: async (payload: {
    userId: string;
    organizationId: string;
    eventType: "commitment_created" | "commitment_completed" | "decision_made";
  }): Promise<{ success: boolean }> => {
    const { userId, organizationId, eventType } = payload;

    log.info("Refreshing user context on event", {
      userId,
      organizationId,
      eventType,
    });

    // Debounce by triggering the main refresh task
    // This consolidates multiple rapid events into a single refresh
    await refreshUserContextTask.trigger(
      {
        userId,
        organizationId,
      },
      {
        debounce: {
          key: `user-context-${userId}-${organizationId}`,
          delay: "30s", // Wait 30 seconds to consolidate events
          mode: "trailing",
        },
      }
    );

    return { success: true };
  },
});
