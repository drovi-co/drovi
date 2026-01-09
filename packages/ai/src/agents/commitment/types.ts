// =============================================================================
// COMMITMENT AGENT TYPES
// =============================================================================
//
// Type definitions and Zod schemas for commitment extraction and tracking.
//

import { z } from "zod";

// =============================================================================
// ENUMS
// =============================================================================

export const CommitmentDirection = z.enum(["owed_by_me", "owed_to_me"]);
export type CommitmentDirection = z.infer<typeof CommitmentDirection>;

export const CommitmentStatus = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "overdue",
  "waiting",
  "snoozed",
]);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const CommitmentPriority = z.enum(["low", "medium", "high", "urgent"]);
export type CommitmentPriority = z.infer<typeof CommitmentPriority>;

export const DueDateSource = z.enum(["explicit", "inferred", "user_set"]);
export type DueDateSource = z.infer<typeof DueDateSource>;

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Promise claim from thread understanding agent.
 */
export interface PromiseClaimInput {
  id: string;
  text: string;
  promisor?: string;
  promisee?: string;
  deadline?: string;
  deadlineConfidence?: number;
  isConditional?: boolean;
  condition?: string;
  confidence: number;
  evidence: Array<{
    messageId: string;
    quotedText: string;
  }>;
}

/**
 * Request claim from thread understanding agent.
 */
export interface RequestClaimInput {
  id: string;
  text: string;
  requester?: string;
  requestee?: string;
  deadline?: string;
  priority?: string;
  isExplicit?: boolean;
  confidence: number;
  evidence: Array<{
    messageId: string;
    quotedText: string;
  }>;
}

/**
 * Thread context for commitment extraction.
 */
export interface CommitmentThreadContext {
  threadId: string;
  accountId: string;
  organizationId: string;
  userEmail: string;
  subject?: string;
  messages: Array<{
    id: string;
    fromEmail: string;
    fromName?: string;
    sentAt?: Date;
    bodyText?: string;
    isFromUser: boolean;
  }>;
}

// =============================================================================
// OUTPUT TYPES
// =============================================================================

/**
 * Extracted due date with confidence.
 */
export const DueDateExtractionSchema = z.object({
  date: z.string().optional(), // ISO date string
  confidence: z.number().min(0).max(1),
  source: DueDateSource,
  originalText: z.string().optional(),
  isRelative: z.boolean().default(false),
  relativeBase: z.string().optional(), // What the relative date is based on
});
export type DueDateExtraction = z.infer<typeof DueDateExtractionSchema>;

/**
 * Identified party in a commitment.
 */
export const PartyIdentificationSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  isUser: z.boolean(),
  confidence: z.number().min(0).max(1),
  role: z.enum(["debtor", "creditor"]),
});
export type PartyIdentification = z.infer<typeof PartyIdentificationSchema>;

/**
 * Extracted commitment from a promise or request.
 */
export const ExtractedCommitmentSchema = z.object({
  // Core content
  title: z.string(),
  description: z.string().optional(),

  // Parties
  debtor: PartyIdentificationSchema.optional(),
  creditor: PartyIdentificationSchema.optional(),
  direction: CommitmentDirection,

  // Due date
  dueDate: DueDateExtractionSchema.optional(),

  // Priority and status
  priority: CommitmentPriority,
  status: CommitmentStatus.default("pending"),

  // Source evidence
  sourceClaimId: z.string(),
  sourceThreadId: z.string(),
  sourceMessageId: z.string().optional(),

  // Confidence
  confidence: z.number().min(0).max(1),

  // Metadata
  isConditional: z.boolean().default(false),
  condition: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type ExtractedCommitment = z.infer<typeof ExtractedCommitmentSchema>;

/**
 * Status change detection result.
 */
export const StatusChangeSchema = z.object({
  newStatus: CommitmentStatus,
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string(), // ISO date
  sourceMessageId: z.string().optional(),
  evidenceQuote: z.string().optional(),
});
export type StatusChange = z.infer<typeof StatusChangeSchema>;

/**
 * Overdue commitment with context.
 */
export interface OverdueCommitment {
  id: string;
  title: string;
  dueDate: Date;
  daysOverdue: number;
  direction: CommitmentDirection;
  debtorEmail?: string;
  creditorEmail?: string;
  sourceThreadId?: string;
  lastReminderAt?: Date;
  reminderCount: number;
}

/**
 * Follow-up draft for an overdue commitment.
 */
export const FollowUpDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  tone: z.enum(["friendly", "professional", "urgent"]),
  includesContext: z.boolean(),
  commitmentId: z.string(),
});
export type FollowUpDraft = z.infer<typeof FollowUpDraftSchema>;

/**
 * Daily digest content.
 */
export interface DailyDigest {
  userId: string;
  organizationId: string;
  generatedAt: Date;
  owedByMe: {
    overdue: OverdueCommitment[];
    dueToday: OverdueCommitment[];
    upcoming: OverdueCommitment[];
  };
  owedToMe: {
    overdue: OverdueCommitment[];
    dueToday: OverdueCommitment[];
    upcoming: OverdueCommitment[];
  };
  totalOpen: number;
}

// =============================================================================
// LLM RESPONSE SCHEMAS
// =============================================================================

/**
 * LLM response for commitment extraction.
 */
export const CommitmentExtractionResponseSchema = z.object({
  commitments: z.array(
    z.object({
      title: z.string().describe("Short, actionable title for the commitment"),
      description: z
        .string()
        .optional()
        .describe("Detailed description if needed"),
      debtorEmail: z
        .string()
        .optional()
        .describe("Email of person who owes the commitment"),
      debtorName: z.string().optional().describe("Name of debtor if known"),
      creditorEmail: z
        .string()
        .optional()
        .describe("Email of person owed the commitment"),
      creditorName: z.string().optional().describe("Name of creditor if known"),
      dueDateText: z
        .string()
        .optional()
        .describe("Original text mentioning due date"),
      dueDate: z
        .string()
        .optional()
        .describe("Parsed due date in ISO format if determinable"),
      dueDateConfidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Confidence in the due date"),
      priority: CommitmentPriority.describe("Inferred priority level"),
      isConditional: z
        .boolean()
        .default(false)
        .describe("Whether commitment has conditions"),
      condition: z.string().optional().describe("The condition if applicable"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Overall confidence in this extraction"),
      reasoning: z.string().describe("Why this was identified as a commitment"),
    })
  ),
});
export type CommitmentExtractionResponse = z.infer<
  typeof CommitmentExtractionResponseSchema
>;

/**
 * LLM response for status detection.
 */
export const StatusDetectionResponseSchema = z.object({
  statusChanges: z.array(
    z.object({
      commitmentTitle: z
        .string()
        .describe("Title of commitment this applies to"),
      newStatus: CommitmentStatus.describe("New status detected"),
      reason: z.string().describe("Why status changed"),
      confidence: z.number().min(0).max(1).describe("Confidence in detection"),
      evidenceQuote: z
        .string()
        .optional()
        .describe("Quote from message supporting this"),
    })
  ),
});
export type StatusDetectionResponse = z.infer<
  typeof StatusDetectionResponseSchema
>;

/**
 * LLM response for follow-up generation.
 */
export const FollowUpGenerationResponseSchema = z.object({
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Email body text"),
  tone: z
    .enum(["friendly", "professional", "urgent"])
    .describe("Tone of the follow-up"),
});
export type FollowUpGenerationResponse = z.infer<
  typeof FollowUpGenerationResponseSchema
>;
