import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  emailAccount,
  emailMessage,
  emailParticipant,
  emailThread,
} from "./email";
import { organization } from "./organization";

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ClaimMetadata {
  extractionPrompt?: string;
  entities?: Array<{ type: string; value: string }>;
  temporalReferences?: string[];
  relatedClaimIds?: string[];
}

export interface CommitmentMetadata {
  originalText?: string;
  context?: string;
  relatedCommitmentIds?: string[];
  reminderSettings?: {
    enabled: boolean;
    daysBefore: number[];
  };
}

export interface DecisionAlternative {
  title: string;
  description?: string;
  pros?: string[];
  cons?: string[];
  rejected?: boolean;
}

export interface DecisionMetadata {
  originalText?: string;
  context?: string;
  impactAreas?: string[];
  stakeholders?: string[];
}

export interface ContactMetadata {
  timezone?: string;
  preferredContactMethod?: "email" | "phone" | "slack";
  communicationPreferences?: {
    formalityLevel?: "formal" | "casual" | "professional";
    responseExpectation?: "quick" | "normal" | "flexible";
  };
  enrichmentSources?: string[];
  customFields?: Record<string, string>;
}

// =============================================================================
// ENUMS
// =============================================================================

export const claimTypeEnum = pgEnum("claim_type", [
  "fact",
  "promise",
  "request",
  "question",
  "decision",
  "opinion",
  "deadline",
  "price",
  "contact_info",
  "reference",
  "action_item",
]);

export const commitmentStatusEnum = pgEnum("commitment_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "overdue",
  "waiting",
  "snoozed",
]);

export const commitmentPriorityEnum = pgEnum("commitment_priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const commitmentDirectionEnum = pgEnum("commitment_direction", [
  "owed_by_me", // User made the commitment
  "owed_to_me", // Someone else committed to user
]);

// =============================================================================
// CONTACT TABLE (Agent 4: Relationship Intelligence)
// =============================================================================

/**
 * Unified contact profiles with relationship metrics.
 * Built from email participants, enriched by AI.
 */
export const contact = pgTable(
  "contact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // Identity
    primaryEmail: text("primary_email").notNull(),
    emails: text("emails").array().default([]),
    displayName: text("display_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),

    // Professional info
    company: text("company"),
    title: text("title"),
    department: text("department"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    avatarUrl: text("avatar_url"),

    // ==========================================================================
    // RELATIONSHIP METRICS (populated by Relationship Intelligence Agent)
    // ==========================================================================

    // Interaction history
    firstInteractionAt: timestamp("first_interaction_at"),
    lastInteractionAt: timestamp("last_interaction_at"),
    totalThreads: integer("total_threads").notNull().default(0),
    totalMessages: integer("total_messages").notNull().default(0),
    messagesSent: integer("messages_sent").notNull().default(0),
    messagesReceived: integer("messages_received").notNull().default(0),

    // Response patterns
    avgResponseTimeMinutes: integer("avg_response_time_minutes"),
    responseRate: real("response_rate"), // 0-1
    avgWordsPerMessage: integer("avg_words_per_message"),

    // AI-computed scores
    sentimentScore: real("sentiment_score"), // -1 to 1
    importanceScore: real("importance_score"), // 0-1
    healthScore: real("health_score"), // 0-1 (relationship health)
    engagementScore: real("engagement_score"), // 0-1

    // Status flags
    isVip: boolean("is_vip").default(false),
    isAtRisk: boolean("is_at_risk").default(false),
    isInternal: boolean("is_internal").default(false),

    // Risk detection
    riskReason: text("risk_reason"),
    daysSinceLastContact: integer("days_since_last_contact"),

    // User customization
    tags: text("tags").array().default([]),
    notes: text("notes"),
    userOverrideVip: boolean("user_override_vip"),

    // Enrichment tracking
    lastEnrichedAt: timestamp("last_enriched_at"),
    enrichmentSource: text("enrichment_source"),

    // Metadata
    metadata: jsonb("metadata").$type<ContactMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("contact_org_idx").on(table.organizationId),
    index("contact_primary_email_idx").on(table.primaryEmail),
    index("contact_importance_idx").on(table.importanceScore),
    index("contact_health_idx").on(table.healthScore),
    index("contact_vip_idx").on(table.isVip),
    index("contact_at_risk_idx").on(table.isAtRisk),
    index("contact_last_interaction_idx").on(table.lastInteractionAt),
    unique("contact_org_email_unique").on(
      table.organizationId,
      table.primaryEmail
    ),
  ]
);

// =============================================================================
// CLAIM TABLE (Agent 1: Thread Understanding)
// =============================================================================

/**
 * Atomic facts extracted from emails.
 * Foundation for all intelligence extraction.
 */
export const claim = pgTable(
  "claim",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id").references(() => emailThread.id, {
      onDelete: "cascade",
    }),
    messageId: text("message_id").references(() => emailMessage.id, {
      onDelete: "set null",
    }),

    // Claim content
    type: claimTypeEnum("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text"),

    // Evidence
    confidence: real("confidence").notNull().default(0.5),
    sourceMessageIds: text("source_message_ids").array().notNull().default([]),
    quotedText: text("quoted_text"),
    quotedTextStart: integer("quoted_text_start"),
    quotedTextEnd: integer("quoted_text_end"),

    // Extraction metadata
    extractedAt: timestamp("extracted_at").defaultNow().notNull(),
    extractionModel: text("extraction_model"),
    extractionVersion: text("extraction_version"),

    // User corrections
    isUserVerified: boolean("is_user_verified").default(false),
    isUserDismissed: boolean("is_user_dismissed").default(false),
    userCorrectedText: text("user_corrected_text"),
    userCorrectedType: claimTypeEnum("user_corrected_type"),

    // Metadata
    metadata: jsonb("metadata").$type<ClaimMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("claim_org_idx").on(table.organizationId),
    index("claim_thread_idx").on(table.threadId),
    index("claim_message_idx").on(table.messageId),
    index("claim_type_idx").on(table.type),
    index("claim_confidence_idx").on(table.confidence),
    index("claim_extracted_idx").on(table.extractedAt),
  ]
);

// =============================================================================
// COMMITMENT TABLE (Agent 2: Commitment & Follow-up)
// =============================================================================

/**
 * Tracks promises, tasks, and follow-ups extracted from emails.
 */
export const commitment = pgTable(
  "commitment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // Link to source claim
    claimId: text("claim_id").references(() => claim.id, {
      onDelete: "set null",
    }),

    // Parties involved
    debtorContactId: text("debtor_contact_id").references(() => contact.id, {
      onDelete: "set null",
    }),
    creditorContactId: text("creditor_contact_id").references(
      () => contact.id,
      {
        onDelete: "set null",
      }
    ),
    direction: commitmentDirectionEnum("direction").notNull(),

    // Commitment details
    title: text("title").notNull(),
    description: text("description"),

    // Due date
    dueDate: timestamp("due_date"),
    dueDateConfidence: real("due_date_confidence"),
    dueDateSource: text("due_date_source"), // 'explicit', 'inferred', 'user_set'
    dueDateOriginalText: text("due_date_original_text"),

    // Status
    status: commitmentStatusEnum("status").notNull().default("pending"),
    priority: commitmentPriorityEnum("priority").notNull().default("medium"),

    // Completion tracking
    completedAt: timestamp("completed_at"),
    completedVia: text("completed_via"), // 'user_action', 'detected', 'auto'

    // Snooze support
    snoozedUntil: timestamp("snoozed_until"),

    // Reminder tracking
    lastReminderAt: timestamp("last_reminder_at"),
    reminderCount: integer("reminder_count").notNull().default(0),
    nextReminderAt: timestamp("next_reminder_at"),

    // Source evidence
    sourceThreadId: text("source_thread_id").references(() => emailThread.id, {
      onDelete: "set null",
    }),
    sourceMessageId: text("source_message_id").references(
      () => emailMessage.id,
      {
        onDelete: "set null",
      }
    ),

    // Confidence
    confidence: real("confidence").notNull().default(0.5),

    // User corrections
    isUserVerified: boolean("is_user_verified").default(false),
    isUserDismissed: boolean("is_user_dismissed").default(false),

    // Metadata
    metadata: jsonb("metadata").$type<CommitmentMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("commitment_org_idx").on(table.organizationId),
    index("commitment_debtor_idx").on(table.debtorContactId),
    index("commitment_creditor_idx").on(table.creditorContactId),
    index("commitment_direction_idx").on(table.direction),
    index("commitment_status_idx").on(table.status),
    index("commitment_priority_idx").on(table.priority),
    index("commitment_due_idx").on(table.dueDate),
    index("commitment_source_thread_idx").on(table.sourceThreadId),
  ]
);

// =============================================================================
// DECISION TABLE (Agent 3: Decision Memory)
// =============================================================================

/**
 * Stores decisions with rationale and supersession tracking.
 */
export const decision = pgTable(
  "decision",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // Link to source claim
    claimId: text("claim_id").references(() => claim.id, {
      onDelete: "set null",
    }),

    // Decision content
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    rationale: text("rationale"),

    // Alternatives considered
    alternatives: jsonb("alternatives").$type<DecisionAlternative[]>(),

    // People involved
    ownerContactIds: text("owner_contact_ids").array().default([]),
    participantContactIds: text("participant_contact_ids").array().default([]),

    // When decided
    decidedAt: timestamp("decided_at").notNull(),

    // Confidence
    confidence: real("confidence").notNull().default(0.5),

    // Supersession chain
    supersededById: text("superseded_by_id"),
    supersededAt: timestamp("superseded_at"),
    supersedes: text("supersedes"), // ID of decision this supersedes

    // Source evidence
    sourceThreadId: text("source_thread_id").references(() => emailThread.id, {
      onDelete: "set null",
    }),
    sourceMessageIds: text("source_message_ids").array().default([]),

    // Topics (array of topic IDs)
    topicIds: text("topic_ids").array().default([]),

    // User corrections
    isUserVerified: boolean("is_user_verified").default(false),
    isUserDismissed: boolean("is_user_dismissed").default(false),

    // Metadata
    metadata: jsonb("metadata").$type<DecisionMetadata>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("decision_org_idx").on(table.organizationId),
    index("decision_decided_at_idx").on(table.decidedAt),
    index("decision_superseded_idx").on(table.supersededById),
    index("decision_source_thread_idx").on(table.sourceThreadId),
    index("decision_confidence_idx").on(table.confidence),
  ]
);

// =============================================================================
// TOPIC TABLE (Dynamic Topic Taxonomy)
// =============================================================================

/**
 * Dynamic topic taxonomy for organizing threads, claims, and decisions.
 */
export const topic = pgTable(
  "topic",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),

    // Hierarchy
    parentId: text("parent_id"),

    // Topic info
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),

    // AI confidence
    confidence: real("confidence").notNull().default(0.5),

    // Usage stats
    threadCount: integer("thread_count").notNull().default(0),
    claimCount: integer("claim_count").notNull().default(0),
    decisionCount: integer("decision_count").notNull().default(0),

    // Activity
    lastUsedAt: timestamp("last_used_at"),

    // User created vs AI detected
    isUserCreated: boolean("is_user_created").default(false),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("topic_org_idx").on(table.organizationId),
    index("topic_parent_idx").on(table.parentId),
    index("topic_slug_idx").on(table.slug),
    unique("topic_org_slug_unique").on(table.organizationId, table.slug),
  ]
);

// =============================================================================
// THREAD-TOPIC JUNCTION TABLE
// =============================================================================

/**
 * Many-to-many relationship between threads and topics.
 */
export const threadTopic = pgTable(
  "thread_topic",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThread.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topic.id, { onDelete: "cascade" }),
    confidence: real("confidence").notNull().default(0.5),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.topicId] }),
    index("thread_topic_thread_idx").on(table.threadId),
    index("thread_topic_topic_idx").on(table.topicId),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const contactRelations = relations(contact, ({ many, one }) => ({
  organization: one(organization, {
    fields: [contact.organizationId],
    references: [organization.id],
  }),
  commitmentsAsDebtor: many(commitment, { relationName: "debtorCommitments" }),
  commitmentsAsCreditor: many(commitment, {
    relationName: "creditorCommitments",
  }),
  participants: many(emailParticipant),
}));

export const claimRelations = relations(claim, ({ many, one }) => ({
  organization: one(organization, {
    fields: [claim.organizationId],
    references: [organization.id],
  }),
  thread: one(emailThread, {
    fields: [claim.threadId],
    references: [emailThread.id],
  }),
  message: one(emailMessage, {
    fields: [claim.messageId],
    references: [emailMessage.id],
  }),
  commitments: many(commitment),
  decisions: many(decision),
}));

export const commitmentRelations = relations(commitment, ({ one }) => ({
  organization: one(organization, {
    fields: [commitment.organizationId],
    references: [organization.id],
  }),
  claim: one(claim, {
    fields: [commitment.claimId],
    references: [claim.id],
  }),
  debtor: one(contact, {
    fields: [commitment.debtorContactId],
    references: [contact.id],
    relationName: "debtorCommitments",
  }),
  creditor: one(contact, {
    fields: [commitment.creditorContactId],
    references: [contact.id],
    relationName: "creditorCommitments",
  }),
  sourceThread: one(emailThread, {
    fields: [commitment.sourceThreadId],
    references: [emailThread.id],
  }),
  sourceMessage: one(emailMessage, {
    fields: [commitment.sourceMessageId],
    references: [emailMessage.id],
  }),
}));

export const decisionRelations = relations(decision, ({ one }) => ({
  organization: one(organization, {
    fields: [decision.organizationId],
    references: [organization.id],
  }),
  claim: one(claim, {
    fields: [decision.claimId],
    references: [claim.id],
  }),
  sourceThread: one(emailThread, {
    fields: [decision.sourceThreadId],
    references: [emailThread.id],
  }),
}));

export const topicRelations = relations(topic, ({ many, one }) => ({
  organization: one(organization, {
    fields: [topic.organizationId],
    references: [organization.id],
  }),
  parent: one(topic, {
    fields: [topic.parentId],
    references: [topic.id],
    relationName: "topicHierarchy",
  }),
  children: many(topic, { relationName: "topicHierarchy" }),
  threadTopics: many(threadTopic),
}));

export const threadTopicRelations = relations(threadTopic, ({ one }) => ({
  thread: one(emailThread, {
    fields: [threadTopic.threadId],
    references: [emailThread.id],
  }),
  topic: one(topic, {
    fields: [threadTopic.topicId],
    references: [topic.id],
  }),
}));

// =============================================================================
// TRIAGE ENUMS (Agent 6: Triage & Routing)
// =============================================================================

export const triageActionEnum = pgEnum("triage_action", [
  "respond",
  "archive",
  "delegate",
  "schedule",
  "wait",
  "escalate",
  "review",
]);

export const triagePriorityTierEnum = pgEnum("triage_priority_tier", [
  "urgent",
  "high",
  "medium",
  "low",
]);

export const triageRuleTriggerTypeEnum = pgEnum("triage_rule_trigger_type", [
  "sender",
  "subject",
  "content",
  "label",
]);

export const triageRuleTriggerConditionEnum = pgEnum(
  "triage_rule_trigger_condition",
  ["contains", "equals", "matches"]
);

export const triageRuleActionEnum = pgEnum("triage_rule_action", [
  "archive",
  "label",
  "forward",
  "priority",
]);

// =============================================================================
// TRIAGE RESULT TABLE (Agent 6: Triage & Routing)
// =============================================================================

/**
 * Stores triage analysis results for email threads.
 * Created by the Triage Agent with action suggestions and priority scores.
 */
export const triageResult = pgTable(
  "triage_result",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThread.id, { onDelete: "cascade" })
      .unique(),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),

    // Suggested action
    suggestedAction: triageActionEnum("suggested_action").notNull(),
    confidence: real("confidence").notNull().default(0.5),
    reasoning: text("reasoning"),

    // Priority scoring
    priorityTier: triagePriorityTierEnum("priority_tier").notNull(),
    urgencyScore: real("urgency_score").notNull().default(0),
    importanceScore: real("importance_score").notNull().default(0),

    // LLM usage flag
    usedLlm: boolean("used_llm").notNull().default(false),

    // Delegation suggestion (if applicable)
    delegateTo: text("delegate_to"),
    delegateReason: text("delegate_reason"),

    // Scheduling suggestion (if applicable)
    scheduledFor: timestamp("scheduled_for"),
    scheduleReason: text("schedule_reason"),

    // Rule that triggered (if any)
    matchedRuleId: text("matched_rule_id"),

    // User feedback
    userAccepted: boolean("user_accepted"),
    userFeedback: text("user_feedback"),
    userActionTaken: text("user_action_taken"),

    // Additional details
    details: jsonb("details").$type<Record<string, unknown>>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("triage_result_thread_idx").on(table.threadId),
    index("triage_result_account_idx").on(table.accountId),
    index("triage_result_action_idx").on(table.suggestedAction),
    index("triage_result_priority_idx").on(table.priorityTier),
    index("triage_result_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// TRIAGE RULE TABLE (Agent 6: Triage & Routing)
// =============================================================================

export interface TriageRuleTrigger {
  type: "sender" | "subject" | "content" | "label";
  condition: "contains" | "equals" | "matches";
  value: string;
}

/**
 * Stores user-defined and learned automation rules for email triage.
 */
export const triageRule = pgTable(
  "triage_rule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),

    // Rule identity
    name: text("name").notNull(),
    description: text("description"),

    // Trigger conditions
    trigger: jsonb("trigger").$type<TriageRuleTrigger>().notNull(),

    // Action to take
    action: triageRuleActionEnum("action").notNull(),
    actionValue: text("action_value"), // Label name, forward address, priority level

    // Rule state
    enabled: boolean("enabled").notNull().default(true),

    // Learning/suggestion origin
    isUserCreated: boolean("is_user_created").notNull().default(true),
    suggestedByAi: boolean("suggested_by_ai").notNull().default(false),
    suggestionConfidence: real("suggestion_confidence"),

    // Usage stats
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at"),

    // Ordering
    priority: integer("priority").notNull().default(0),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("triage_rule_account_idx").on(table.accountId),
    index("triage_rule_enabled_idx").on(table.enabled),
    index("triage_rule_priority_idx").on(table.priority),
  ]
);

// =============================================================================
// TRIAGE RELATIONS
// =============================================================================

export const triageResultRelations = relations(triageResult, ({ one }) => ({
  thread: one(emailThread, {
    fields: [triageResult.threadId],
    references: [emailThread.id],
  }),
  account: one(emailAccount, {
    fields: [triageResult.accountId],
    references: [emailAccount.id],
  }),
  matchedRule: one(triageRule, {
    fields: [triageResult.matchedRuleId],
    references: [triageRule.id],
  }),
}));

export const triageRuleRelations = relations(triageRule, ({ one, many }) => ({
  account: one(emailAccount, {
    fields: [triageRule.accountId],
    references: [emailAccount.id],
  }),
  triageResults: many(triageResult),
}));

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type Contact = typeof contact.$inferSelect;
export type NewContact = typeof contact.$inferInsert;
export type Claim = typeof claim.$inferSelect;
export type NewClaim = typeof claim.$inferInsert;
export type Commitment = typeof commitment.$inferSelect;
export type NewCommitment = typeof commitment.$inferInsert;
export type Decision = typeof decision.$inferSelect;
export type NewDecision = typeof decision.$inferInsert;
export type Topic = typeof topic.$inferSelect;
export type NewTopic = typeof topic.$inferInsert;
export type ThreadTopic = typeof threadTopic.$inferSelect;
export type NewThreadTopic = typeof threadTopic.$inferInsert;
export type TriageResult = typeof triageResult.$inferSelect;
export type NewTriageResult = typeof triageResult.$inferInsert;
export type TriageRule = typeof triageRule.$inferSelect;
export type NewTriageRule = typeof triageRule.$inferInsert;

// =============================================================================
// RISK ANALYSIS ENUMS (Agent 8: Policy & Risk)
// =============================================================================

export const riskLevelEnum = pgEnum("risk_level", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const riskAnalysisStatusEnum = pgEnum("risk_analysis_status", [
  "pending",
  "analyzing",
  "completed",
  "approved",
  "blocked",
  "error",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "not_required",
  "pending",
  "approved",
  "rejected",
]);

export const policyCategoryEnum = pgEnum("policy_category", [
  "communication",
  "data_handling",
  "financial",
  "compliance",
  "security",
  "custom",
]);

export const policySeverityEnum = pgEnum("policy_severity", [
  "info",
  "warning",
  "violation",
  "critical",
]);

// =============================================================================
// RISK ANALYSIS TABLE (Agent 8: Policy & Risk)
// =============================================================================

export interface RiskAnalysisDetails {
  contradictions?: Array<{
    draftStatement: string;
    conflictingSource: string;
    sourceId: string;
    severity: string;
    suggestion?: string;
  }>;
  sensitiveData?: {
    piiFindings: Array<{
      type: string;
      location: string;
      severity: string;
    }>;
    confidentialFindings: Array<{
      category: string;
      location: string;
      severity: string;
    }>;
    recipientWarnings: Array<{
      recipient: string;
      reason: string;
      recommendation: string;
    }>;
  };
  fraudSignals?: {
    impersonation: Array<{
      type: string;
      details: string;
      severity: string;
    }>;
    invoiceFraud: Array<{
      type: string;
      details: string;
      severity: string;
    }>;
    phishing: Array<{
      type: string;
      details: string;
      severity: string;
    }>;
  };
  policyViolations?: Array<{
    ruleId: string;
    ruleName: string;
    category: string;
    severity: string;
    description: string;
    matchedContent?: string;
  }>;
  recommendations?: string[];
}

/**
 * Stores risk analysis results for emails and drafts.
 * Created by the Risk Agent with fraud, sensitivity, and policy checks.
 */
export const riskAnalysis = pgTable(
  "risk_analysis",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    accountId: text("account_id")
      .notNull()
      .references(() => emailAccount.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => emailThread.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => emailMessage.id, {
      onDelete: "set null",
    }),

    // Analysis type
    analysisType: text("analysis_type").notNull(), // 'incoming' | 'draft'

    // Status tracking
    status: riskAnalysisStatusEnum("status").notNull().default("pending"),

    // Overall risk scores
    overallRiskScore: real("overall_risk_score").default(0),
    overallRiskLevel: riskLevelEnum("overall_risk_level"),

    // Risk category flags
    hasContradictions: boolean("has_contradictions").default(false),
    hasSensitiveData: boolean("has_sensitive_data").default(false),
    hasFraudSignals: boolean("has_fraud_signals").default(false),
    hasPolicyViolations: boolean("has_policy_violations").default(false),

    // Category scores
    contradictionScore: real("contradiction_score").default(0),
    sensitiveDataScore: real("sensitive_data_score").default(0),
    fraudScore: real("fraud_score").default(0),
    policyScore: real("policy_score").default(0),

    // Approval workflow
    requiresApproval: boolean("requires_approval").default(false),
    approvalStatus: approvalStatusEnum("approval_status").default("not_required"),
    approvalRequestedBy: text("approval_requested_by"),
    approvalRequestedAt: timestamp("approval_requested_at"),
    approvalReason: text("approval_reason"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at"),
    approvalComments: text("approval_comments"),

    // Draft content (for draft analysis)
    draftContent: text("draft_content"),
    draftSubject: text("draft_subject"),
    draftRecipients: jsonb("draft_recipients").$type<
      Array<{
        email: string;
        name?: string;
        domain: string;
        isExternal: boolean;
      }>
    >(),

    // Detailed results
    details: jsonb("details").$type<RiskAnalysisDetails>(),

    // Processing info
    processingTimeMs: integer("processing_time_ms"),
    analyzedAt: timestamp("analyzed_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("risk_analysis_account_idx").on(table.accountId),
    index("risk_analysis_thread_idx").on(table.threadId),
    index("risk_analysis_message_idx").on(table.messageId),
    index("risk_analysis_status_idx").on(table.status),
    index("risk_analysis_risk_level_idx").on(table.overallRiskLevel),
    index("risk_analysis_approval_idx").on(table.approvalStatus),
    index("risk_analysis_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// POLICY RULE TABLE (Agent 8: Policy & Risk)
// =============================================================================

export interface PolicyCondition {
  type: string;
  field: string;
  operator: string;
  value: string | number | string[];
  caseSensitive?: boolean;
}

export interface PolicyAction {
  type: "block" | "warn" | "require_approval" | "notify" | "audit_log" | "redact" | "encrypt";
  config?: Record<string, unknown>;
}

/**
 * Stores organization-defined policy rules for risk detection.
 */
export const policyRule = pgTable(
  "policy_rule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Rule identity
    name: text("name").notNull(),
    description: text("description"),
    category: policyCategoryEnum("category").notNull(),

    // Rule definition
    conditions: jsonb("conditions").$type<PolicyCondition[]>().notNull(),
    actions: jsonb("actions").$type<PolicyAction[]>().notNull(),

    // Severity
    severity: policySeverityEnum("severity").notNull(),

    // State
    enabled: boolean("enabled").notNull().default(true),

    // Usage stats
    hitCount: integer("hit_count").notNull().default(0),
    lastHitAt: timestamp("last_hit_at"),

    // Audit
    createdBy: text("created_by"),
    lastModifiedBy: text("last_modified_by"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("policy_rule_org_idx").on(table.organizationId),
    index("policy_rule_category_idx").on(table.category),
    index("policy_rule_severity_idx").on(table.severity),
    index("policy_rule_enabled_idx").on(table.enabled),
  ]
);

// =============================================================================
// AUDIT LOG TABLE (Agent 8: Policy & Risk)
// =============================================================================

/**
 * Stores audit log entries for security and compliance tracking.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id"),

    // Action info
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),

    // Details
    details: jsonb("details").$type<Record<string, unknown>>(),

    // Context
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    // Timestamp
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_idx").on(table.organizationId),
    index("audit_log_user_idx").on(table.userId),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_log_created_idx").on(table.createdAt),
  ]
);

// =============================================================================
// RISK RELATIONS
// =============================================================================

export const riskAnalysisRelations = relations(riskAnalysis, ({ one }) => ({
  account: one(emailAccount, {
    fields: [riskAnalysis.accountId],
    references: [emailAccount.id],
  }),
  thread: one(emailThread, {
    fields: [riskAnalysis.threadId],
    references: [emailThread.id],
  }),
  message: one(emailMessage, {
    fields: [riskAnalysis.messageId],
    references: [emailMessage.id],
  }),
}));

export const policyRuleRelations = relations(policyRule, ({ one }) => ({
  organization: one(organization, {
    fields: [policyRule.organizationId],
    references: [organization.id],
  }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organization: one(organization, {
    fields: [auditLog.organizationId],
    references: [organization.id],
  }),
}));

// =============================================================================
// RISK TYPE EXPORTS
// =============================================================================

export type RiskAnalysis = typeof riskAnalysis.$inferSelect;
export type NewRiskAnalysis = typeof riskAnalysis.$inferInsert;
export type PolicyRule = typeof policyRule.$inferSelect;
export type NewPolicyRule = typeof policyRule.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
