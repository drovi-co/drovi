import { z } from "zod";

// =============================================================================
// DEDUPLICATION TYPES
// =============================================================================

/**
 * Action to take after deduplication check
 */
export type DeduplicationAction =
  | "create_new"
  | "merge_into"
  | "pending_review";

/**
 * Detection method used to find duplicates
 */
export type DetectionMethod =
  | "semantic_similarity"
  | "party_match"
  | "explicit_reference"
  | "temporal_proximity"
  | "manual";

/**
 * Context for deduplication check
 */
export interface DeduplicationContext {
  organizationId: string;
  newCommitment: ExtractedCommitmentForDedup;
  sourceType: string;
  sourceConversationId: string;
  sourceMessageId?: string;
  sourceAccountId?: string;
}

/**
 * Extracted commitment data for deduplication
 */
export interface ExtractedCommitmentForDedup {
  id?: string;
  title: string;
  description?: string;
  dueDate?: Date | null;
  dueDateConfidence?: number;
  debtorContactId?: string;
  debtorEmail?: string;
  debtorName?: string;
  creditorContactId?: string;
  creditorEmail?: string;
  creditorName?: string;
  confidence: number;
  sourceQuote?: string;
}

/**
 * Result of deduplication check
 */
export interface DeduplicationResult {
  action: DeduplicationAction;
  targetUioId?: string;
  confidence: number;
  matchReasons: string[];
  explanation: string;
  scores?: {
    semanticSimilarity?: number;
    partyMatchScore?: number;
    temporalScore?: number;
    overallScore: number;
  };
}

/**
 * Candidate UIO for potential match
 */
export interface MatchCandidate {
  uioId: string;
  canonicalTitle: string;
  canonicalDescription?: string | null;
  dueDate?: Date | null;
  ownerContactId?: string | null;
  participantContactIds: string[];
  firstSeenAt: Date;
  lastUpdatedAt: Date;
  semanticSimilarity: number;
  partyMatchScore?: number;
  temporalScore?: number;
  overallScore?: number;
}

/**
 * Similar UIO from vector search
 */
export interface SimilarUIO {
  id: string;
  canonicalTitle: string;
  canonicalDescription: string | null;
  dueDate: Date | null;
  ownerContactId: string | null;
  participantContactIds: string[];
  firstSeenAt: Date;
  lastUpdatedAt: Date;
  similarity: number;
}

/**
 * Resolved party information
 */
export interface ResolvedParties {
  debtorContactId?: string;
  creditorContactId?: string;
  participantContactIds: string[];
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const DeduplicationActionSchema = z.enum([
  "create_new",
  "merge_into",
  "pending_review",
]);

export const DeduplicationResultSchema = z.object({
  action: DeduplicationActionSchema,
  targetUioId: z.string().optional(),
  confidence: z.number().min(0).max(1),
  matchReasons: z.array(z.string()),
  explanation: z.string(),
  scores: z
    .object({
      semanticSimilarity: z.number().optional(),
      partyMatchScore: z.number().optional(),
      temporalScore: z.number().optional(),
      overallScore: z.number(),
    })
    .optional(),
});

export const LLMMatchAnalysisSchema = z.object({
  isLikelyDuplicate: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  matchingElements: z.array(z.string()),
  differingElements: z.array(z.string()),
});

export type LLMMatchAnalysis = z.infer<typeof LLMMatchAnalysisSchema>;
