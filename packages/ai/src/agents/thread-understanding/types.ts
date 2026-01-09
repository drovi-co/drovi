// =============================================================================
// THREAD UNDERSTANDING AGENT TYPES
// =============================================================================
//
// Type definitions for the Thread Understanding Agent (Agent 1).
// These types define the inputs, outputs, and intermediate structures.
//

import { z } from "zod";

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Email message for analysis.
 */
export interface ThreadMessage {
  id: string;
  providerMessageId: string;
  fromEmail: string;
  fromName?: string;
  toRecipients: Array<{ email: string; name?: string }>;
  ccRecipients?: Array<{ email: string; name?: string }>;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  sentAt?: Date;
  receivedAt?: Date;
  isFromUser: boolean;
  messageIndex: number;
}

/**
 * Thread input for analysis.
 */
export interface ThreadInput {
  id: string;
  accountId: string;
  organizationId: string;
  providerThreadId: string;
  subject?: string;
  participantEmails?: string[];
  userEmail: string; // The email of the account owner
  messages: ThreadMessage[];
}

// =============================================================================
// CLASSIFICATION TYPES
// =============================================================================

/**
 * Intent categories for threads.
 */
export const IntentCategory = z.enum([
  "approval_request",
  "negotiation",
  "scheduling",
  "information_sharing",
  "question",
  "task_assignment",
  "feedback",
  "complaint",
  "follow_up",
  "introduction",
  "thank_you",
  "other",
]);
export type IntentCategory = z.infer<typeof IntentCategory>;

/**
 * Thread structure types.
 */
export const ThreadType = z.enum([
  "single_message",
  "back_and_forth",
  "broadcast",
  "chain_reply",
  "forward_chain",
  "group_discussion",
]);
export type ThreadType = z.infer<typeof ThreadType>;

/**
 * Intent classification result.
 */
export const IntentClassificationSchema = z.object({
  intent: IntentCategory,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  secondaryIntents: z.array(IntentCategory).optional(),
});
export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

/**
 * Urgency scoring result.
 */
export const UrgencyScoreSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(["low", "medium", "high", "urgent"]),
  reasoning: z.string(),
  signals: z.array(
    z.object({
      type: z.enum([
        "explicit_deadline",
        "urgency_language",
        "sender_importance",
        "time_sensitive",
        "escalation",
      ]),
      text: z.string().optional(),
      weight: z.number().min(0).max(1),
    })
  ),
});
export type UrgencyScore = z.infer<typeof UrgencyScoreSchema>;

/**
 * Sentiment analysis result.
 */
export const SentimentAnalysisSchema = z.object({
  overall: z.number().min(-1).max(1),
  trend: z.enum(["improving", "stable", "declining", "volatile"]),
  messages: z.array(
    z.object({
      messageId: z.string(),
      sentiment: z.number().min(-1).max(1),
      dominant_emotion: z
        .enum([
          "neutral",
          "positive",
          "negative",
          "frustrated",
          "appreciative",
          "urgent",
          "confused",
        ])
        .optional(),
    })
  ),
  escalationDetected: z.boolean(),
  escalationReason: z.string().optional(),
});
export type SentimentAnalysis = z.infer<typeof SentimentAnalysisSchema>;

/**
 * Thread type detection result.
 */
export const ThreadTypeResultSchema = z.object({
  type: ThreadType,
  confidence: z.number().min(0).max(1),
  messageCount: z.number(),
  participantCount: z.number(),
  backAndForthCount: z.number().optional(),
  hasForward: z.boolean(),
});
export type ThreadTypeResult = z.infer<typeof ThreadTypeResultSchema>;

// =============================================================================
// CLAIM TYPES
// =============================================================================

/**
 * Claim types extracted from emails.
 */
export const ClaimType = z.enum([
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
export type ClaimType = z.infer<typeof ClaimType>;

/**
 * Evidence linking a claim to its source.
 */
export const ClaimEvidenceSchema = z.object({
  messageId: z.string(),
  quotedText: z.string(),
  startIndex: z.number().optional(),
  endIndex: z.number().optional(),
});
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

/**
 * Base claim structure.
 */
export const BaseClaimSchema = z.object({
  type: ClaimType,
  text: z.string(),
  normalizedText: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(ClaimEvidenceSchema),
});
export type BaseClaim = z.infer<typeof BaseClaimSchema>;

/**
 * Fact claim with entities.
 */
export const FactClaimSchema = BaseClaimSchema.extend({
  type: z.literal("fact"),
  entities: z
    .array(
      z.object({
        type: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  temporalReference: z.string().optional(),
});
export type FactClaim = z.infer<typeof FactClaimSchema>;

/**
 * Promise claim with deadline.
 */
export const PromiseClaimSchema = BaseClaimSchema.extend({
  type: z.literal("promise"),
  promisor: z.string(), // Email of person making promise
  promisee: z.string().optional(), // Email of recipient
  deadline: z.string().optional(),
  deadlineConfidence: z.number().min(0).max(1).optional(),
  isConditional: z.boolean(),
  condition: z.string().optional(),
});
export type PromiseClaim = z.infer<typeof PromiseClaimSchema>;

/**
 * Request claim.
 */
export const RequestClaimSchema = BaseClaimSchema.extend({
  type: z.literal("request"),
  requester: z.string(), // Email of person making request
  requestee: z.string().optional(), // Email of recipient
  isExplicit: z.boolean(), // "Can you..." vs implied
  deadline: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});
export type RequestClaim = z.infer<typeof RequestClaimSchema>;

/**
 * Question claim with answer status.
 */
export const QuestionClaimSchema = BaseClaimSchema.extend({
  type: z.literal("question"),
  asker: z.string(), // Email of person asking
  isRhetorical: z.boolean(),
  isAnswered: z.boolean(),
  answerMessageId: z.string().optional(),
  answerText: z.string().optional(),
});
export type QuestionClaim = z.infer<typeof QuestionClaimSchema>;

/**
 * Decision claim.
 */
export const DecisionClaimSchema = BaseClaimSchema.extend({
  type: z.literal("decision"),
  decisionMaker: z.string().optional(), // Email of decision maker
  decision: z.string(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
});
export type DecisionClaim = z.infer<typeof DecisionClaimSchema>;

/**
 * Union of all claim types.
 */
export const ClaimSchema = z.discriminatedUnion("type", [
  FactClaimSchema,
  PromiseClaimSchema,
  RequestClaimSchema,
  QuestionClaimSchema,
  DecisionClaimSchema,
  BaseClaimSchema.extend({ type: z.literal("opinion") }),
  BaseClaimSchema.extend({ type: z.literal("deadline") }),
  BaseClaimSchema.extend({ type: z.literal("price") }),
  BaseClaimSchema.extend({ type: z.literal("contact_info") }),
  BaseClaimSchema.extend({ type: z.literal("reference") }),
  BaseClaimSchema.extend({ type: z.literal("action_item") }),
]);
export type Claim = z.infer<typeof ClaimSchema>;

// =============================================================================
// EXTRACTION RESULT TYPES
// =============================================================================

/**
 * Claims extracted from a thread.
 */
export interface ExtractedClaims {
  facts: FactClaim[];
  promises: PromiseClaim[];
  requests: RequestClaim[];
  questions: QuestionClaim[];
  decisions: DecisionClaim[];
  other: BaseClaim[];
}

// =============================================================================
// GENERATION TYPES
// =============================================================================

/**
 * Thread brief (3-line summary).
 */
export const ThreadBriefSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  actionRequired: z.boolean(),
  actionDescription: z.string().optional(),
  participants: z.array(
    z.object({
      email: z.string(),
      name: z.string().optional(),
      role: z.enum(["initiator", "responder", "cc", "key_participant"]),
    })
  ),
});
export type ThreadBrief = z.infer<typeof ThreadBriefSchema>;

/**
 * Timeline event.
 */
export const TimelineEventSchema = z.object({
  timestamp: z.string(),
  messageId: z.string(),
  actor: z.string(),
  event: z.string(),
  type: z.enum([
    "message",
    "decision",
    "commitment",
    "question",
    "answer",
    "deadline",
    "escalation",
  ]),
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

/**
 * Open loop (unanswered question or pending item).
 */
export const OpenLoopSchema = z.object({
  type: z.enum([
    "unanswered_question",
    "pending_request",
    "unfulfilled_promise",
    "awaiting_response",
  ]),
  description: z.string(),
  owner: z.string().optional(), // Who owns resolving this
  sourceMessageId: z.string(),
  sourceQuotedText: z.string(),
  age: z.number().optional(), // Days since created
  priority: z.enum(["low", "medium", "high"]).optional(),
});
export type OpenLoop = z.infer<typeof OpenLoopSchema>;

/**
 * Waiting-on analysis.
 */
export const WaitingOnSchema = z.object({
  isWaitingOnOthers: z.boolean(),
  isOthersWaitingOnUser: z.boolean(),
  waitingOn: z.array(
    z.object({
      person: z.string(),
      description: z.string(),
      since: z.string().optional(),
    })
  ),
  waitingFor: z.array(
    z.object({
      person: z.string(),
      description: z.string(),
      since: z.string().optional(),
    })
  ),
});
export type WaitingOn = z.infer<typeof WaitingOnSchema>;

// =============================================================================
// COMPLETE ANALYSIS RESULT
// =============================================================================

/**
 * Complete thread analysis result.
 */
export interface ThreadAnalysis {
  threadId: string;
  accountId: string;
  organizationId: string;

  // Classification
  classification: {
    intent: IntentClassification;
    urgency: UrgencyScore;
    sentiment: SentimentAnalysis;
    threadType: ThreadTypeResult;
  };

  // Extracted claims
  claims: ExtractedClaims;

  // Generated insights
  brief: ThreadBrief;
  timeline: TimelineEvent[];
  openLoops: OpenLoop[];
  waitingOn: WaitingOn;

  // Metadata
  processedAt: Date;
  modelVersion: string;
  processingDuration: number;
}

// =============================================================================
// ANALYSIS OPTIONS
// =============================================================================

export interface AnalysisOptions {
  /** Skip classification phase */
  skipClassification?: boolean;
  /** Skip extraction phase */
  skipExtraction?: boolean;
  /** Skip generation phase */
  skipGeneration?: boolean;
  /** Force reanalysis even if recently analyzed */
  force?: boolean;
  /** Minimum confidence threshold for claims */
  minConfidence?: number;
}
