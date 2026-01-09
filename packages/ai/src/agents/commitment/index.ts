// =============================================================================
// COMMITMENT AGENT MODULE (Agent 2)
// =============================================================================
//
// Extracts and tracks commitments from email threads.
//
// Usage:
//
//   import { extractCommitments, createCommitmentAgent } from "@saas-template/ai/agents";
//
//   // Simple usage
//   const commitments = await extractCommitments(context, promiseClaims, requestClaims);
//
//   // With agent instance
//   const agent = createCommitmentAgent();
//   const commitments = await agent.extractCommitments(context, promiseClaims, requestClaims);
//   const overdue = agent.findOverdueCommitments(existingCommitments);
//   const followUp = await agent.generateFollowUp(commitment, daysOverdue, reminderCount);
//

// Main agent
export {
  CommitmentAgent,
  createCommitmentAgent,
  extractCommitments,
} from "./agent";
// Utilities
export { extractDueDate, mergeDateExtractions } from "./extractors/dates";
export {
  identifyParties,
  mergePartyIdentifications,
  type PartiesResult,
} from "./extractors/parties";
// Types
export type {
  CommitmentDirection,
  CommitmentPriority,
  CommitmentStatus,
  CommitmentThreadContext,
  DailyDigest,
  DueDateExtraction,
  DueDateSource,
  ExtractedCommitment,
  FollowUpDraft,
  OverdueCommitment,
  PartyIdentification,
  PromiseClaimInput,
  RequestClaimInput,
  StatusChange,
} from "./types";
// Schemas for validation
export {
  CommitmentDirection as CommitmentDirectionSchema,
  CommitmentExtractionResponseSchema,
  CommitmentPriority as CommitmentPrioritySchema,
  CommitmentStatus as CommitmentStatusSchema,
  DueDateExtractionSchema,
  DueDateSource as DueDateSourceSchema,
  ExtractedCommitmentSchema,
  FollowUpDraftSchema,
  FollowUpGenerationResponseSchema,
  PartyIdentificationSchema,
  StatusChangeSchema,
  StatusDetectionResponseSchema,
} from "./types";
