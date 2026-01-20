// =============================================================================
// DEDUPLICATION AGENT MODULE
// =============================================================================
//
// Detects cross-source duplicates of commitments and decisions.
//
// Usage:
//
//   import { createDeduplicationAgent, DeduplicationAgent } from "@memorystack/ai/agents";
//
//   const agent = createDeduplicationAgent(db);
//   const result = await agent.checkForDuplicates({
//     organizationId: "org_123",
//     newCommitment: { title: "Send deck by Friday", ... },
//     sourceType: "slack",
//     sourceConversationId: "conv_456",
//   });
//
//   if (result.action === "merge_into") {
//     // Merge into existing UIO
//   } else if (result.action === "pending_review") {
//     // Create deduplication candidate for review
//   } else {
//     // Create new UIO
//   }
//

// Main agent
export { createDeduplicationAgent, DeduplicationAgent } from "./agent";

// Types
export type {
  DeduplicationAction,
  DeduplicationContext,
  DeduplicationResult,
  DetectionMethod,
  ExtractedCommitmentForDedup,
  LLMMatchAnalysis,
  MatchCandidate,
  ResolvedParties,
  SimilarUIO,
} from "./types";

// Schemas
export {
  DeduplicationActionSchema,
  DeduplicationResultSchema,
  LLMMatchAnalysisSchema,
} from "./types";
