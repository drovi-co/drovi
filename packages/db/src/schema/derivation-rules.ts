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
} from "drizzle-orm/pg-core";
import { organization } from "./organization";

// =============================================================================
// DERIVATION RULES
// =============================================================================

/**
 * Entity types that can be derived from derivation rules.
 * Maps to EntityNode.entity_type in FalkorDB.
 */
export const derivationOutputTypeEnum = pgEnum("derivation_output_type", [
  "person",
  "organization",
  "project",
  "location",
  "event",
  "document",
  "topic",
  "preference",
  "requirement",
  "procedure",
  "fact",
]);

/**
 * Derivation rules for creating inferred knowledge from existing facts.
 *
 * From Supermemory research:
 * - Memory should derive/learn new information
 * - Example: Person has role PM + discusses payment topics → Person likely works on payments
 *
 * Rules are stored in PostgreSQL for configuration but executed against FalkorDB.
 */
export const derivationRule = pgTable(
  "derivation_rule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // Rule metadata
    name: text("name").notNull(),
    description: text("description"),

    // Cypher pattern to match (executed against FalkorDB)
    // Example: "(e1:Entity {type:'role'})-[:MENTIONED_IN]->(ep)<-[:MENTIONED_IN]-(e2:Entity {type:'topic'})"
    inputPattern: text("input_pattern").notNull(),

    // Output configuration
    outputEntityType: derivationOutputTypeEnum("output_entity_type").notNull(),
    outputTemplate: jsonb("output_template")
      .notNull()
      .$type<{
        nameTemplate: string; // Template with placeholders like "{e1.name} works on {e2.name}"
        summaryTemplate?: string;
        properties?: Record<string, string>; // Additional properties to set
      }>(),

    // Confidence adjustment for derived facts
    confidenceMultiplier: real("confidence_multiplier").default(0.8),

    // Domain scoping
    domain: text("domain"), // "sales", "engineering", "legal", "hr", "finance", "general"

    // Activation
    isActive: boolean("is_active").default(true),

    // Usage tracking
    timesMatched: real("times_matched").default(0),
    lastMatchedAt: timestamp("last_matched_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("derivation_rule_org_idx").on(table.organizationId),
    index("derivation_rule_active_idx").on(table.isActive),
    index("derivation_rule_domain_idx").on(table.domain),
  ]
);

// =============================================================================
// CALIBRATION / PREDICTION TRACKING
// =============================================================================

/**
 * Types of predictions we track for calibration.
 */
export const predictionTypeEnum = pgEnum("prediction_type", [
  "commitment_fulfilled",
  "commitment_overdue",
  "decision_reversed",
  "decision_contested",
  "risk_materialized",
  "task_completed_on_time",
  "contact_response_time",
  "topic_emergence",
]);

/**
 * Outcome status for predictions.
 */
export const predictionOutcomeStatusEnum = pgEnum("prediction_outcome_status", [
  "pending",
  "confirmed",
  "disconfirmed",
  "inconclusive",
  "expired",
]);

/**
 * Intelligence predictions for calibration tracking.
 *
 * From DiBello's Strategic Rehearsal:
 * - Track predictions vs outcomes to calibrate confidence
 * - Predict → Feedback → Update cycle
 * - Measure Brier scores for reliability, resolution, uncertainty
 */
export const intelligencePrediction = pgTable(
  "intelligence_prediction",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // What we're predicting about
    uioId: text("uio_id"), // Link to UIO if applicable

    // Prediction details
    predictionType: predictionTypeEnum("prediction_type").notNull(),
    predictedOutcome: jsonb("predicted_outcome").notNull().$type<{
      description: string;
      probability: number; // 0-1
      threshold?: number; // For binary predictions
      expectedValue?: unknown; // For continuous predictions
    }>(),
    confidence: real("confidence").notNull(),

    // Timing
    predictedAt: timestamp("predicted_at").notNull(),
    evaluateBy: timestamp("evaluate_by"), // When to check outcome

    // Actual outcome
    actualOutcome: jsonb("actual_outcome").$type<{
      description?: string;
      value?: unknown;
      matched: boolean;
    }>(),
    outcomeStatus: predictionOutcomeStatusEnum("outcome_status")
      .notNull()
      .default("pending"),
    outcomeRecordedAt: timestamp("outcome_recorded_at"),
    outcomeSource: text("outcome_source"), // "user_feedback", "detected", "auto", "timeout"

    // Calibration metrics (computed after outcome)
    calibrationError: real("calibration_error"), // |predicted - actual|
    brierScore: real("brier_score"), // (predicted - actual)^2

    // Context for analysis
    modelUsed: text("model_used"),
    extractionContext: jsonb("extraction_context").$type<{
      reasoning?: string;
      evidenceIds?: string[];
      patternId?: string; // If prediction was from pattern match
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("prediction_org_idx").on(table.organizationId),
    index("prediction_type_idx").on(table.predictionType),
    index("prediction_status_idx").on(table.outcomeStatus),
    index("prediction_uio_idx").on(table.uioId),
    index("prediction_evaluate_by_idx").on(table.evaluateBy),
    index("prediction_org_type_status_idx").on(
      table.organizationId,
      table.predictionType,
      table.outcomeStatus
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const derivationRuleRelations = relations(derivationRule, ({ one }) => ({
  organization: one(organization, {
    fields: [derivationRule.organizationId],
    references: [organization.id],
  }),
}));

export const intelligencePredictionRelations = relations(
  intelligencePrediction,
  ({ one }) => ({
    organization: one(organization, {
      fields: [intelligencePrediction.organizationId],
      references: [organization.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type DerivationRule = typeof derivationRule.$inferSelect;
export type NewDerivationRule = typeof derivationRule.$inferInsert;
export type IntelligencePrediction = typeof intelligencePrediction.$inferSelect;
export type NewIntelligencePrediction =
  typeof intelligencePrediction.$inferInsert;
