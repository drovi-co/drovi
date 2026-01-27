import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  vector,
} from "drizzle-orm/pg-core";
import { claim, commitment, contact, decision } from "./intelligence";
import { organization } from "./organization";
import {
  conversation,
  message,
  sourceAccount,
  sourceTypeEnum,
} from "./sources";
import { DEFAULT_EMBEDDING_DIMENSIONS, embeddingStatusEnum } from "./vectors";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Source breadcrumb for displaying cross-source presence
 */
export interface SourceBreadcrumb {
  sourceType: string;
  count: number;
  latestTimestamp: Date | null;
  sourceName: string;
}

/**
 * Timeline event values for tracking changes
 */
export interface TimelineEventValue {
  title?: string;
  description?: string;
  dueDate?: string;
  status?: string;
  confidence?: number;
}

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Types of unified intelligence objects
 */
export const unifiedObjectTypeEnum = pgEnum("unified_object_type", [
  "commitment",
  "decision",
  "topic",
  "project",
  "claim",
  "task",
  "risk",
  "brief",
]);

/**
 * Status of unified intelligence objects
 */
export const unifiedObjectStatusEnum = pgEnum("unified_object_status", [
  "active",
  "merged",
  "archived",
  "dismissed",
]);

/**
 * Role of a source in contributing to a UIO
 */
export const sourceRoleEnum = pgEnum("source_role", [
  "origin",
  "update",
  "confirmation",
  "context",
  "supersession",
]);

/**
 * Timeline event types
 */
export const timelineEventTypeEnum = pgEnum("timeline_event_type", [
  "created",
  "status_changed",
  "due_date_changed",
  "due_date_confirmed",
  "participant_added",
  "source_added",
  "merged",
  "user_verified",
  "user_corrected",
  "auto_completed",
]);

/**
 * Deduplication candidate status
 */
export const deduplicationStatusEnum = pgEnum("deduplication_status", [
  "pending_review",
  "auto_merged",
  "user_merged",
  "user_rejected",
  "expired",
]);

/**
 * Task status for UIO tasks
 */
export const uioTaskStatusEnum = pgEnum("uio_task_status", [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

/**
 * Task priority for UIO tasks
 */
export const uioTaskPriorityEnum = pgEnum("uio_task_priority", [
  "no_priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

/**
 * Risk types for UIO risks
 */
export const uioRiskTypeEnum = pgEnum("uio_risk_type", [
  "deadline_risk",
  "commitment_conflict",
  "unclear_ownership",
  "missing_information",
  "escalation_needed",
  "policy_violation",
  "financial_risk",
  "relationship_risk",
  "sensitive_data",
  "contradiction",
  "fraud_signal",
  "other",
]);

/**
 * Severity levels for UIO risks
 */
export const uioRiskSeverityEnum = pgEnum("uio_risk_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

/**
 * Decision status for UIO decisions
 */
export const uioDecisionStatusEnum = pgEnum("uio_decision_status", [
  "made",
  "pending",
  "deferred",
  "reversed",
]);

/**
 * Brief suggested actions
 */
export const uioBriefActionEnum = pgEnum("uio_brief_action", [
  "respond",
  "review",
  "delegate",
  "schedule",
  "wait",
  "escalate",
  "archive",
  "follow_up",
  "none",
]);

/**
 * Brief priority tiers
 */
export const uioBriefPriorityEnum = pgEnum("uio_brief_priority", [
  "urgent",
  "high",
  "medium",
  "low",
]);

/**
 * Signal classification from Wheeler's Statistical Process Control.
 * Distinguishes special cause (signal) from common cause (noise).
 */
export const signalClassificationEnum = pgEnum("signal_classification", [
  "signal", // Special cause - deviation > 2σ from baseline
  "noise", // Common cause - within normal variation
  "uncertain", // Insufficient data to determine
]);

/**
 * Control chart zones for Wheeler's SPC.
 * Zone A: > 2σ (definite signal)
 * Zone B: 1-2σ (potential signal, needs pattern)
 * Zone C: < 1σ (noise)
 */
export const controlChartZoneEnum = pgEnum("control_chart_zone", [
  "A", // > 2 standard deviations
  "B", // 1-2 standard deviations
  "C", // < 1 standard deviation
]);

// =============================================================================
// UNIFIED INTELLIGENCE OBJECT TABLE
// =============================================================================

/**
 * Core table for unified intelligence objects.
 * A single UIO can span multiple sources (Slack, email, docs, etc.)
 * and represents one commitment, decision, or topic.
 */
export const unifiedIntelligenceObject = pgTable(
  "unified_intelligence_object",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Type and identity
    type: unifiedObjectTypeEnum("type").notNull(),
    status: unifiedObjectStatusEnum("status").notNull().default("active"),

    // Canonical representation (synthesized from all sources)
    canonicalTitle: text("canonical_title").notNull(),
    canonicalDescription: text("canonical_description"),

    // For commitments - due date tracking
    dueDate: timestamp("due_date"),
    dueDateConfidence: real("due_date_confidence"),
    dueDateLastUpdatedAt: timestamp("due_date_last_updated_at"),
    dueDateLastUpdatedSourceId: text("due_date_last_updated_source_id"),

    // Parties (resolved to Contact IDs)
    ownerContactId: text("owner_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    participantContactIds: text("participant_contact_ids").array().default([]),

    // Overall confidence (weighted across sources)
    overallConfidence: real("overall_confidence").notNull().default(0.5),

    // First/last seen across all sources
    firstSeenAt: timestamp("first_seen_at").notNull(),
    lastUpdatedAt: timestamp("last_updated_at").notNull(),
    lastActivitySourceType: sourceTypeEnum("last_activity_source_type"),

    // Merge tracking
    mergedIntoId: text("merged_into_id"),

    // User corrections
    isUserVerified: boolean("is_user_verified").default(false),
    isUserDismissed: boolean("is_user_dismissed").default(false),
    userCorrectedTitle: text("user_corrected_title"),

    // Signal detection (Wheeler's Statistical Process Control)
    signalClassification: signalClassificationEnum("signal_classification"),
    deviationScore: real("deviation_score"), // Standard deviations from baseline
    actionabilityScore: real("actionability_score"), // 0-1, how actionable is this
    controlChartZone: controlChartZoneEnum("control_chart_zone"),

    // Graph-based signal indicators
    contradictsExisting: boolean("contradicts_existing").default(false),
    newClusterDetected: boolean("new_cluster_detected").default(false),
    highCentralityInvolved: boolean("high_centrality_involved").default(false),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_org_idx").on(table.organizationId),
    index("uio_type_idx").on(table.type),
    index("uio_status_idx").on(table.status),
    index("uio_owner_idx").on(table.ownerContactId),
    index("uio_due_date_idx").on(table.dueDate),
    index("uio_last_updated_idx").on(table.lastUpdatedAt),
    index("uio_merged_into_idx").on(table.mergedIntoId),
    index("uio_org_type_status_idx").on(
      table.organizationId,
      table.type,
      table.status
    ),
    // Signal detection indexes
    index("uio_signal_classification_idx").on(table.signalClassification),
    index("uio_actionability_idx").on(table.actionabilityScore),
    index("uio_contradicts_idx").on(table.contradictsExisting),
  ]
);

// =============================================================================
// UNIFIED OBJECT SOURCE TABLE
// =============================================================================

/**
 * Links a UIO to its source references (many-to-many relationship).
 * Each source represents where the UIO was mentioned/updated.
 */
export const unifiedObjectSource = pgTable(
  "unified_object_source",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    unifiedObjectId: text("unified_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),

    // Source identification
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceAccountId: text("source_account_id").references(
      () => sourceAccount.id,
      { onDelete: "set null" }
    ),

    // What this source contributed
    role: sourceRoleEnum("role").notNull().default("context"),

    // Links to actual source data
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => message.id, {
      onDelete: "set null",
    }),

    // Link to original extracted object (for migration)
    originalCommitmentId: text("original_commitment_id").references(
      () => commitment.id,
      { onDelete: "set null" }
    ),
    originalDecisionId: text("original_decision_id").references(
      () => decision.id,
      { onDelete: "set null" }
    ),
    originalClaimId: text("original_claim_id").references(() => claim.id, {
      onDelete: "set null",
    }),

    // Evidence
    quotedText: text("quoted_text"),
    quotedTextStart: text("quoted_text_start"),
    quotedTextEnd: text("quoted_text_end"),

    // What was extracted from this source
    extractedTitle: text("extracted_title"),
    extractedDueDate: timestamp("extracted_due_date"),
    extractedStatus: text("extracted_status"),

    // Confidence for this source's contribution
    confidence: real("confidence").notNull().default(0.5),

    // When this source was added to the UIO
    addedAt: timestamp("added_at").defaultNow().notNull(),
    sourceTimestamp: timestamp("source_timestamp"),

    // Processing metadata
    detectionMethod: text("detection_method"), // "semantic_similarity", "party_match", "explicit_reference", "manual"
    matchScore: real("match_score"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("uos_unified_object_idx").on(table.unifiedObjectId),
    index("uos_source_type_idx").on(table.sourceType),
    index("uos_conversation_idx").on(table.conversationId),
    index("uos_source_timestamp_idx").on(table.sourceTimestamp),
    index("uos_original_commitment_idx").on(table.originalCommitmentId),
    index("uos_original_decision_idx").on(table.originalDecisionId),
    unique("uos_unique_source").on(
      table.unifiedObjectId,
      table.conversationId,
      table.messageId
    ),
  ]
);

// =============================================================================
// UNIFIED OBJECT TIMELINE TABLE
// =============================================================================

/**
 * Event log showing the evolution of a UIO across sources.
 * "Created from Slack" → "Due date updated from Email" → "Confirmed in Docs"
 */
export const unifiedObjectTimeline = pgTable(
  "unified_object_timeline",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    unifiedObjectId: text("unified_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),

    // Event details
    eventType: timelineEventTypeEnum("event_type").notNull(),
    eventDescription: text("event_description").notNull(),

    // What changed
    previousValue: jsonb("previous_value").$type<TimelineEventValue>(),
    newValue: jsonb("new_value").$type<TimelineEventValue>(),

    // Source of the change
    sourceType: sourceTypeEnum("source_type"),
    sourceId: text("source_id"), // Could be conversationId, messageId, or userId
    sourceName: text("source_name"), // e.g., "Slack #engineering", "Email from bob@example.com"

    // Direct link to evidence
    messageId: text("message_id"),
    quotedText: text("quoted_text"),

    // Who/what triggered this
    triggeredBy: text("triggered_by"), // "system", "user", or userId

    // Confidence
    confidence: real("confidence"),

    eventAt: timestamp("event_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("uot_unified_object_idx").on(table.unifiedObjectId),
    index("uot_event_type_idx").on(table.eventType),
    index("uot_event_at_idx").on(table.eventAt),
    index("uot_source_type_idx").on(table.sourceType),
    index("uot_object_event_at_idx").on(table.unifiedObjectId, table.eventAt),
  ]
);

// =============================================================================
// UNIFIED OBJECT EMBEDDING TABLE
// =============================================================================

/**
 * Vector embeddings for UIOs to enable semantic deduplication.
 *
 * Index recommendation:
 * CREATE INDEX ON unified_object_embedding USING hnsw (embedding vector_cosine_ops)
 *   WITH (m = 16, ef_construction = 64);
 */
export const unifiedObjectEmbedding = pgTable(
  "unified_object_embedding",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    unifiedObjectId: text("unified_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Vector embedding
    embedding: vector("embedding", {
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    }).notNull(),

    // Model metadata
    model: text("model").notNull(),
    modelVersion: text("model_version"),

    // Input hash for detecting re-embedding needs
    inputHash: text("input_hash"),

    // Processing status
    status: embeddingStatusEnum("status").default("completed"),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uoe_unified_object_idx").on(table.unifiedObjectId),
    index("uoe_model_idx").on(table.model),
    index("uoe_status_idx").on(table.status),
    // Note: HNSW index should be created via migration for vector column
  ]
);

// =============================================================================
// DEDUPLICATION CANDIDATE TABLE
// =============================================================================

/**
 * Holds potential duplicates for human review.
 * When confidence is high enough, auto-merge happens.
 * Otherwise, users review and decide.
 */
export const deduplicationCandidate = pgTable(
  "deduplication_candidate",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // The two potential duplicates
    sourceObjectId: text("source_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),
    targetObjectId: text("target_object_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" }),

    // Match scores
    semanticSimilarity: real("semantic_similarity").notNull(),
    partyMatchScore: real("party_match_score"),
    temporalScore: real("temporal_score"),
    overallScore: real("overall_score").notNull(),

    // Why we think they match
    matchReasons: text("match_reasons").array().default([]),
    matchExplanation: text("match_explanation"),

    // Status
    status: deduplicationStatusEnum("status")
      .notNull()
      .default("pending_review"),

    // Resolution
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"), // userId or "system"
    resolutionNote: text("resolution_note"),

    // Expiry (auto-expire old candidates)
    expiresAt: timestamp("expires_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("dc_org_idx").on(table.organizationId),
    index("dc_source_idx").on(table.sourceObjectId),
    index("dc_target_idx").on(table.targetObjectId),
    index("dc_status_idx").on(table.status),
    index("dc_score_idx").on(table.overallScore),
    unique("dc_pair_unique").on(table.sourceObjectId, table.targetObjectId),
  ]
);

// =============================================================================
// UIO EXTENSION TABLES (1:1 Type-Specific Details)
// =============================================================================

/**
 * Commitment-specific details for UIOs of type 'commitment'.
 * 1:1 relationship with unifiedIntelligenceObject.
 */
export const uioCommitmentDetails = pgTable(
  "uio_commitment_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Direction - who owes whom
    direction: text("direction").notNull(), // "owed_by_me" | "owed_to_me"

    // Parties (resolved to Contact IDs)
    debtorContactId: text("debtor_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    creditorContactId: text("creditor_contact_id").references(
      () => contact.id,
      {
        onDelete: "set null",
      }
    ),

    // Due date sourcing
    dueDateSource: text("due_date_source"), // "explicit" | "inferred" | "user_set"
    dueDateOriginalText: text("due_date_original_text"), // "next Tuesday", "by EOD"

    // Priority and status
    priority: text("priority").notNull().default("medium"), // low, medium, high, urgent
    status: text("status").notNull().default("pending"), // pending, in_progress, completed, cancelled, overdue, waiting, snoozed

    // Conditional commitments
    isConditional: boolean("is_conditional").default(false),
    condition: text("condition"),

    // Completion tracking
    completedAt: timestamp("completed_at"),
    completedVia: text("completed_via"), // "user_action" | "detected" | "auto"

    // Snooze support
    snoozedUntil: timestamp("snoozed_until"),

    // LLM extraction context
    extractionContext: jsonb("extraction_context").$type<{
      reasoning?: string;
      quotedText?: string;
      commitmentType?: "promise" | "request";
      modelUsed?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_commitment_details_uio_idx").on(table.uioId),
    index("uio_commitment_details_debtor_idx").on(table.debtorContactId),
    index("uio_commitment_details_creditor_idx").on(table.creditorContactId),
    index("uio_commitment_details_direction_idx").on(table.direction),
    index("uio_commitment_details_status_idx").on(table.status),
    index("uio_commitment_details_priority_idx").on(table.priority),
  ]
);

/**
 * Decision-specific details for UIOs of type 'decision'.
 * 1:1 relationship with unifiedIntelligenceObject.
 */
export const uioDecisionDetails = pgTable(
  "uio_decision_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Decision content
    statement: text("statement").notNull(),
    rationale: text("rationale"),

    // Alternatives considered
    alternatives:
      jsonb("alternatives").$type<
        Array<{
          title: string;
          description?: string;
          pros?: string[];
          cons?: string[];
          rejected?: boolean;
        }>
      >(),

    // Decision maker
    decisionMakerContactId: text("decision_maker_contact_id").references(
      () => contact.id,
      { onDelete: "set null" }
    ),

    // Stakeholders
    stakeholderContactIds: text("stakeholder_contact_ids").array().default([]),
    impactAreas: text("impact_areas").array().default([]),

    // Status
    status: uioDecisionStatusEnum("status").notNull().default("made"),

    // When decided
    decidedAt: timestamp("decided_at"),

    // Supersession chain
    supersedesUioId: text("supersedes_uio_id"),
    supersededByUioId: text("superseded_by_uio_id"),

    // LLM extraction context
    extractionContext: jsonb("extraction_context").$type<{
      reasoning?: string;
      quotedText?: string;
      modelUsed?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_decision_details_uio_idx").on(table.uioId),
    index("uio_decision_details_maker_idx").on(table.decisionMakerContactId),
    index("uio_decision_details_status_idx").on(table.status),
    index("uio_decision_details_supersedes_idx").on(table.supersedesUioId),
  ]
);

/**
 * Claim-specific details for UIOs of type 'claim'.
 * 1:1 relationship with unifiedIntelligenceObject.
 */
export const uioClaimDetails = pgTable(
  "uio_claim_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Claim type
    claimType: text("claim_type").notNull(), // fact, promise, request, question, decision, opinion, deadline, price, contact_info, reference, action_item

    // Evidence
    quotedText: text("quoted_text"),
    quotedTextStart: text("quoted_text_start"),
    quotedTextEnd: text("quoted_text_end"),
    normalizedText: text("normalized_text"),

    // Importance
    importance: text("importance").default("medium"), // low, medium, high

    // Source tracking
    sourceMessageIndex: text("source_message_index"),

    // LLM extraction context
    extractionContext: jsonb("extraction_context").$type<{
      entities?: Array<{ type: string; value: string }>;
      temporalReferences?: string[];
      relatedClaimIds?: string[];
      modelUsed?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_claim_details_uio_idx").on(table.uioId),
    index("uio_claim_details_type_idx").on(table.claimType),
    index("uio_claim_details_importance_idx").on(table.importance),
  ]
);

/**
 * Task-specific details for UIOs of type 'task'.
 * 1:1 relationship with unifiedIntelligenceObject.
 */
export const uioTaskDetails = pgTable(
  "uio_task_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Status and priority
    status: uioTaskStatusEnum("status").notNull().default("todo"),
    priority: uioTaskPriorityEnum("priority").notNull().default("medium"),

    // Ownership
    assigneeContactId: text("assignee_contact_id").references(
      () => contact.id,
      {
        onDelete: "set null",
      }
    ),
    createdByContactId: text("created_by_contact_id").references(
      () => contact.id,
      { onDelete: "set null" }
    ),

    // Timeline
    estimatedEffort: text("estimated_effort"), // "1h", "2d", "1 week"
    completedAt: timestamp("completed_at"),

    // Dependencies (UIO IDs)
    dependsOnUioIds: text("depends_on_uio_ids").array().default([]),
    blocksUioIds: text("blocks_uio_ids").array().default([]),

    // Hierarchy
    parentTaskUioId: text("parent_task_uio_id"),
    commitmentUioId: text("commitment_uio_id"), // If derived from a commitment

    // Organization
    project: text("project"),
    tags: text("tags").array().default([]),

    // User overrides
    userOverrides: jsonb("user_overrides").$type<{
      title?: string;
      description?: string;
      dueDate?: string;
      priority?: string;
      status?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_task_details_uio_idx").on(table.uioId),
    index("uio_task_details_status_idx").on(table.status),
    index("uio_task_details_priority_idx").on(table.priority),
    index("uio_task_details_assignee_idx").on(table.assigneeContactId),
    index("uio_task_details_parent_idx").on(table.parentTaskUioId),
    index("uio_task_details_commitment_idx").on(table.commitmentUioId),
    index("uio_task_details_project_idx").on(table.project),
  ]
);

/**
 * Risk-specific details for UIOs of type 'risk'.
 * 1:1 relationship with unifiedIntelligenceObject.
 */
export const uioRiskDetails = pgTable(
  "uio_risk_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // Risk classification
    riskType: uioRiskTypeEnum("risk_type").notNull(),
    severity: uioRiskSeverityEnum("severity").notNull(),

    // Related UIOs
    relatedCommitmentUioIds: text("related_commitment_uio_ids")
      .array()
      .default([]),
    relatedDecisionUioIds: text("related_decision_uio_ids").array().default([]),

    // Action
    suggestedAction: text("suggested_action"),

    // Detailed findings
    findings: jsonb("findings").$type<{
      description?: string;
      evidence?: string[];
      affectedParties?: string[];
      potentialImpact?: string;
      mitigationSteps?: string[];
    }>(),

    // LLM extraction context
    extractionContext: jsonb("extraction_context").$type<{
      reasoning?: string;
      quotedText?: string;
      modelUsed?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_risk_details_uio_idx").on(table.uioId),
    index("uio_risk_details_type_idx").on(table.riskType),
    index("uio_risk_details_severity_idx").on(table.severity),
  ]
);

/**
 * Brief-specific details for UIOs of type 'brief'.
 * 1:1 relationship with unifiedIntelligenceObject.
 * Stores thread summaries and action suggestions.
 */
export const uioBriefDetails = pgTable(
  "uio_brief_details",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    uioId: text("uio_id")
      .notNull()
      .references(() => unifiedIntelligenceObject.id, { onDelete: "cascade" })
      .unique(),

    // 3-line summary
    summary: text("summary").notNull(),

    // Suggested action
    suggestedAction: uioBriefActionEnum("suggested_action").notNull(),
    actionReasoning: text("action_reasoning"),

    // Open loops (unanswered questions, pending items)
    openLoops:
      jsonb("open_loops").$type<
        Array<{
          description: string;
          owner?: string;
          isBlocking?: boolean;
        }>
      >(),

    // Priority tier
    priorityTier: uioBriefPriorityEnum("priority_tier").notNull(),

    // Classification scores
    urgencyScore: real("urgency_score").default(0),
    importanceScore: real("importance_score").default(0),
    sentimentScore: real("sentiment_score").default(0), // -1 to 1

    // Intent
    intentClassification: text("intent_classification"), // request, fyi, social, coordination, etc.

    // Related conversation
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("uio_brief_details_uio_idx").on(table.uioId),
    index("uio_brief_details_action_idx").on(table.suggestedAction),
    index("uio_brief_details_priority_idx").on(table.priorityTier),
    index("uio_brief_details_conversation_idx").on(table.conversationId),
    index("uio_brief_details_urgency_idx").on(table.urgencyScore),
    index("uio_brief_details_importance_idx").on(table.importanceScore),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const unifiedIntelligenceObjectRelations = relations(
  unifiedIntelligenceObject,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [unifiedIntelligenceObject.organizationId],
      references: [organization.id],
    }),
    owner: one(contact, {
      fields: [unifiedIntelligenceObject.ownerContactId],
      references: [contact.id],
    }),
    mergedInto: one(unifiedIntelligenceObject, {
      fields: [unifiedIntelligenceObject.mergedIntoId],
      references: [unifiedIntelligenceObject.id],
      relationName: "mergedObjects",
    }),
    sources: many(unifiedObjectSource),
    timeline: many(unifiedObjectTimeline),
    embedding: one(unifiedObjectEmbedding),
    // Extension tables (1:1)
    commitmentDetails: one(uioCommitmentDetails),
    decisionDetails: one(uioDecisionDetails),
    claimDetails: one(uioClaimDetails),
    taskDetails: one(uioTaskDetails),
    riskDetails: one(uioRiskDetails),
    briefDetails: one(uioBriefDetails),
  })
);

export const unifiedObjectSourceRelations = relations(
  unifiedObjectSource,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [unifiedObjectSource.unifiedObjectId],
      references: [unifiedIntelligenceObject.id],
    }),
    sourceAccount: one(sourceAccount, {
      fields: [unifiedObjectSource.sourceAccountId],
      references: [sourceAccount.id],
    }),
    conversation: one(conversation, {
      fields: [unifiedObjectSource.conversationId],
      references: [conversation.id],
    }),
    message: one(message, {
      fields: [unifiedObjectSource.messageId],
      references: [message.id],
    }),
    originalCommitment: one(commitment, {
      fields: [unifiedObjectSource.originalCommitmentId],
      references: [commitment.id],
    }),
    originalDecision: one(decision, {
      fields: [unifiedObjectSource.originalDecisionId],
      references: [decision.id],
    }),
    originalClaim: one(claim, {
      fields: [unifiedObjectSource.originalClaimId],
      references: [claim.id],
    }),
  })
);

export const unifiedObjectTimelineRelations = relations(
  unifiedObjectTimeline,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [unifiedObjectTimeline.unifiedObjectId],
      references: [unifiedIntelligenceObject.id],
    }),
  })
);

export const unifiedObjectEmbeddingRelations = relations(
  unifiedObjectEmbedding,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [unifiedObjectEmbedding.unifiedObjectId],
      references: [unifiedIntelligenceObject.id],
    }),
  })
);

export const deduplicationCandidateRelations = relations(
  deduplicationCandidate,
  ({ one }) => ({
    organization: one(organization, {
      fields: [deduplicationCandidate.organizationId],
      references: [organization.id],
    }),
    sourceObject: one(unifiedIntelligenceObject, {
      fields: [deduplicationCandidate.sourceObjectId],
      references: [unifiedIntelligenceObject.id],
      relationName: "sourceCandidate",
    }),
    targetObject: one(unifiedIntelligenceObject, {
      fields: [deduplicationCandidate.targetObjectId],
      references: [unifiedIntelligenceObject.id],
      relationName: "targetCandidate",
    }),
  })
);

// Extension table relations
export const uioCommitmentDetailsRelations = relations(
  uioCommitmentDetails,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [uioCommitmentDetails.uioId],
      references: [unifiedIntelligenceObject.id],
    }),
    debtor: one(contact, {
      fields: [uioCommitmentDetails.debtorContactId],
      references: [contact.id],
      relationName: "commitmentDebtor",
    }),
    creditor: one(contact, {
      fields: [uioCommitmentDetails.creditorContactId],
      references: [contact.id],
      relationName: "commitmentCreditor",
    }),
  })
);

export const uioDecisionDetailsRelations = relations(
  uioDecisionDetails,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [uioDecisionDetails.uioId],
      references: [unifiedIntelligenceObject.id],
    }),
    decisionMaker: one(contact, {
      fields: [uioDecisionDetails.decisionMakerContactId],
      references: [contact.id],
    }),
  })
);

export const uioClaimDetailsRelations = relations(
  uioClaimDetails,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [uioClaimDetails.uioId],
      references: [unifiedIntelligenceObject.id],
    }),
  })
);

export const uioTaskDetailsRelations = relations(uioTaskDetails, ({ one }) => ({
  unifiedObject: one(unifiedIntelligenceObject, {
    fields: [uioTaskDetails.uioId],
    references: [unifiedIntelligenceObject.id],
  }),
  assignee: one(contact, {
    fields: [uioTaskDetails.assigneeContactId],
    references: [contact.id],
    relationName: "taskAssignee",
  }),
  createdBy: one(contact, {
    fields: [uioTaskDetails.createdByContactId],
    references: [contact.id],
    relationName: "taskCreator",
  }),
}));

export const uioRiskDetailsRelations = relations(uioRiskDetails, ({ one }) => ({
  unifiedObject: one(unifiedIntelligenceObject, {
    fields: [uioRiskDetails.uioId],
    references: [unifiedIntelligenceObject.id],
  }),
}));

export const uioBriefDetailsRelations = relations(
  uioBriefDetails,
  ({ one }) => ({
    unifiedObject: one(unifiedIntelligenceObject, {
      fields: [uioBriefDetails.uioId],
      references: [unifiedIntelligenceObject.id],
    }),
    conversation: one(conversation, {
      fields: [uioBriefDetails.conversationId],
      references: [conversation.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type UnifiedIntelligenceObject =
  typeof unifiedIntelligenceObject.$inferSelect;
export type NewUnifiedIntelligenceObject =
  typeof unifiedIntelligenceObject.$inferInsert;
export type UnifiedObjectSource = typeof unifiedObjectSource.$inferSelect;
export type NewUnifiedObjectSource = typeof unifiedObjectSource.$inferInsert;
export type UnifiedObjectTimeline = typeof unifiedObjectTimeline.$inferSelect;
export type NewUnifiedObjectTimeline =
  typeof unifiedObjectTimeline.$inferInsert;
export type UnifiedObjectEmbedding = typeof unifiedObjectEmbedding.$inferSelect;
export type NewUnifiedObjectEmbedding =
  typeof unifiedObjectEmbedding.$inferInsert;
export type DeduplicationCandidate = typeof deduplicationCandidate.$inferSelect;
export type NewDeduplicationCandidate =
  typeof deduplicationCandidate.$inferInsert;

// UIO Extension table types
export type UioCommitmentDetails = typeof uioCommitmentDetails.$inferSelect;
export type NewUioCommitmentDetails = typeof uioCommitmentDetails.$inferInsert;
export type UioDecisionDetails = typeof uioDecisionDetails.$inferSelect;
export type NewUioDecisionDetails = typeof uioDecisionDetails.$inferInsert;
export type UioClaimDetails = typeof uioClaimDetails.$inferSelect;
export type NewUioClaimDetails = typeof uioClaimDetails.$inferInsert;
export type UioTaskDetails = typeof uioTaskDetails.$inferSelect;
export type NewUioTaskDetails = typeof uioTaskDetails.$inferInsert;
export type UioRiskDetails = typeof uioRiskDetails.$inferSelect;
export type NewUioRiskDetails = typeof uioRiskDetails.$inferInsert;
export type UioBriefDetails = typeof uioBriefDetails.$inferSelect;
export type NewUioBriefDetails = typeof uioBriefDetails.$inferInsert;
