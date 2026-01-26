// =============================================================================
// CONTACT INTELLIGENCE TRIGGER.DEV TASKS
// =============================================================================
//
// Proactive monitoring tasks for contact relationship management:
// - VIP silence detection
// - Relationship degradation monitoring
// - Commitment breach pattern detection
// - Contact intelligence refresh
//

import { createNotification } from "@memorystack/api/routers/notifications";
import { db } from "@memorystack/db";
import {
  commitment,
  contact,
  contactAlert,
  contactIntelligenceSnapshot,
  organization,
  sourceAccount,
} from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { and, count, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface VIPSilenceResult {
  success: boolean;
  organizationId: string;
  alertsCreated: number;
  contactsChecked: number;
  error?: string;
}

interface RelationshipDegradationResult {
  success: boolean;
  organizationId: string;
  alertsCreated: number;
  contactsChecked: number;
  error?: string;
}

interface CommitmentBreachResult {
  success: boolean;
  organizationId: string;
  alertsCreated: number;
  contactsChecked: number;
  error?: string;
}

interface IntelligenceRefreshResult {
  success: boolean;
  organizationId: string;
  contactsRefreshed: number;
  snapshotsCreated: number;
  error?: string;
}

interface BatchResult {
  success: boolean;
  total: number;
  processed: number;
  alertsCreated: number;
  errors: string[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const VIP_SILENCE_DAYS = 7; // Alert after 7 days of silence
const DEGRADATION_THRESHOLD = 0.2; // 20% drop in score
const DEGRADATION_LOOKBACK_DAYS = 30; // Compare to 30 days ago
const COMMITMENT_BREACH_THRESHOLD = 3; // Alert after 3 overdue commitments
const INTELLIGENCE_REFRESH_BATCH_SIZE = 50;

// =============================================================================
// VIP SILENCE ALERT TASK
// =============================================================================

/**
 * Check for VIP contacts that have gone silent (no interaction in X days).
 * Generates alerts for contacts marked as VIP with no recent communication.
 */
export const vipSilenceAlertTask = task({
  id: "contact-intelligence-vip-silence",
  queue: {
    name: "contact-intelligence",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 120,
  run: async (payload: {
    organizationId: string;
    silenceDays?: number;
  }): Promise<VIPSilenceResult> => {
    const { organizationId, silenceDays = VIP_SILENCE_DAYS } = payload;

    log.info("Checking for VIP silence", { organizationId, silenceDays });

    try {
      const silenceThreshold = new Date(
        Date.now() - silenceDays * 24 * 60 * 60 * 1000
      );

      // Find VIP contacts with no interaction since threshold
      const silentVIPs = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, organizationId),
          eq(contact.isVip, true),
          sql`(${contact.lastInteractionAt} IS NULL OR ${contact.lastInteractionAt} < ${silenceThreshold})`
        ),
        columns: {
          id: true,
          displayName: true,
          primaryEmail: true,
          lastInteractionAt: true,
          daysSinceLastContact: true,
        },
      });

      if (silentVIPs.length === 0) {
        log.info("No silent VIPs found", { organizationId });
        return {
          success: true,
          organizationId,
          alertsCreated: 0,
          contactsChecked: 0,
        };
      }

      log.info("Found silent VIPs", {
        organizationId,
        count: silentVIPs.length,
      });

      let alertsCreated = 0;

      for (const vip of silentVIPs) {
        const daysSilent = vip.daysSinceLastContact ?? silenceDays;
        const alertKey = `vip_silence:${vip.id}:${new Date().toISOString().split("T")[0]}`;

        // Check if alert already exists today
        const existingAlert = await db.query.contactAlert.findFirst({
          where: and(
            eq(contactAlert.contactId, vip.id),
            eq(contactAlert.alertKey, alertKey),
            eq(contactAlert.status, "active")
          ),
        });

        if (existingAlert) {
          continue; // Don't create duplicate
        }

        // Create alert
        await db.insert(contactAlert).values({
          organizationId,
          contactId: vip.id,
          alertType: "vip_silence",
          severity: daysSilent >= 14 ? "critical" : "high",
          message: `VIP contact ${vip.displayName ?? vip.primaryEmail} has been silent for ${daysSilent} days`,
          description: `No communication detected since ${vip.lastInteractionAt?.toISOString() ?? "unknown"}. Consider reaching out to maintain the relationship.`,
          status: "active",
          alertKey,
          context: {
            daysSilent,
            lastInteractionDate: vip.lastInteractionAt?.toISOString(),
            expectedResponseTime: silenceDays,
          },
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });

        alertsCreated++;
      }

      log.info("VIP silence alerts created", {
        organizationId,
        alertsCreated,
        contactsChecked: silentVIPs.length,
      });

      return {
        success: true,
        organizationId,
        alertsCreated,
        contactsChecked: silentVIPs.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("VIP silence alert failed", error, { organizationId });

      return {
        success: false,
        organizationId,
        alertsCreated: 0,
        contactsChecked: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// RELATIONSHIP DEGRADATION CHECK TASK
// =============================================================================

/**
 * Detect contacts with declining engagement, sentiment, or health scores.
 * Compares current scores to historical snapshots.
 */
export const relationshipDegradationTask = task({
  id: "contact-intelligence-relationship-degradation",
  queue: {
    name: "contact-intelligence",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180,
  run: async (payload: {
    organizationId: string;
    degradationThreshold?: number;
    lookbackDays?: number;
  }): Promise<RelationshipDegradationResult> => {
    const {
      organizationId,
      degradationThreshold = DEGRADATION_THRESHOLD,
      lookbackDays = DEGRADATION_LOOKBACK_DAYS,
    } = payload;

    log.info("Checking for relationship degradation", {
      organizationId,
      degradationThreshold,
      lookbackDays,
    });

    try {
      const lookbackDate = new Date(
        Date.now() - lookbackDays * 24 * 60 * 60 * 1000
      );

      // Get contacts with snapshots for comparison
      const contactsWithSnapshots = await db
        .select({
          contactId: contact.id,
          displayName: contact.displayName,
          primaryEmail: contact.primaryEmail,
          currentHealthScore: contact.healthScore,
          currentEngagementScore: contact.engagementScore,
          currentSentimentScore: contact.sentimentScore,
          isVip: contact.isVip,
        })
        .from(contact)
        .where(
          and(
            eq(contact.organizationId, organizationId),
            isNotNull(contact.healthScore)
          )
        );

      let alertsCreated = 0;
      let contactsChecked = 0;

      for (const c of contactsWithSnapshots) {
        contactsChecked++;

        // Get historical snapshot for comparison
        const historicalSnapshot =
          await db.query.contactIntelligenceSnapshot.findFirst({
            where: and(
              eq(contactIntelligenceSnapshot.contactId, c.contactId),
              gte(contactIntelligenceSnapshot.snapshotAt, lookbackDate)
            ),
            orderBy: [contactIntelligenceSnapshot.snapshotAt],
          });

        if (!historicalSnapshot) {
          continue; // No historical data to compare
        }

        // Check each score for degradation
        const scores: Array<{
          type: "sentiment" | "engagement" | "health";
          previous: number | null;
          current: number | null;
        }> = [
          {
            type: "health",
            previous: historicalSnapshot.healthScore,
            current: c.currentHealthScore,
          },
          {
            type: "engagement",
            previous: historicalSnapshot.engagementScore,
            current: c.currentEngagementScore,
          },
          {
            type: "sentiment",
            previous: historicalSnapshot.sentimentScore,
            current: c.currentSentimentScore,
          },
        ];

        for (const score of scores) {
          if (
            score.previous === null ||
            score.current === null ||
            score.previous === 0
          ) {
            continue;
          }

          const percentChange =
            (score.current - score.previous) / score.previous;

          if (percentChange < -degradationThreshold) {
            const alertKey = `degradation:${c.contactId}:${score.type}:${new Date().toISOString().split("T")[0]}`;

            // Check for existing alert
            const existingAlert = await db.query.contactAlert.findFirst({
              where: and(
                eq(contactAlert.contactId, c.contactId),
                eq(contactAlert.alertKey, alertKey),
                eq(contactAlert.status, "active")
              ),
            });

            if (existingAlert) {
              continue;
            }

            // Determine severity based on contact importance and degradation amount
            let severity: "low" | "medium" | "high" | "critical" = "medium";
            if (c.isVip) {
              severity = percentChange < -0.4 ? "critical" : "high";
            } else if (percentChange < -0.4) {
              severity = "high";
            }

            await db.insert(contactAlert).values({
              organizationId,
              contactId: c.contactId,
              alertType: "relationship_degradation",
              severity,
              message: `${score.type.charAt(0).toUpperCase() + score.type.slice(1)} score dropped ${Math.abs(Math.round(percentChange * 100))}% for ${c.displayName ?? c.primaryEmail}`,
              description: `${score.type.charAt(0).toUpperCase() + score.type.slice(1)} score declined from ${(score.previous * 100).toFixed(0)}% to ${(score.current * 100).toFixed(0)}% over the last ${lookbackDays} days.`,
              status: "active",
              alertKey,
              context: {
                previousScore: score.previous,
                currentScore: score.current,
                scoreType: score.type,
                percentChange: Math.round(percentChange * 100),
              },
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            });

            alertsCreated++;
          }
        }
      }

      log.info("Relationship degradation check completed", {
        organizationId,
        alertsCreated,
        contactsChecked,
      });

      return {
        success: true,
        organizationId,
        alertsCreated,
        contactsChecked,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Relationship degradation check failed", error, {
        organizationId,
      });

      return {
        success: false,
        organizationId,
        alertsCreated: 0,
        contactsChecked: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// COMMITMENT BREACH PATTERN TASK
// =============================================================================

/**
 * Identify contacts with multiple overdue commitments (breach pattern).
 * Helps identify relationships that may be at risk due to repeated failures.
 */
export const commitmentBreachPatternTask = task({
  id: "contact-intelligence-commitment-breach",
  queue: {
    name: "contact-intelligence",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180,
  run: async (payload: {
    organizationId: string;
    breachThreshold?: number;
  }): Promise<CommitmentBreachResult> => {
    const { organizationId, breachThreshold = COMMITMENT_BREACH_THRESHOLD } =
      payload;

    log.info("Checking for commitment breach patterns", {
      organizationId,
      breachThreshold,
    });

    try {
      // Get contacts with overdue commitments grouped by debtor/creditor
      const overdueCommitments = await db
        .select({
          commitmentId: commitment.id,
          title: commitment.title,
          direction: commitment.direction,
          sourceConversationId: commitment.sourceConversationId,
          dueDate: commitment.dueDate,
        })
        .from(commitment)
        .where(
          and(
            eq(commitment.organizationId, organizationId),
            eq(commitment.status, "pending"),
            eq(commitment.isUserDismissed, false),
            lt(commitment.dueDate, new Date())
          )
        );

      if (overdueCommitments.length === 0) {
        return {
          success: true,
          organizationId,
          alertsCreated: 0,
          contactsChecked: 0,
        };
      }

      // Group by conversation to find patterns
      const conversationCommitments = new Map<string, typeof overdueCommitments>();
      for (const c of overdueCommitments) {
        if (!c.sourceConversationId) continue;
        const existing = conversationCommitments.get(c.sourceConversationId) ?? [];
        existing.push(c);
        conversationCommitments.set(c.sourceConversationId, existing);
      }

      // Find contacts associated with conversations that have breach patterns
      let alertsCreated = 0;
      const contactsChecked = new Set<string>();

      // Get all contacts that have overdue commitments
      const contactsWithOverdue = await db
        .select({
          contactId: contact.id,
          displayName: contact.displayName,
          primaryEmail: contact.primaryEmail,
          isVip: contact.isVip,
          overdueCount: count(commitment.id).as("overdue_count"),
        })
        .from(contact)
        .innerJoin(
          commitment,
          sql`${commitment.organizationId} = ${contact.organizationId}`
        )
        .where(
          and(
            eq(contact.organizationId, organizationId),
            eq(commitment.status, "pending"),
            eq(commitment.isUserDismissed, false),
            lt(commitment.dueDate, new Date())
          )
        )
        .groupBy(
          contact.id,
          contact.displayName,
          contact.primaryEmail,
          contact.isVip
        )
        .having(sql`count(${commitment.id}) >= ${breachThreshold}`);

      for (const c of contactsWithOverdue) {
        contactsChecked.add(c.contactId);

        const alertKey = `breach_pattern:${c.contactId}:${new Date().toISOString().split("T")[0]}`;

        // Check for existing alert
        const existingAlert = await db.query.contactAlert.findFirst({
          where: and(
            eq(contactAlert.contactId, c.contactId),
            eq(contactAlert.alertKey, alertKey),
            eq(contactAlert.status, "active")
          ),
        });

        if (existingAlert) {
          continue;
        }

        // Get the specific overdue commitment IDs
        const overdueIds = await db
          .select({ id: commitment.id })
          .from(commitment)
          .where(
            and(
              eq(commitment.organizationId, organizationId),
              eq(commitment.status, "pending"),
              eq(commitment.isUserDismissed, false),
              lt(commitment.dueDate, new Date())
            )
          )
          .limit(10);

        const severity = c.isVip
          ? "critical"
          : c.overdueCount >= 5
            ? "high"
            : "medium";

        await db.insert(contactAlert).values({
          organizationId,
          contactId: c.contactId,
          alertType: "commitment_breach_pattern",
          severity,
          message: `${c.displayName ?? c.primaryEmail} has ${c.overdueCount} overdue commitments`,
          description: `This contact has a pattern of ${c.overdueCount} overdue commitments. This may indicate a relationship at risk or need for follow-up.`,
          status: "active",
          alertKey,
          context: {
            overdueCommitmentIds: overdueIds.map((oc) => oc.id),
            overdueCount: Number(c.overdueCount),
          },
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        });

        alertsCreated++;
      }

      log.info("Commitment breach pattern check completed", {
        organizationId,
        alertsCreated,
        contactsChecked: contactsChecked.size,
      });

      return {
        success: true,
        organizationId,
        alertsCreated,
        contactsChecked: contactsChecked.size,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Commitment breach pattern check failed", error, {
        organizationId,
      });

      return {
        success: false,
        organizationId,
        alertsCreated: 0,
        contactsChecked: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// CONTACT INTELLIGENCE REFRESH TASK
// =============================================================================

/**
 * Refresh contact intelligence scores and create daily snapshots.
 * Calls the Python intelligence pipeline for deep analysis.
 */
export const contactIntelligenceRefreshTask = task({
  id: "contact-intelligence-refresh",
  queue: {
    name: "contact-intelligence-refresh",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (payload: {
    organizationId: string;
    contactIds?: string[];
    forceRefresh?: boolean;
  }): Promise<IntelligenceRefreshResult> => {
    const { organizationId, contactIds, forceRefresh = false } = payload;

    log.info("Starting contact intelligence refresh", {
      organizationId,
      specificContacts: contactIds?.length,
      forceRefresh,
    });

    try {
      // Get contacts to refresh
      let contactsToRefresh: Array<{
        id: string;
        displayName: string | null;
        lastIntelligenceAt: Date | null;
      }>;

      if (contactIds && contactIds.length > 0) {
        contactsToRefresh = await db.query.contact.findMany({
          where: and(
            eq(contact.organizationId, organizationId),
            inArray(contact.id, contactIds)
          ),
          columns: {
            id: true,
            displayName: true,
            lastIntelligenceAt: true,
          },
        });
      } else {
        // Get all contacts that need refresh (no refresh in last 24 hours)
        const refreshThreshold = new Date(
          Date.now() - 24 * 60 * 60 * 1000
        );

        contactsToRefresh = await db.query.contact.findMany({
          where: and(
            eq(contact.organizationId, organizationId),
            forceRefresh
              ? undefined
              : sql`(${contact.lastIntelligenceAt} IS NULL OR ${contact.lastIntelligenceAt} < ${refreshThreshold})`
          ),
          columns: {
            id: true,
            displayName: true,
            lastIntelligenceAt: true,
          },
          limit: 500, // Process max 500 contacts per run
        });
      }

      if (contactsToRefresh.length === 0) {
        log.info("No contacts need refresh", { organizationId });
        return {
          success: true,
          organizationId,
          contactsRefreshed: 0,
          snapshotsCreated: 0,
        };
      }

      log.info("Contacts to refresh", {
        organizationId,
        count: contactsToRefresh.length,
      });

      let contactsRefreshed = 0;
      let snapshotsCreated = 0;

      // Process in batches
      for (
        let i = 0;
        i < contactsToRefresh.length;
        i += INTELLIGENCE_REFRESH_BATCH_SIZE
      ) {
        const batch = contactsToRefresh.slice(
          i,
          i + INTELLIGENCE_REFRESH_BATCH_SIZE
        );

        for (const c of batch) {
          try {
            // TODO: Call Python intelligence pipeline
            // For now, create a snapshot with current values
            const currentContact = await db.query.contact.findFirst({
              where: eq(contact.id, c.id),
            });

            if (!currentContact) continue;

            // Create snapshot
            await db.insert(contactIntelligenceSnapshot).values({
              contactId: c.id,
              organizationId,
              periodType: "daily",
              healthScore: currentContact.healthScore,
              importanceScore: currentContact.importanceScore,
              engagementScore: currentContact.engagementScore,
              sentimentScore: currentContact.sentimentScore,
              influenceScore: currentContact.influenceScore,
              bridgingScore: currentContact.bridgingScore,
              churnRiskScore: null, // Computed by pipeline
              interactionCount: currentContact.interactionCount,
              responseRate: currentContact.responseRate,
              relationshipMetrics: null,
              communicationProfile: null,
              roleDetection: null,
              lifecycleDetection: null,
              graphAnalytics: null,
              brief: null,
            });

            snapshotsCreated++;

            // Update last intelligence timestamp
            await db
              .update(contact)
              .set({ lastIntelligenceAt: new Date() })
              .where(eq(contact.id, c.id));

            contactsRefreshed++;
          } catch (err) {
            log.warn("Failed to refresh contact intelligence", err, {
              contactId: c.id,
            });
          }
        }
      }

      log.info("Contact intelligence refresh completed", {
        organizationId,
        contactsRefreshed,
        snapshotsCreated,
      });

      return {
        success: true,
        organizationId,
        contactsRefreshed,
        snapshotsCreated,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Contact intelligence refresh failed", error, {
        organizationId,
      });

      return {
        success: false,
        organizationId,
        contactsRefreshed: 0,
        snapshotsCreated: 0,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH TASKS (FOR ALL ORGANIZATIONS)
// =============================================================================

/**
 * Run VIP silence check for all organizations.
 */
export const batchVIPSilenceAlertTask = task({
  id: "contact-intelligence-batch-vip-silence",
  queue: {
    name: "contact-intelligence-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (): Promise<BatchResult> => {
    log.info("Starting batch VIP silence alert check");

    const orgs = await db.query.organization.findMany({
      columns: { id: true },
    });

    let processed = 0;
    let alertsCreated = 0;
    const errors: string[] = [];

    for (const org of orgs) {
      try {
        const result = await vipSilenceAlertTask.triggerAndWait({
          organizationId: org.id,
        });

        if (result.ok) {
          alertsCreated += result.output.alertsCreated;
        } else {
          errors.push(`Org ${org.id}: ${result.error}`);
        }
        processed++;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Org ${org.id}: ${errorMsg}`);
      }
    }

    log.info("Batch VIP silence alert check completed", {
      total: orgs.length,
      processed,
      alertsCreated,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: orgs.length,
      processed,
      alertsCreated,
      errors,
    };
  },
});

/**
 * Run relationship degradation check for all organizations.
 */
export const batchRelationshipDegradationTask = task({
  id: "contact-intelligence-batch-degradation",
  queue: {
    name: "contact-intelligence-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 900,
  run: async (): Promise<BatchResult> => {
    log.info("Starting batch relationship degradation check");

    const orgs = await db.query.organization.findMany({
      columns: { id: true },
    });

    let processed = 0;
    let alertsCreated = 0;
    const errors: string[] = [];

    for (const org of orgs) {
      try {
        const result = await relationshipDegradationTask.triggerAndWait({
          organizationId: org.id,
        });

        if (result.ok) {
          alertsCreated += result.output.alertsCreated;
        } else {
          errors.push(`Org ${org.id}: ${result.error}`);
        }
        processed++;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Org ${org.id}: ${errorMsg}`);
      }
    }

    log.info("Batch relationship degradation check completed", {
      total: orgs.length,
      processed,
      alertsCreated,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: orgs.length,
      processed,
      alertsCreated,
      errors,
    };
  },
});

/**
 * Run commitment breach pattern check for all organizations.
 */
export const batchCommitmentBreachTask = task({
  id: "contact-intelligence-batch-breach",
  queue: {
    name: "contact-intelligence-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 30_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (): Promise<BatchResult> => {
    log.info("Starting batch commitment breach pattern check");

    const orgs = await db.query.organization.findMany({
      columns: { id: true },
    });

    let processed = 0;
    let alertsCreated = 0;
    const errors: string[] = [];

    for (const org of orgs) {
      try {
        const result = await commitmentBreachPatternTask.triggerAndWait({
          organizationId: org.id,
        });

        if (result.ok) {
          alertsCreated += result.output.alertsCreated;
        } else {
          errors.push(`Org ${org.id}: ${result.error}`);
        }
        processed++;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Org ${org.id}: ${errorMsg}`);
      }
    }

    log.info("Batch commitment breach pattern check completed", {
      total: orgs.length,
      processed,
      alertsCreated,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: orgs.length,
      processed,
      alertsCreated,
      errors,
    };
  },
});

/**
 * Run contact intelligence refresh for all organizations.
 */
export const batchIntelligenceRefreshTask = task({
  id: "contact-intelligence-batch-refresh",
  queue: {
    name: "contact-intelligence-batch",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 60_000,
    maxTimeoutInMs: 300_000,
    factor: 2,
  },
  maxDuration: 1800,
  run: async (): Promise<BatchResult> => {
    log.info("Starting batch contact intelligence refresh");

    const orgs = await db.query.organization.findMany({
      columns: { id: true },
    });

    let processed = 0;
    let totalRefreshed = 0;
    const errors: string[] = [];

    for (const org of orgs) {
      try {
        const result = await contactIntelligenceRefreshTask.triggerAndWait({
          organizationId: org.id,
        });

        if (result.ok) {
          totalRefreshed += result.output.contactsRefreshed;
        } else {
          errors.push(`Org ${org.id}: ${result.error}`);
        }
        processed++;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Org ${org.id}: ${errorMsg}`);
      }
    }

    log.info("Batch contact intelligence refresh completed", {
      total: orgs.length,
      processed,
      totalRefreshed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: orgs.length,
      processed,
      alertsCreated: totalRefreshed, // Repurposing for count
      errors,
    };
  },
});

// =============================================================================
// SCHEDULED TASKS
// =============================================================================

/**
 * Daily VIP silence check - runs at 7 AM UTC.
 */
export const vipSilenceSchedule = schedules.task({
  id: "contact-intelligence-vip-silence-scheduled",
  cron: "0 7 * * *", // 7:00 AM UTC daily
  run: async () => {
    log.info("Running scheduled VIP silence check");

    const result = await batchVIPSilenceAlertTask.triggerAndWait({});

    log.info("Scheduled VIP silence check completed", result);

    return result;
  },
});

/**
 * Weekly relationship degradation check - runs Monday at 6 AM UTC.
 */
export const relationshipDegradationSchedule = schedules.task({
  id: "contact-intelligence-degradation-scheduled",
  cron: "0 6 * * 1", // 6:00 AM UTC every Monday
  run: async () => {
    log.info("Running scheduled relationship degradation check");

    const result = await batchRelationshipDegradationTask.triggerAndWait({});

    log.info("Scheduled relationship degradation check completed", result);

    return result;
  },
});

/**
 * Weekly commitment breach pattern check - runs Wednesday at 6 AM UTC.
 */
export const commitmentBreachSchedule = schedules.task({
  id: "contact-intelligence-breach-scheduled",
  cron: "0 6 * * 3", // 6:00 AM UTC every Wednesday
  run: async () => {
    log.info("Running scheduled commitment breach pattern check");

    const result = await batchCommitmentBreachTask.triggerAndWait({});

    log.info("Scheduled commitment breach pattern check completed", result);

    return result;
  },
});

/**
 * Daily contact intelligence refresh - runs at 3 AM UTC.
 */
export const intelligenceRefreshSchedule = schedules.task({
  id: "contact-intelligence-refresh-scheduled",
  cron: "0 3 * * *", // 3:00 AM UTC daily
  run: async () => {
    log.info("Running scheduled contact intelligence refresh");

    const result = await batchIntelligenceRefreshTask.triggerAndWait({});

    log.info("Scheduled contact intelligence refresh completed", result);

    return result;
  },
});
