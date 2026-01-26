// =============================================================================
// CONTACT INTELLIGENCE SNAPSHOT SCHEMA
// =============================================================================
//
// Stores historical snapshots of contact intelligence for trend analysis.
// Enables tracking changes in relationship health, engagement, and lifecycle
// over time to detect patterns and alert on significant changes.
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { contact } from "./intelligence";
import { organization } from "./organization";

// =============================================================================
// CONTACT INTELLIGENCE SNAPSHOT TABLE
// =============================================================================

/**
 * Historical snapshots of contact intelligence metrics.
 *
 * Used for:
 * - Trend analysis (how has relationship evolved?)
 * - Anomaly detection (sudden drops in engagement)
 * - Reporting (weekly/monthly intelligence reports)
 * - ML training data (predict churn, identify patterns)
 */
export const contactIntelligenceSnapshot = pgTable(
  "contact_intelligence_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Which contact this snapshot belongs to
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    // Organization scope
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // When this snapshot was taken
    snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),

    // Snapshot period (for aggregation)
    periodType: text("period_type").notNull().default("daily"), // daily, weekly, monthly

    // =============================================================================
    // CORE SCORES (denormalized for fast queries)
    // =============================================================================

    healthScore: real("health_score"),
    importanceScore: real("importance_score"),
    engagementScore: real("engagement_score"),
    sentimentScore: real("sentiment_score"),

    // =============================================================================
    // RELATIONSHIP METRICS
    // =============================================================================

    interactionCount: real("interaction_count"),
    inboundCount: real("inbound_count"),
    outboundCount: real("outbound_count"),
    avgResponseTimeMinutes: real("avg_response_time_minutes"),
    responseRate: real("response_rate"),
    interactionsPerWeek: real("interactions_per_week"),

    // =============================================================================
    // GRAPH ANALYTICS
    // =============================================================================

    pagerankScore: real("pagerank_score"),
    bridgingScore: real("bridging_score"),
    influenceScore: real("influence_score"),

    // =============================================================================
    // LIFECYCLE & ROLE
    // =============================================================================

    lifecycleStage: text("lifecycle_stage"),
    churnRiskScore: real("churn_risk_score"),
    roleType: text("role_type"),

    // =============================================================================
    // FULL INTELLIGENCE (JSONB for flexibility)
    // =============================================================================

    /**
     * Full relationship metrics snapshot.
     * Stored as JSONB for flexibility while maintaining query performance
     * on the denormalized columns above.
     */
    relationshipMetrics: jsonb("relationship_metrics"),

    /**
     * Full communication profile snapshot.
     */
    communicationProfile: jsonb("communication_profile"),

    /**
     * Full role detection snapshot.
     */
    roleDetection: jsonb("role_detection"),

    /**
     * Full lifecycle detection snapshot.
     */
    lifecycleDetection: jsonb("lifecycle_detection"),

    /**
     * Full graph analytics snapshot.
     */
    graphAnalytics: jsonb("graph_analytics"),

    /**
     * Generated brief at time of snapshot.
     */
    brief: jsonb("brief"),

    // =============================================================================
    // METADATA
    // =============================================================================

    // Analysis metadata
    analysisId: text("analysis_id"), // Links to specific analysis run
    analysisDurationMs: real("analysis_duration_ms"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    // Fast lookup by contact + time range
    index("contact_intelligence_snapshot_contact_time_idx").on(
      table.contactId,
      table.snapshotAt
    ),
    // Organization filter + time
    index("contact_intelligence_snapshot_org_time_idx").on(
      table.organizationId,
      table.snapshotAt
    ),
    // Period type filtering
    index("contact_intelligence_snapshot_period_idx").on(table.periodType),
    // Health score trends
    index("contact_intelligence_snapshot_health_idx").on(table.healthScore),
    // Churn risk monitoring
    index("contact_intelligence_snapshot_churn_idx").on(table.churnRiskScore),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const contactIntelligenceSnapshotRelations = relations(
  contactIntelligenceSnapshot,
  ({ one }) => ({
    contact: one(contact, {
      fields: [contactIntelligenceSnapshot.contactId],
      references: [contact.id],
    }),
    organization: one(organization, {
      fields: [contactIntelligenceSnapshot.organizationId],
      references: [organization.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ContactIntelligenceSnapshot =
  typeof contactIntelligenceSnapshot.$inferSelect;
export type NewContactIntelligenceSnapshot =
  typeof contactIntelligenceSnapshot.$inferInsert;

// =============================================================================
// HELPER INTERFACES
// =============================================================================

/**
 * Trend data for a contact metric over time.
 */
export interface ContactMetricTrend {
  contactId: string;
  metric: string;
  dataPoints: {
    timestamp: Date;
    value: number;
  }[];
  trend: "improving" | "stable" | "declining";
  changePercent: number; // Change from first to last point
}

/**
 * Options for querying contact intelligence snapshots.
 */
export interface SnapshotQueryOptions {
  contactId?: string;
  organizationId: string;
  periodType?: "daily" | "weekly" | "monthly";
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
}
