// =============================================================================
// RELATIONSHIP ANALYZERS INDEX
// =============================================================================

// Communication analytics
export {
  type CommunicationMetrics,
  calculateCommunicationMetrics,
  calculateDirection,
  calculateFrequency,
  calculateResponsiveness,
  calculateTopicAssociation,
} from "./communication";
// Identity resolution
export {
  areEmailsRelated,
  calculateNameSimilarity,
  extractDomain,
  findMergeCandidates,
  isFreeEmailProvider,
  normalizeEmail,
  parseEmail,
  parseName,
  resolveIdentity,
} from "./identity";

// Relationship scoring
export {
  calculateEngagementScore,
  calculateHealthScore,
  calculateImportanceScore,
  detectVIP,
  flagRisk,
  isExecutiveTitle,
  isHighValueDomain,
} from "./scoring";
