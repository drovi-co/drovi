import { z } from "zod";

// =============================================================================
// UPDATE DETECTION TYPES
// =============================================================================

/**
 * Types of updates that can be detected
 */
export type UpdateType =
  | "status_change"
  | "due_date_change"
  | "due_date_confirmation"
  | "completion"
  | "cancellation"
  | "progress_update"
  | "blocker_mentioned"
  | "delegation"
  | "context_addition";

/**
 * Input message for update detection
 */
export interface MessageInput {
  id: string;
  content: string;
  senderEmail?: string;
  senderName?: string;
  senderContactId?: string;
  timestamp: Date;
  sourceType: string;
  conversationId?: string;
  threadSubject?: string;
}

/**
 * A tracked UIO that might be referenced
 */
export interface TrackedUIO {
  id: string;
  canonicalTitle: string;
  canonicalDescription?: string | null;
  type: "commitment" | "decision" | "topic";
  status: string;
  dueDate?: Date | null;
  ownerContactId?: string | null;
  participantContactIds: string[];
}

/**
 * Context for update detection
 */
export interface UpdateDetectionContext {
  organizationId: string;
  message: MessageInput;
  sourceAccountId?: string;
}

/**
 * A detected reference to a UIO in a message
 */
export interface DetectedReference {
  uioId: string;
  uioTitle: string;
  updateType: UpdateType;
  confidence: number;
  quotedText: string;
  extractedInfo: ExtractedUpdateInfo;
  reasoning: string;
}

/**
 * Information extracted about the update
 */
export interface ExtractedUpdateInfo {
  newStatus?: string;
  newDueDate?: string;
  dueDateConfidence?: number;
  progressPercentage?: number;
  blockerDescription?: string;
  delegatedTo?: string;
  additionalContext?: string;
}

/**
 * Result of update detection
 */
export interface UpdateDetectionResult {
  hasUpdates: boolean;
  references: DetectedReference[];
  unrelatedContent: boolean;
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const UpdateTypeSchema = z.enum([
  "status_change",
  "due_date_change",
  "due_date_confirmation",
  "completion",
  "cancellation",
  "progress_update",
  "blocker_mentioned",
  "delegation",
  "context_addition",
]);

export const ExtractedUpdateInfoSchema = z.object({
  newStatus: z.string().optional(),
  newDueDate: z.string().optional(),
  dueDateConfidence: z.number().min(0).max(1).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  blockerDescription: z.string().optional(),
  delegatedTo: z.string().optional(),
  additionalContext: z.string().optional(),
});

export const DetectedReferenceSchema = z.object({
  uioId: z.string(),
  updateType: UpdateTypeSchema,
  confidence: z.number().min(0).max(1),
  quotedText: z.string(),
  extractedInfo: ExtractedUpdateInfoSchema,
  reasoning: z.string(),
});

export const LLMUpdateDetectionResponseSchema = z.object({
  referencesFound: z.array(
    z.object({
      matchedUioId: z.string(),
      updateType: UpdateTypeSchema,
      confidence: z.number().min(0).max(1),
      relevantQuote: z.string(),
      extractedInfo: ExtractedUpdateInfoSchema,
      reasoning: z.string(),
    })
  ),
  isUnrelatedMessage: z.boolean(),
});

export type LLMUpdateDetectionResponse = z.infer<
  typeof LLMUpdateDetectionResponseSchema
>;
