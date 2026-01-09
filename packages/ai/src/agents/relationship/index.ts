// =============================================================================
// RELATIONSHIP INTELLIGENCE AGENT (Agent 4)
// =============================================================================
//
// Exports for the Relationship Intelligence agent module.
//

// Agent
export {
  analyzeRelationship,
  createRelationshipAgent,
  generateMeetingBrief,
  RelationshipAgent,
} from "./agent";
// Analyzers
export {
  areEmailsRelated,
  type CommunicationMetrics,
  calculateCommunicationMetrics,
  calculateDirection,
  calculateEngagementScore,
  // Communication
  calculateFrequency,
  calculateHealthScore,
  // Scoring
  calculateImportanceScore,
  calculateNameSimilarity,
  calculateResponsiveness,
  calculateTopicAssociation,
  detectVIP,
  extractDomain,
  findMergeCandidates,
  flagRisk,
  isExecutiveTitle,
  isFreeEmailProvider,
  isHighValueDomain,
  normalizeEmail,
  // Identity
  parseEmail,
  parseName,
  resolveIdentity,
} from "./analyzers";
// Prompts
export {
  buildCompanyDetectionPrompt,
  buildMeetingBriefPrompt,
  buildOpenLoopDetectionPrompt,
  buildProfileEnrichmentPrompt,
  buildRecentHistorySummaryPrompt,
  buildRelationshipSummaryPrompt,
  buildResponseTimePredictionPrompt,
  buildSignatureExtractionPrompt,
  buildTimezoneDetectionPrompt,
  buildVIPSignalPrompt,
} from "./prompts";
// Types
export type {
  // Agent context
  ContactContext,
  // Context generation
  ContactOpenLoop,
  DirectionMetrics,
  // Identity resolution
  EmailAlias,
  EnrichedProfile,
  FrequencyMetrics,
  HealthScore,
  IdentityResolutionResult,
  // Relationship scoring
  ImportanceScore,
  MeetingBrief,
  MergeCandidate,
  RecentInteraction,
  ResponseTimePrediction,
  ResponsivenessMetrics,
  RiskFlagging,
  // Profile enrichment
  SignatureExtraction,
  ThreadContext,
  // Communication analytics
  TimePeriod,
  TopicAssociation,
  VIPDetection,
} from "./types";
// Schemas
export {
  MeetingBriefResponseSchema,
  ProfileEnrichmentResponseSchema,
  RecentHistorySummaryResponseSchema,
  SignatureExtractionResponseSchema,
  VIPSignalResponseSchema,
} from "./types";
