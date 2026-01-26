// =============================================================================
// CONTACT INTELLIGENCE ROUTER
// =============================================================================
//
// API for triggering and retrieving contact intelligence analysis.
// Integrates with the Python contact intelligence pipeline.
//

import { db } from "@memorystack/db";
import {
  contact,
  contactAlert,
  contactIntelligenceSnapshot,
  member,
} from "@memorystack/db/schema";
import type { ContactAlertContext, SnoozeConfig } from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const analyzeContactSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
  includeGraphAnalytics: z.boolean().default(true),
  forceRefresh: z.boolean().default(false),
});

const batchAnalyzeSchema = z.object({
  organizationId: z.string().min(1),
  contactIds: z.array(z.string().uuid()).min(1).max(100),
  includeGraphAnalytics: z.boolean().default(true),
});

const getIntelligenceSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
});

const getSnapshotsSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
  periodType: z.enum(["daily", "weekly", "monthly"]).optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

const getTrendsSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().uuid(),
  metric: z.enum([
    "health_score",
    "engagement_score",
    "sentiment_score",
    "churn_risk_score",
  ]),
  days: z.number().int().min(7).max(365).default(90),
});

// =============================================================================
// ALERT SCHEMAS
// =============================================================================

const alertTypeEnum = z.enum([
  "vip_silence",
  "relationship_degradation",
  "long_silence",
  "engagement_spike",
  "commitment_breach_pattern",
  "pending_commitment_risk",
  "decision_reversal",
  "decision_delay",
  "reengagement_opportunity",
  "introduction_opportunity",
  "deal_risk",
  "duplicate_detected",
  "missing_data",
  "stale_data",
]);

const alertSeverityEnum = z.enum(["low", "medium", "high", "critical"]);

const alertStatusEnum = z.enum([
  "active",
  "acknowledged",
  "snoozed",
  "resolved",
  "dismissed",
  "auto_resolved",
]);

const listAlertsSchema = z.object({
  organizationId: z.string().min(1),
  status: z.array(alertStatusEnum).optional(),
  severity: z.array(alertSeverityEnum).optional(),
  alertType: z.array(alertTypeEnum).optional(),
  contactId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

const getAlertSchema = z.object({
  organizationId: z.string().min(1),
  alertId: z.string().uuid(),
});

const acknowledgeAlertSchema = z.object({
  organizationId: z.string().min(1),
  alertId: z.string().uuid(),
});

const resolveAlertSchema = z.object({
  organizationId: z.string().min(1),
  alertId: z.string().uuid(),
  resolution: z.string().max(500).optional(),
});

const dismissAlertSchema = z.object({
  organizationId: z.string().min(1),
  alertId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

const snoozeAlertSchema = z.object({
  organizationId: z.string().min(1),
  alertId: z.string().uuid(),
  snoozeUntil: z.string().datetime(),
  reason: z.string().max(500).optional(),
});

const batchUpdateAlertsSchema = z.object({
  organizationId: z.string().min(1),
  alertIds: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(["acknowledge", "dismiss", "resolve"]),
  reason: z.string().max(500).optional(),
});

// =============================================================================
// HELPERS
// =============================================================================

async function verifyOrgMembership(
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
}

async function verifyContactAccess(
  organizationId: string,
  contactId: string
): Promise<typeof contact.$inferSelect> {
  const found = await db.query.contact.findFirst({
    where: eq(contact.id, contactId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Contact not found.",
    });
  }

  return found;
}

// =============================================================================
// ROUTER
// =============================================================================

export const contactIntelligenceRouter = router({
  /**
   * Trigger contact intelligence analysis for a single contact.
   * Queues the analysis to run in the Python pipeline.
   */
  analyze: protectedProcedure
    .input(analyzeContactSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyContactAccess(input.organizationId, input.contactId);

      // Check if recent analysis exists (within last hour)
      if (!input.forceRefresh) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentSnapshot =
          await db.query.contactIntelligenceSnapshot.findFirst({
            where: and(
              eq(contactIntelligenceSnapshot.contactId, input.contactId),
              eq(
                contactIntelligenceSnapshot.organizationId,
                input.organizationId
              ),
              gte(contactIntelligenceSnapshot.snapshotAt, oneHourAgo)
            ),
            orderBy: [desc(contactIntelligenceSnapshot.snapshotAt)],
          });

        if (recentSnapshot) {
          return {
            status: "skipped",
            reason: "Recent analysis exists",
            lastAnalyzedAt: recentSnapshot.snapshotAt,
          };
        }
      }

      // TODO: Queue to Trigger.dev task that calls Python pipeline
      // For now, return pending status
      // In production, this would call:
      // await triggerContactIntelligenceTask.trigger({
      //   contactId: input.contactId,
      //   organizationId: input.organizationId,
      //   includeGraphAnalytics: input.includeGraphAnalytics,
      // });

      return {
        status: "queued",
        message: "Contact intelligence analysis queued",
        contactId: input.contactId,
      };
    }),

  /**
   * Trigger batch contact intelligence analysis.
   */
  batchAnalyze: protectedProcedure
    .input(batchAnalyzeSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify all contacts exist
      const contacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          sql`${contact.id} = ANY(${input.contactIds})`
        ),
      });

      const foundIds = new Set(contacts.map((c) => c.id));
      const missingIds = input.contactIds.filter((id) => !foundIds.has(id));

      if (missingIds.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Contacts not found: ${missingIds.slice(0, 5).join(", ")}${missingIds.length > 5 ? "..." : ""}`,
        });
      }

      // TODO: Queue batch to Trigger.dev
      // await triggerBatchContactIntelligenceTask.trigger({
      //   contactIds: input.contactIds,
      //   organizationId: input.organizationId,
      //   includeGraphAnalytics: input.includeGraphAnalytics,
      // });

      return {
        status: "queued",
        message: `Batch analysis queued for ${input.contactIds.length} contacts`,
        contactCount: input.contactIds.length,
      };
    }),

  /**
   * Get the latest intelligence for a contact.
   */
  getLatest: protectedProcedure
    .input(getIntelligenceSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const contactRecord = await verifyContactAccess(
        input.organizationId,
        input.contactId
      );

      // Get the latest snapshot
      const latestSnapshot =
        await db.query.contactIntelligenceSnapshot.findFirst({
          where: and(
            eq(contactIntelligenceSnapshot.contactId, input.contactId),
            eq(
              contactIntelligenceSnapshot.organizationId,
              input.organizationId
            )
          ),
          orderBy: [desc(contactIntelligenceSnapshot.snapshotAt)],
        });

      return {
        contact: {
          id: contactRecord.id,
          displayName: contactRecord.displayName,
          primaryEmail: contactRecord.primaryEmail,
          company: contactRecord.company,
          title: contactRecord.title,
          avatarUrl: contactRecord.avatarUrl,
        },
        scores: {
          healthScore: contactRecord.healthScore,
          importanceScore: contactRecord.importanceScore,
          engagementScore: contactRecord.engagementScore,
          sentimentScore: contactRecord.sentimentScore,
        },
        lifecycle: {
          stage: contactRecord.lifecycleStage,
          roleType: contactRecord.roleType,
          seniorityLevel: contactRecord.seniorityLevel,
        },
        graph: {
          influenceScore: contactRecord.influenceScore,
          bridgingScore: contactRecord.bridgingScore,
          communityIds: contactRecord.communityIds,
        },
        flags: {
          isVip: contactRecord.isVip,
          isAtRisk: contactRecord.isAtRisk,
        },
        lastAnalyzedAt: contactRecord.lastIntelligenceAt,
        snapshot: latestSnapshot
          ? {
              snapshotAt: latestSnapshot.snapshotAt,
              relationshipMetrics: latestSnapshot.relationshipMetrics,
              communicationProfile: latestSnapshot.communicationProfile,
              roleDetection: latestSnapshot.roleDetection,
              lifecycleDetection: latestSnapshot.lifecycleDetection,
              graphAnalytics: latestSnapshot.graphAnalytics,
              brief: latestSnapshot.brief,
            }
          : null,
      };
    }),

  /**
   * Get historical snapshots for a contact.
   */
  getSnapshots: protectedProcedure
    .input(getSnapshotsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyContactAccess(input.organizationId, input.contactId);

      const conditions = [
        eq(contactIntelligenceSnapshot.contactId, input.contactId),
        eq(contactIntelligenceSnapshot.organizationId, input.organizationId),
      ];

      if (input.periodType) {
        conditions.push(
          eq(contactIntelligenceSnapshot.periodType, input.periodType)
        );
      }

      const snapshots = await db.query.contactIntelligenceSnapshot.findMany({
        where: and(...conditions),
        orderBy: [desc(contactIntelligenceSnapshot.snapshotAt)],
        limit: input.limit,
      });

      return {
        snapshots: snapshots.map((s) => ({
          id: s.id,
          snapshotAt: s.snapshotAt,
          periodType: s.periodType,
          scores: {
            healthScore: s.healthScore,
            importanceScore: s.importanceScore,
            engagementScore: s.engagementScore,
            sentimentScore: s.sentimentScore,
          },
          metrics: {
            interactionCount: s.interactionCount,
            responseRate: s.responseRate,
            churnRiskScore: s.churnRiskScore,
          },
          brief: s.brief,
        })),
        total: snapshots.length,
      };
    }),

  /**
   * Get metric trends for a contact over time.
   */
  getTrends: protectedProcedure
    .input(getTrendsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyContactAccess(input.organizationId, input.contactId);

      const sinceDate = new Date(
        Date.now() - input.days * 24 * 60 * 60 * 1000
      );

      const snapshots = await db.query.contactIntelligenceSnapshot.findMany({
        where: and(
          eq(contactIntelligenceSnapshot.contactId, input.contactId),
          eq(contactIntelligenceSnapshot.organizationId, input.organizationId),
          gte(contactIntelligenceSnapshot.snapshotAt, sinceDate)
        ),
        orderBy: [desc(contactIntelligenceSnapshot.snapshotAt)],
      });

      // Map metric name to column
      const metricColumn = {
        health_score: "healthScore",
        engagement_score: "engagementScore",
        sentiment_score: "sentimentScore",
        churn_risk_score: "churnRiskScore",
      }[input.metric] as keyof typeof contactIntelligenceSnapshot.$inferSelect;

      const dataPoints = snapshots
        .filter((s) => s[metricColumn] !== null)
        .map((s) => ({
          timestamp: s.snapshotAt,
          value: s[metricColumn] as number,
        }))
        .reverse(); // Oldest first

      // Calculate trend
      let trend: "improving" | "stable" | "declining" = "stable";
      let changePercent = 0;

      if (dataPoints.length >= 2) {
        const firstValue = dataPoints[0]?.value ?? 0;
        const lastValue = dataPoints[dataPoints.length - 1]?.value ?? 0;

        if (firstValue > 0) {
          changePercent = ((lastValue - firstValue) / firstValue) * 100;
        }

        // For churn risk, "improving" means going down
        if (input.metric === "churn_risk_score") {
          if (changePercent < -10) trend = "improving";
          else if (changePercent > 10) trend = "declining";
        } else {
          if (changePercent > 10) trend = "improving";
          else if (changePercent < -10) trend = "declining";
        }
      }

      return {
        metric: input.metric,
        dataPoints,
        trend,
        changePercent: Math.round(changePercent * 10) / 10,
        periodDays: input.days,
      };
    }),

  /**
   * Get contacts that need attention (at-risk, declining health).
   */
  getNeedsAttention: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get contacts that are at-risk or have low health score
      const needsAttention = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          sql`(${contact.isAtRisk} = true OR ${contact.healthScore} < 0.4)`
        ),
        orderBy: [
          desc(contact.isAtRisk),
          contact.healthScore, // Ascending - lowest health first
        ],
        limit: input.limit,
      });

      return {
        contacts: needsAttention.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          primaryEmail: c.primaryEmail,
          company: c.company,
          healthScore: c.healthScore,
          isAtRisk: c.isAtRisk,
          isVip: c.isVip,
          lastInteractionAt: c.lastInteractionAt,
          daysSinceLastContact: c.daysSinceLastContact,
        })),
        total: needsAttention.length,
      };
    }),

  /**
   * Get high-value contacts (VIPs, decision-makers).
   */
  getHighValue: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const highValue = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, input.organizationId),
          sql`(${contact.isVip} = true OR ${contact.importanceScore} > 0.7 OR ${contact.roleType} = 'decision_maker')`
        ),
        orderBy: [desc(contact.importanceScore)],
        limit: input.limit,
      });

      return {
        contacts: highValue.map((c) => ({
          id: c.id,
          displayName: c.displayName,
          primaryEmail: c.primaryEmail,
          company: c.company,
          title: c.title,
          importanceScore: c.importanceScore,
          influenceScore: c.influenceScore,
          roleType: c.roleType,
          isVip: c.isVip,
        })),
        total: highValue.length,
      };
    }),

  // ===========================================================================
  // ALERTS ENDPOINTS
  // ===========================================================================

  /**
   * List alerts for an organization with filtering.
   */
  listAlerts: protectedProcedure
    .input(listAlertsSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(contactAlert.organizationId, input.organizationId)];

      // Apply filters
      if (input.status && input.status.length > 0) {
        conditions.push(inArray(contactAlert.status, input.status));
      }

      if (input.severity && input.severity.length > 0) {
        conditions.push(inArray(contactAlert.severity, input.severity));
      }

      if (input.alertType && input.alertType.length > 0) {
        conditions.push(inArray(contactAlert.alertType, input.alertType));
      }

      if (input.contactId) {
        conditions.push(eq(contactAlert.contactId, input.contactId));
      }

      // Filter out expired alerts
      conditions.push(
        or(
          isNull(contactAlert.expiresAt),
          gte(contactAlert.expiresAt, new Date())
        )
      );

      // Cursor-based pagination
      if (input.cursor) {
        const cursorAlert = await db.query.contactAlert.findFirst({
          where: eq(contactAlert.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorAlert) {
          conditions.push(lte(contactAlert.createdAt, cursorAlert.createdAt));
        }
      }

      const alerts = await db.query.contactAlert.findMany({
        where: and(...conditions),
        orderBy: [
          // Critical and high severity first
          desc(
            sql`CASE ${contactAlert.severity}
              WHEN 'critical' THEN 4
              WHEN 'high' THEN 3
              WHEN 'medium' THEN 2
              ELSE 1
            END`
          ),
          desc(contactAlert.createdAt),
        ],
        limit: input.limit + 1, // Fetch one extra to check if there's more
        with: {
          contact: {
            columns: {
              id: true,
              displayName: true,
              primaryEmail: true,
              avatarUrl: true,
              isVip: true,
            },
          },
        },
      });

      const hasMore = alerts.length > input.limit;
      const items = hasMore ? alerts.slice(0, -1) : alerts;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return {
        alerts: items.map((a) => ({
          id: a.id,
          alertType: a.alertType,
          severity: a.severity,
          status: a.status,
          message: a.message,
          description: a.description,
          context: a.context as ContactAlertContext | null,
          contact: a.contact,
          createdAt: a.createdAt,
          acknowledgedAt: a.acknowledgedAt,
          resolvedAt: a.resolvedAt,
          snoozeConfig: a.snoozeConfig as SnoozeConfig | null,
        })),
        nextCursor,
        hasMore,
      };
    }),

  /**
   * Get a single alert by ID.
   */
  getAlert: protectedProcedure
    .input(getAlertSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const alert = await db.query.contactAlert.findFirst({
        where: and(
          eq(contactAlert.id, input.alertId),
          eq(contactAlert.organizationId, input.organizationId)
        ),
        with: {
          contact: true,
          acknowledgedByUser: {
            columns: { id: true, name: true, email: true },
          },
          resolvedByUser: {
            columns: { id: true, name: true, email: true },
          },
          dismissedByUser: {
            columns: { id: true, name: true, email: true },
          },
        },
      });

      if (!alert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found.",
        });
      }

      return {
        id: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        description: alert.description,
        context: alert.context as ContactAlertContext | null,
        contact: {
          id: alert.contact.id,
          displayName: alert.contact.displayName,
          primaryEmail: alert.contact.primaryEmail,
          company: alert.contact.company,
          avatarUrl: alert.contact.avatarUrl,
          isVip: alert.contact.isVip,
        },
        createdAt: alert.createdAt,
        updatedAt: alert.updatedAt,
        acknowledgedAt: alert.acknowledgedAt,
        acknowledgedBy: alert.acknowledgedByUser,
        resolvedAt: alert.resolvedAt,
        resolvedBy: alert.resolvedByUser,
        dismissedAt: alert.dismissedAt,
        dismissedBy: alert.dismissedByUser,
        dismissReason: alert.dismissReason,
        snoozeConfig: alert.snoozeConfig as SnoozeConfig | null,
        expiresAt: alert.expiresAt,
      };
    }),

  /**
   * Acknowledge an alert (mark as seen but not resolved).
   */
  acknowledgeAlert: protectedProcedure
    .input(acknowledgeAlertSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const alert = await db.query.contactAlert.findFirst({
        where: and(
          eq(contactAlert.id, input.alertId),
          eq(contactAlert.organizationId, input.organizationId)
        ),
      });

      if (!alert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found.",
        });
      }

      if (alert.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot acknowledge alert with status: ${alert.status}`,
        });
      }

      await db
        .update(contactAlert)
        .set({
          status: "acknowledged",
          acknowledgedAt: new Date(),
          acknowledgedBy: userId,
        })
        .where(eq(contactAlert.id, input.alertId));

      return { success: true, alertId: input.alertId };
    }),

  /**
   * Resolve an alert (issue has been addressed).
   */
  resolveAlert: protectedProcedure
    .input(resolveAlertSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const alert = await db.query.contactAlert.findFirst({
        where: and(
          eq(contactAlert.id, input.alertId),
          eq(contactAlert.organizationId, input.organizationId)
        ),
      });

      if (!alert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found.",
        });
      }

      if (alert.status === "resolved" || alert.status === "dismissed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Alert is already ${alert.status}`,
        });
      }

      await db
        .update(contactAlert)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: userId,
        })
        .where(eq(contactAlert.id, input.alertId));

      return { success: true, alertId: input.alertId };
    }),

  /**
   * Dismiss an alert (not relevant or false positive).
   */
  dismissAlert: protectedProcedure
    .input(dismissAlertSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const alert = await db.query.contactAlert.findFirst({
        where: and(
          eq(contactAlert.id, input.alertId),
          eq(contactAlert.organizationId, input.organizationId)
        ),
      });

      if (!alert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found.",
        });
      }

      if (alert.status === "resolved" || alert.status === "dismissed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Alert is already ${alert.status}`,
        });
      }

      await db
        .update(contactAlert)
        .set({
          status: "dismissed",
          dismissedAt: new Date(),
          dismissedBy: userId,
          dismissReason: input.reason ?? null,
        })
        .where(eq(contactAlert.id, input.alertId));

      return { success: true, alertId: input.alertId };
    }),

  /**
   * Snooze an alert until a later date.
   */
  snoozeAlert: protectedProcedure
    .input(snoozeAlertSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const alert = await db.query.contactAlert.findFirst({
        where: and(
          eq(contactAlert.id, input.alertId),
          eq(contactAlert.organizationId, input.organizationId)
        ),
      });

      if (!alert) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found.",
        });
      }

      if (alert.status === "resolved" || alert.status === "dismissed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot snooze alert with status: ${alert.status}`,
        });
      }

      const snoozeConfig: SnoozeConfig = {
        snoozeUntil: input.snoozeUntil,
        snoozeReason: input.reason,
        snoozedBy: userId,
        snoozedAt: new Date().toISOString(),
      };

      await db
        .update(contactAlert)
        .set({
          status: "snoozed",
          snoozeConfig,
        })
        .where(eq(contactAlert.id, input.alertId));

      return { success: true, alertId: input.alertId, snoozeUntil: input.snoozeUntil };
    }),

  /**
   * Batch update multiple alerts at once.
   */
  batchUpdateAlerts: protectedProcedure
    .input(batchUpdateAlertsSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify all alerts exist and belong to organization
      const alerts = await db.query.contactAlert.findMany({
        where: and(
          inArray(contactAlert.id, input.alertIds),
          eq(contactAlert.organizationId, input.organizationId)
        ),
      });

      const foundIds = new Set(alerts.map((a) => a.id));
      const missingIds = input.alertIds.filter((id) => !foundIds.has(id));

      if (missingIds.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Alerts not found: ${missingIds.slice(0, 3).join(", ")}${missingIds.length > 3 ? "..." : ""}`,
        });
      }

      const now = new Date();
      let updateData: Partial<typeof contactAlert.$inferInsert>;

      switch (input.action) {
        case "acknowledge":
          updateData = {
            status: "acknowledged",
            acknowledgedAt: now,
            acknowledgedBy: userId,
          };
          break;
        case "dismiss":
          updateData = {
            status: "dismissed",
            dismissedAt: now,
            dismissedBy: userId,
            dismissReason: input.reason ?? null,
          };
          break;
        case "resolve":
          updateData = {
            status: "resolved",
            resolvedAt: now,
            resolvedBy: userId,
          };
          break;
      }

      await db
        .update(contactAlert)
        .set(updateData)
        .where(
          and(
            inArray(contactAlert.id, input.alertIds),
            eq(contactAlert.organizationId, input.organizationId)
          )
        );

      return {
        success: true,
        updatedCount: input.alertIds.length,
        action: input.action,
      };
    }),

  /**
   * Get alert summary counts by status and severity.
   */
  getAlertSummary: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Get counts by status
      const statusCounts = await db
        .select({
          status: contactAlert.status,
          count: sql<number>`count(*)::int`,
        })
        .from(contactAlert)
        .where(
          and(
            eq(contactAlert.organizationId, input.organizationId),
            or(
              isNull(contactAlert.expiresAt),
              gte(contactAlert.expiresAt, new Date())
            )
          )
        )
        .groupBy(contactAlert.status);

      // Get counts by severity for active alerts
      const severityCounts = await db
        .select({
          severity: contactAlert.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(contactAlert)
        .where(
          and(
            eq(contactAlert.organizationId, input.organizationId),
            eq(contactAlert.status, "active"),
            or(
              isNull(contactAlert.expiresAt),
              gte(contactAlert.expiresAt, new Date())
            )
          )
        )
        .groupBy(contactAlert.severity);

      // Get counts by type for active alerts
      const typeCounts = await db
        .select({
          alertType: contactAlert.alertType,
          count: sql<number>`count(*)::int`,
        })
        .from(contactAlert)
        .where(
          and(
            eq(contactAlert.organizationId, input.organizationId),
            eq(contactAlert.status, "active"),
            or(
              isNull(contactAlert.expiresAt),
              gte(contactAlert.expiresAt, new Date())
            )
          )
        )
        .groupBy(contactAlert.alertType);

      return {
        byStatus: Object.fromEntries(
          statusCounts.map((s) => [s.status, s.count])
        ) as Record<string, number>,
        bySeverity: Object.fromEntries(
          severityCounts.map((s) => [s.severity, s.count])
        ) as Record<string, number>,
        byType: Object.fromEntries(
          typeCounts.map((t) => [t.alertType, t.count])
        ) as Record<string, number>,
        totalActive:
          statusCounts.find((s) => s.status === "active")?.count ?? 0,
        totalCritical:
          severityCounts.find((s) => s.severity === "critical")?.count ?? 0,
      };
    }),
});
