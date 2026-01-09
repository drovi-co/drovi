// =============================================================================
// DECISION AGENT MODULE (Agent 3)
// =============================================================================
//
// Extracts and tracks decisions from email threads.
//
// Usage:
//
//   import { extractDecisions, createDecisionAgent } from "@saas-template/ai/agents";
//
//   // Simple usage
//   const decisions = await extractDecisions(context, decisionClaims);
//
//   // With agent instance
//   const agent = createDecisionAgent();
//   const decisions = await agent.extractDecisions(context, decisionClaims);
//   const supersessions = await agent.detectSupersession(newDecision, existingDecisions);
//   const queryResult = await agent.queryDecisions("What did we decide about pricing?", decisions);
//

// Main agent
export {
  createDecisionAgent,
  DecisionAgent,
  extractDecisions,
} from "./agent";

// Types
export type {
  Alternative,
  DecisionClaimInput,
  DecisionParticipant,
  DecisionSearchResult,
  DecisionThreadContext,
  ExtractedDecision,
  Supersession,
} from "./types";

// Schemas for validation
export {
  AlternativeSchema,
  DecisionExtractionResponseSchema,
  DecisionParticipantSchema,
  DecisionQueryResponseSchema,
  ExtractedDecisionSchema,
  RationaleExtractionResponseSchema,
  SupersessionDetectionResponseSchema,
  SupersessionSchema,
} from "./types";
