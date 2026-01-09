// =============================================================================
// THREAD UNDERSTANDING AGENT MODULE
// =============================================================================
//
// Agent 1: Thread analysis, classification, and claim extraction.
//
// This module provides the foundation for all intelligence extraction in
// MEMORYSTACK. It analyzes email threads to extract:
//
// - Classification: intent, urgency, sentiment, thread type
// - Claims: facts, promises, requests, questions, decisions
// - Insights: briefs, timelines, open loops, waiting-on
//
// Usage:
//
//   import { analyzeThread, createThreadUnderstandingAgent } from "@saas-template/ai/agents";
//
//   // Simple usage
//   const analysis = await analyzeThread(threadInput);
//
//   // With options
//   const agent = createThreadUnderstandingAgent();
//   const analysis = await agent.analyze(threadInput, { minConfidence: 0.7 });
//
//   // Quick classification only
//   const classification = await agent.classifyOnly(threadInput);
//
//   // Brief only (for inbox list)
//   const brief = await agent.briefOnly(threadInput);
//

// Main agent
export {
  analyzeThread,
  createThreadUnderstandingAgent,
  ThreadUnderstandingAgent,
} from "./agent";
// Individual classifiers (for specific needs)
export {
  analyzeSentiment,
  calculateSentimentTrend,
  classifyIntent,
  classifyIntentBatch,
  detectThreadType,
  heuristicThreadType,
  quickSentimentCheck,
  quickUrgencyCheck,
  scoreUrgency,
} from "./classifiers/index";
export type { DbClaimFormat } from "./evidence";
// Evidence utilities
export {
  claimsToDbFormat,
  createClaimEvidence,
  enrichClaimEvidence,
  findSourceMessage,
  groupClaimsByMessage,
} from "./evidence";
// Individual extractors (for specific needs)
export {
  extractAllClaims,
  extractClaimsParallel,
  extractDecisions,
  extractFacts,
  extractPromises,
  extractQuestions,
  extractRequests,
} from "./extractors/index";
// Individual generators (for specific needs)
export {
  analyzeWaitingOn,
  countOpenLoops,
  detectOpenLoops,
  generateBrief,
  generateTimeline,
  heuristicTimeline,
} from "./generators/index";
// Types
export type {
  AnalysisOptions,
  BaseClaim,
  Claim,
  ClaimEvidence,
  // Claim types
  ClaimType,
  DecisionClaim,
  ExtractedClaims,
  FactClaim,
  // Classification types
  IntentCategory,
  IntentClassification,
  OpenLoop,
  PromiseClaim,
  QuestionClaim,
  RequestClaim,
  SentimentAnalysis,
  // Result type
  ThreadAnalysis,
  // Generation types
  ThreadBrief,
  // Input types
  ThreadInput,
  ThreadMessage,
  ThreadType,
  ThreadTypeResult,
  TimelineEvent,
  UrgencyScore,
  WaitingOn,
} from "./types";
// Schemas for validation
export {
  BaseClaimSchema,
  ClaimEvidenceSchema,
  ClaimSchema,
  ClaimType as ClaimTypeSchema,
  DecisionClaimSchema,
  FactClaimSchema,
  IntentCategory as IntentCategorySchema,
  IntentClassificationSchema,
  OpenLoopSchema,
  PromiseClaimSchema,
  QuestionClaimSchema,
  RequestClaimSchema,
  SentimentAnalysisSchema,
  ThreadBriefSchema,
  ThreadType as ThreadTypeSchema,
  ThreadTypeResultSchema,
  TimelineEventSchema,
  UrgencyScoreSchema,
  WaitingOnSchema,
} from "./types";
