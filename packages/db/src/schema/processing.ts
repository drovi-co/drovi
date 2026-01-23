import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { conversation, message, sourceAccount } from "./sources";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ProcessingJobMetadata {
  triggerRunId?: string;
  retryReason?: string;
  parentJobId?: string;
  batchId?: string;
  context?: Record<string, unknown>;
}

export interface ProcessingAuditInput {
  preview: string;
  tokens?: number;
  messageIds?: string[];
}

export interface ProcessingAuditOutput {
  preview: string;
  tokens?: number;
  itemsExtracted?: number;
}

// =============================================================================
// ENUMS
// =============================================================================

export const processingJobTypeEnum = pgEnum("processing_job_type", [
  // Sync jobs
  "sync",
  "backfill",
  "incremental_sync",
  // Analysis jobs
  "thread_analysis",
  "message_analysis",
  "embedding_generation",
  // Extraction jobs
  "claim_extraction",
  "commitment_extraction",
  "decision_extraction",
  "relationship_analysis",
  // Risk & Policy jobs
  "risk_analysis",
  "policy_check",
  // Drafting jobs
  "draft_generation",
  "consistency_check",
]);

export const processingJobStatusEnum = pgEnum("processing_job_status", [
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "retrying",
]);

export const evidenceLinkSourceTypeEnum = pgEnum("evidence_link_source_type", [
  "claim",
  "commitment",
  "decision",
  "contact",
  "topic",
]);

export const evidenceLinkTargetTypeEnum = pgEnum("evidence_link_target_type", [
  "message",
  "thread",
  "attachment",
  "external_url",
]);

// =============================================================================
// PROCESSING JOB TABLE
// =============================================================================

/**
 * Tracks AI processing jobs for debugging, monitoring, and retry logic.
 */
export const processingJob = pgTable(
  "processing_job",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Job type
    type: processingJobTypeEnum("type").notNull(),
    status: processingJobStatusEnum("status").notNull().default("pending"),

    // Scope (what is being processed)
    sourceAccountId: text("source_account_id").references(
      () => sourceAccount.id,
      { onDelete: "cascade" }
    ),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id").references(() => message.id, {
      onDelete: "cascade",
    }),

    // Priority (higher = more urgent)
    priority: integer("priority").notNull().default(0),

    // Timing
    scheduledAt: timestamp("scheduled_at"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Duration tracking
    durationMs: integer("duration_ms"),

    // Error handling
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    errorCode: text("error_code"),

    // Retry logic
    retryCount: integer("retry_count").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(3),
    nextRetryAt: timestamp("next_retry_at"),

    // Progress tracking
    progress: real("progress"), // 0-1
    itemsProcessed: integer("items_processed"),
    itemsTotal: integer("items_total"),
    currentStep: text("current_step"),

    // Trigger.dev integration
    triggerRunId: text("trigger_run_id"),
    triggerTaskId: text("trigger_task_id"),

    // Metadata
    metadata: jsonb("metadata").$type<ProcessingJobMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("processing_job_status_idx").on(table.status),
    index("processing_job_type_idx").on(table.type),
    index("processing_job_source_account_idx").on(table.sourceAccountId),
    index("processing_job_conversation_idx").on(table.conversationId),
    index("processing_job_priority_idx").on(table.priority),
    index("processing_job_scheduled_idx").on(table.scheduledAt),
    index("processing_job_trigger_run_idx").on(table.triggerRunId),
  ]
);

// =============================================================================
// PROCESSING AUDIT TABLE
// =============================================================================

/**
 * Detailed audit log for AI operations.
 * Used for cost tracking, debugging, and compliance.
 */
export const processingAudit = pgTable(
  "processing_audit",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to job
    jobId: text("job_id").references(() => processingJob.id, {
      onDelete: "cascade",
    }),

    // Operation details
    action: text("action").notNull(), // e.g., 'classify_intent', 'extract_claims'
    step: text("step"), // Sub-step within action

    // AI provider info
    model: text("model").notNull(), // e.g., 'claude-3-5-sonnet-20241022'
    provider: text("provider").notNull(), // e.g., 'anthropic', 'openai'

    // Token usage
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),

    // Cost tracking (in cents for precision)
    costCents: integer("cost_cents"),

    // Performance
    latencyMs: integer("latency_ms"),

    // Input/Output previews (truncated for storage)
    inputPreview: text("input_preview"), // First 500 chars
    outputPreview: text("output_preview"), // First 500 chars

    // Results
    confidence: real("confidence"),
    itemsExtracted: integer("items_extracted"),

    // Status
    success: boolean("success").notNull().default(true),
    errorType: text("error_type"),
    errorMessage: text("error_message"),

    // Rate limiting info
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitReset: timestamp("rate_limit_reset"),

    // Request ID for provider debugging
    providerRequestId: text("provider_request_id"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("processing_audit_job_idx").on(table.jobId),
    index("processing_audit_action_idx").on(table.action),
    index("processing_audit_model_idx").on(table.model),
    index("processing_audit_provider_idx").on(table.provider),
    index("processing_audit_created_idx").on(table.createdAt),
    index("processing_audit_success_idx").on(table.success),
  ]
);

// =============================================================================
// EVIDENCE LINK TABLE
// =============================================================================

/**
 * Links intelligence (claims, decisions, commitments) to source evidence.
 * Enables "show me the source" functionality with precise citations.
 */
export const evidenceLink = pgTable(
  "evidence_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Source (the intelligence item)
    sourceType: evidenceLinkSourceTypeEnum("source_type").notNull(),
    sourceId: text("source_id").notNull(),

    // Target (the evidence)
    targetType: evidenceLinkTargetTypeEnum("target_type").notNull(),
    targetId: text("target_id").notNull(),

    // Citation details
    quotedText: text("quoted_text"),
    startOffset: integer("start_offset"), // Character offset in source
    endOffset: integer("end_offset"),

    // Context
    contextBefore: text("context_before"), // Text before quote
    contextAfter: text("context_after"), // Text after quote

    // Relevance
    confidence: real("confidence").notNull().default(1.0),
    relevanceScore: real("relevance_score"),

    // Primary vs supporting evidence
    isPrimary: boolean("is_primary").notNull().default(false),
    evidenceType: text("evidence_type"), // 'direct_quote', 'paraphrase', 'context'

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("evidence_link_source_idx").on(table.sourceType, table.sourceId),
    index("evidence_link_target_idx").on(table.targetType, table.targetId),
    index("evidence_link_primary_idx").on(table.isPrimary),
  ]
);

// =============================================================================
// SYNC STATE TABLE
// =============================================================================

/**
 * Tracks sync state for email accounts.
 * Separate from emailAccount for cleaner separation of concerns.
 */
export const syncState = pgTable(
  "sync_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" })
      .unique(),

    // Sync cursors
    historyId: text("history_id"), // Gmail history ID
    deltaLink: text("delta_link"), // Outlook delta link
    syncToken: text("sync_token"), // Generic sync token

    // Backfill state
    backfillComplete: boolean("backfill_complete").default(false),
    backfillStartedAt: timestamp("backfill_started_at"),
    backfillCompletedAt: timestamp("backfill_completed_at"),
    oldestMessageDate: timestamp("oldest_message_date"),

    // Sync stats
    totalThreadsSynced: integer("total_threads_synced").default(0),
    totalMessagesSynced: integer("total_messages_synced").default(0),
    lastFullSyncAt: timestamp("last_full_sync_at"),
    lastIncrementalSyncAt: timestamp("last_incremental_sync_at"),

    // Error tracking
    consecutiveErrors: integer("consecutive_errors").default(0),
    lastErrorAt: timestamp("last_error_at"),
    lastErrorMessage: text("last_error_message"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("sync_state_source_account_idx").on(table.sourceAccountId),
    index("sync_state_backfill_idx").on(table.backfillComplete),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const processingJobRelations = relations(
  processingJob,
  ({ one, many }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [processingJob.sourceAccountId],
      references: [sourceAccount.id],
    }),
    conversation: one(conversation, {
      fields: [processingJob.conversationId],
      references: [conversation.id],
    }),
    message: one(message, {
      fields: [processingJob.messageId],
      references: [message.id],
    }),
    audits: many(processingAudit),
  })
);

export const processingAuditRelations = relations(
  processingAudit,
  ({ one }) => ({
    job: one(processingJob, {
      fields: [processingAudit.jobId],
      references: [processingJob.id],
    }),
  })
);

export const syncStateRelations = relations(syncState, ({ one }) => ({
  sourceAccount: one(sourceAccount, {
    fields: [syncState.sourceAccountId],
    references: [sourceAccount.id],
  }),
}));

// =============================================================================
// DEAD LETTER QUEUE TABLE
// =============================================================================

export const failedJobStatusEnum = pgEnum("failed_job_status", [
  "pending", // Waiting to be reviewed/retried
  "retried", // Has been retried
  "abandoned", // Manually marked as abandoned
  "resolved", // Issue was resolved without retry
]);

/**
 * Dead letter queue for failed Trigger.dev tasks.
 * Captures jobs that have exceeded max retries for manual review.
 */
export const failedJob = pgTable(
  "failed_job",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Task identification
    taskId: text("task_id").notNull(),
    taskName: text("task_name"),

    // Run identification
    triggerRunId: text("trigger_run_id"),

    // Payload (what was being processed)
    payload: jsonb("payload"),

    // Error details
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    errorCode: text("error_code"),

    // Retry info
    attemptNumber: integer("attempt_number").notNull(),
    maxAttempts: integer("max_attempts"),

    // Timing
    firstAttemptAt: timestamp("first_attempt_at"),
    failedAt: timestamp("failed_at").notNull().defaultNow(),

    // Resolution
    status: failedJobStatusEnum("status").notNull().default("pending"),
    retriedAt: timestamp("retried_at"),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by"), // User ID who resolved
    resolutionNote: text("resolution_note"),

    // Context for debugging
    accountId: text("account_id"),
    threadId: text("thread_id"),
    organizationId: text("organization_id"),

    // Metadata
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("failed_job_task_idx").on(table.taskId),
    index("failed_job_status_idx").on(table.status),
    index("failed_job_failed_at_idx").on(table.failedAt),
    index("failed_job_account_idx").on(table.accountId),
    index("failed_job_org_idx").on(table.organizationId),
  ]
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ProcessingJob = typeof processingJob.$inferSelect;
export type NewProcessingJob = typeof processingJob.$inferInsert;
export type ProcessingAudit = typeof processingAudit.$inferSelect;
export type NewProcessingAudit = typeof processingAudit.$inferInsert;
export type EvidenceLink = typeof evidenceLink.$inferSelect;
export type NewEvidenceLink = typeof evidenceLink.$inferInsert;
export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;
export type FailedJob = typeof failedJob.$inferSelect;
export type NewFailedJob = typeof failedJob.$inferInsert;
