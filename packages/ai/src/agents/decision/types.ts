// =============================================================================
// DECISION AGENT TYPES
// =============================================================================
//
// Type definitions and Zod schemas for decision extraction and tracking.
//

import { z } from "zod";

// =============================================================================
// INPUT TYPES
// =============================================================================

/**
 * Decision claim from thread understanding agent.
 */
export interface DecisionClaimInput {
  id: string;
  text: string;
  decision?: string;
  decisionMaker?: string;
  rationale?: string;
  alternatives?: string[];
  confidence: number;
  evidence: Array<{
    messageId: string;
    quotedText: string;
  }>;
}

/**
 * Thread context for decision extraction.
 */
export interface DecisionThreadContext {
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
 * Alternative considered for a decision.
 * Note: Using .nullable() instead of .optional() for OpenAI structured outputs compatibility.
 */
export const AlternativeSchema = z.object({
  title: z.string().describe("Short title for the alternative"),
  description: z.string().nullable().describe("Detailed description"),
  pros: z.array(z.string()).nullable().describe("Advantages of this option"),
  cons: z.array(z.string()).nullable().describe("Disadvantages of this option"),
  rejected: z.boolean().describe("Whether this was rejected"),
  rejectionReason: z.string().nullable().describe("Why it was rejected"),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

/**
 * Owner/participant in a decision.
 * Note: Using .nullable() instead of .optional() for OpenAI structured outputs compatibility.
 */
export const DecisionParticipantSchema = z.object({
  email: z.string().nullable(),
  name: z.string().nullable(),
  isUser: z.boolean(),
  role: z.enum(["decision_maker", "approver", "participant", "stakeholder"]),
  confidence: z.number().min(0).max(1),
});
export type DecisionParticipant = z.infer<typeof DecisionParticipantSchema>;

/**
 * Extracted decision from a claim.
 * Note: Using .nullable() instead of .optional() for OpenAI structured outputs compatibility.
 */
export const ExtractedDecisionSchema = z.object({
  // Core content
  title: z.string().describe("Short, descriptive title"),
  statement: z.string().describe("The actual decision statement"),
  rationale: z.string().nullable().describe("Why the decision was made"),

  // Context
  topic: z.string().nullable().describe("Topic/area of the decision"),
  impactAreas: z
    .array(z.string())
    .nullable()
    .describe("Areas impacted by decision"),

  // Alternatives
  alternatives: z.array(AlternativeSchema).nullable(),

  // People
  owners: z
    .array(DecisionParticipantSchema)
    .nullable()
    .describe("Decision makers"),
  participants: z
    .array(DecisionParticipantSchema)
    .nullable()
    .describe("Other participants"),

  // Timing
  decidedAt: z.string().describe("When the decision was made (ISO date)"),

  // Source evidence
  sourceClaimId: z.string(),
  sourceThreadId: z.string(),
  sourceMessageIds: z.array(z.string()),

  // Confidence
  confidence: z.number().min(0).max(1),

  // Decision characteristics
  isExplicit: z
    .boolean()
    .describe("Explicitly stated vs inferred"),
  isTentative: z.boolean().describe("Subject to change"),
  requiresApproval: z.boolean().describe("Needs approval"),

  // Metadata
  metadata: z.record(z.unknown()).nullable(),
});
export type ExtractedDecision = z.infer<typeof ExtractedDecisionSchema>;

/**
 * Supersession detection result.
 */
export const SupersessionSchema = z.object({
  supersededDecisionId: z.string().describe("ID of the old decision"),
  supersedingDecisionId: z.string().describe("ID of the new decision"),
  reason: z.string().describe("Why the decision changed"),
  confidence: z.number().min(0).max(1),
  isReversal: z.boolean().describe("Complete reversal vs evolution"),
  detectedAt: z.string(),
});
export type Supersession = z.infer<typeof SupersessionSchema>;

/**
 * Decision search result with relevance.
 */
export interface DecisionSearchResult {
  id: string;
  title: string;
  statement: string;
  rationale?: string;
  decidedAt: Date;
  relevanceScore: number;
  matchedTerms: string[];
  sourceThreadId?: string;
}

// =============================================================================
// LLM RESPONSE SCHEMAS
// =============================================================================

/**
 * LLM response for decision extraction.
 * Note: Using .nullable() instead of .optional() for OpenAI structured outputs compatibility.
 */
export const DecisionExtractionResponseSchema = z.object({
  decisions: z.array(
    z.object({
      title: z.string().describe("Short, descriptive title for the decision"),
      statement: z.string().describe("The decision itself - what was decided"),
      rationale: z
        .string()
        .nullable()
        .describe("Why this decision was made - reasoning"),
      topic: z
        .string()
        .nullable()
        .describe("Topic area (e.g., 'pricing', 'architecture')"),
      impactAreas: z
        .array(z.string())
        .nullable()
        .describe("Areas affected by this decision"),
      alternatives: z
        .array(
          z.object({
            title: z.string(),
            description: z.string().nullable(),
            pros: z.array(z.string()).nullable(),
            cons: z.array(z.string()).nullable(),
            rejectionReason: z.string().nullable(),
          })
        )
        .nullable()
        .describe("Other options that were considered"),
      decisionMakerEmail: z
        .string()
        .nullable()
        .describe("Email of primary decision maker"),
      decisionMakerName: z
        .string()
        .nullable()
        .describe("Name of primary decision maker"),
      participantEmails: z
        .array(z.string())
        .nullable()
        .describe("Emails of other participants"),
      decidedAt: z.string().describe("When decided (ISO date from message)"),
      isExplicit: z
        .boolean()
        .describe("Whether explicitly stated"),
      isTentative: z
        .boolean()
        .describe("Whether provisional/subject to change"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .describe("Confidence in this extraction"),
      reasoning: z.string().describe("Why this was identified as a decision"),
    })
  ),
});
export type DecisionExtractionResponse = z.infer<
  typeof DecisionExtractionResponseSchema
>;

/**
 * LLM response for rationale extraction.
 */
export const RationaleExtractionResponseSchema = z.object({
  rationale: z.string().describe("The reasoning behind the decision"),
  supportingEvidence: z
    .array(z.string())
    .describe("Quotes supporting the rationale"),
  confidence: z.number().min(0).max(1),
  isExplicit: z.boolean().describe("Whether rationale was explicitly stated"),
});
export type RationaleExtractionResponse = z.infer<
  typeof RationaleExtractionResponseSchema
>;

/**
 * LLM response for supersession detection.
 */
export const SupersessionDetectionResponseSchema = z.object({
  supersessions: z.array(
    z.object({
      oldDecisionTitle: z.string().describe("Title of the superseded decision"),
      newDecisionTitle: z.string().describe("Title of the new decision"),
      reason: z.string().describe("Why the decision changed"),
      isReversal: z
        .boolean()
        .describe("Complete reversal vs refinement/evolution"),
      confidence: z.number().min(0).max(1),
    })
  ),
});
export type SupersessionDetectionResponse = z.infer<
  typeof SupersessionDetectionResponseSchema
>;

/**
 * LLM response for decision querying.
 * Note: Using .nullable() instead of .optional() for OpenAI structured outputs compatibility.
 */
export const DecisionQueryResponseSchema = z.object({
  relevantDecisions: z.array(
    z.object({
      title: z.string(),
      relevance: z.number().min(0).max(1).describe("How relevant to the query"),
      summary: z.string().describe("Brief summary of the decision"),
      keyPoints: z.array(z.string()).describe("Key points relevant to query"),
    })
  ),
  answer: z
    .string()
    .nullable()
    .describe("Direct answer to query if applicable"),
});
export type DecisionQueryResponse = z.infer<typeof DecisionQueryResponseSchema>;
