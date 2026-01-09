// =============================================================================
// RELATIONSHIP INTELLIGENCE AGENT TYPES
// =============================================================================
//
// Types and schemas for relationship analysis, contact profiling, and scoring.
//

import { z } from "zod";

// =============================================================================
// IDENTITY RESOLUTION
// =============================================================================

/**
 * Email alias detected for a contact.
 */
export interface EmailAlias {
  email: string;
  confidence: number;
  source:
    | "domain_match"
    | "name_similarity"
    | "explicit_alias"
    | "thread_context";
}

/**
 * Identity resolution result.
 */
export interface IdentityResolutionResult {
  primaryEmail: string;
  aliases: EmailAlias[];
  displayName?: string;
  firstName?: string;
  lastName?: string;
  confidence: number;
}

/**
 * Contact merge candidate.
 */
export interface MergeCandidate {
  contactId: string;
  email: string;
  displayName?: string;
  similarity: number;
  matchType: "email_domain" | "name_exact" | "name_similar" | "signature_match";
}

// =============================================================================
// PROFILE ENRICHMENT
// =============================================================================

/**
 * Information extracted from email signatures.
 */
export interface SignatureExtraction {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
  linkedinUrl?: string;
  website?: string;
  address?: string;
  confidence: number;
}

/**
 * Enriched contact profile.
 */
export interface EnrichedProfile {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  department?: string;
  phone?: string;
  linkedinUrl?: string;
  avatarUrl?: string;
  timezone?: string;
  enrichmentSource: string;
  confidence: number;
}

/**
 * LLM response schema for signature extraction.
 */
export const SignatureExtractionResponseSchema = z.object({
  extractions: z.array(
    z.object({
      name: z.string().optional(),
      title: z.string().optional(),
      company: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      linkedinUrl: z.string().optional(),
      website: z.string().optional(),
      address: z.string().optional(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

// =============================================================================
// COMMUNICATION ANALYTICS
// =============================================================================

/**
 * Time period for analytics.
 */
export type TimePeriod = "7d" | "30d" | "90d" | "365d" | "all";

/**
 * Communication frequency metrics.
 */
export interface FrequencyMetrics {
  period: TimePeriod;
  threadCount: number;
  messageCount: number;
  threadsPerMonth: number;
  messagesPerMonth: number;
  trend: "increasing" | "stable" | "decreasing";
  trendPercentage: number;
}

/**
 * Responsiveness metrics.
 */
export interface ResponsivenessMetrics {
  avgResponseTimeMinutes: number;
  medianResponseTimeMinutes: number;
  responseRate: number; // 0-1
  fastestResponseMinutes: number;
  slowestResponseMinutes: number;
  businessHoursOnly: boolean;
}

/**
 * Communication direction metrics.
 */
export interface DirectionMetrics {
  initiatedByUser: number;
  initiatedByContact: number;
  initiationRatio: number; // > 1 means user initiates more
  trend: "user_initiating_more" | "balanced" | "contact_initiating_more";
}

/**
 * Topic association with a contact.
 */
export interface TopicAssociation {
  topicId: string;
  topicName: string;
  threadCount: number;
  lastDiscussedAt: Date;
  sentimentScore?: number;
}

// =============================================================================
// RELATIONSHIP SCORING
// =============================================================================

/**
 * Importance score breakdown.
 */
export interface ImportanceScore {
  overall: number; // 0-1
  components: {
    frequency: number; // 0-1
    responsiveness: number; // 0-1
    threadVolume: number; // 0-1
    senioritySignal: number; // 0-1
    dealInvolvement: number; // 0-1
  };
  factors: string[];
}

/**
 * Relationship health score breakdown.
 */
export interface HealthScore {
  overall: number; // 0-1
  trend: "improving" | "stable" | "declining";
  components: {
    frequencyRatio: number; // recent/baseline
    sentimentTrend: number; // -1 to 1
    responseRateTrend: number; // -1 to 1
  };
  warnings: string[];
}

/**
 * VIP detection result.
 */
export interface VIPDetection {
  isVip: boolean;
  confidence: number;
  reasons: string[];
  signals: Array<{
    type: "frequency" | "seniority" | "deal" | "explicit" | "user_override";
    strength: number;
    description: string;
  }>;
}

/**
 * Risk flagging result.
 */
export interface RiskFlagging {
  isAtRisk: boolean;
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
  metrics: {
    daysSinceLastContact: number;
    frequencyDropPercent: number;
    sentimentChange: number;
  };
  suggestedAction?: string;
}

// =============================================================================
// CONTEXT GENERATION
// =============================================================================

/**
 * Open loop with a contact.
 */
export interface ContactOpenLoop {
  id: string;
  type: "commitment" | "question" | "request";
  title: string;
  direction: "owed_by_contact" | "owed_to_contact";
  dueDate?: Date;
  daysOverdue?: number;
  threadId: string;
  threadSubject?: string;
}

/**
 * Recent interaction summary.
 */
export interface RecentInteraction {
  threadId: string;
  subject: string;
  date: Date;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  topics: string[];
  hasOpenLoop: boolean;
}

/**
 * Meeting brief for a contact.
 */
export interface MeetingBrief {
  contactId: string;
  generatedAt: Date;
  profile: {
    name: string;
    title?: string;
    company?: string;
    email: string;
    avatarUrl?: string;
  };
  relationshipSummary: {
    firstContact: Date;
    totalThreads: number;
    totalMessages: number;
    lastInteraction: Date;
    healthScore: number;
    isVip: boolean;
  };
  recentHistory: RecentInteraction[];
  openLoops: ContactOpenLoop[];
  talkingPoints: string[];
  suggestedTopics: string[];
}

/**
 * LLM response schema for meeting brief generation.
 */
export const MeetingBriefResponseSchema = z.object({
  talkingPoints: z.array(z.string()),
  suggestedTopics: z.array(z.string()),
  relationshipInsights: z.array(z.string()),
  potentialConcerns: z.array(z.string()),
});

/**
 * Response time prediction.
 */
export interface ResponseTimePrediction {
  predictedMinutes: number;
  confidence: number;
  range: {
    min: number;
    max: number;
  };
  factors: Array<{
    factor: string;
    impact: "faster" | "slower";
    description: string;
  }>;
}

// =============================================================================
// AGENT CONTEXT
// =============================================================================

/**
 * Contact context for relationship analysis.
 */
export interface ContactContext {
  contactId: string;
  organizationId: string;
  primaryEmail: string;
  displayName?: string;
  userEmail: string;
}

/**
 * Thread context for communication analysis.
 */
export interface ThreadContext {
  threadId: string;
  subject?: string;
  participants: string[];
  messageCount: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
  messages: Array<{
    id: string;
    fromEmail: string;
    sentAt?: Date;
    bodyText?: string;
    isFromUser: boolean;
  }>;
}

// =============================================================================
// LLM SCHEMAS
// =============================================================================

/**
 * LLM response for profile enrichment.
 */
export const ProfileEnrichmentResponseSchema = z.object({
  displayName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

/**
 * LLM response for recent history summarization.
 */
export const RecentHistorySummaryResponseSchema = z.object({
  interactions: z.array(
    z.object({
      threadId: z.string(),
      summary: z.string(),
      sentiment: z.enum(["positive", "neutral", "negative"]),
      topics: z.array(z.string()),
      hasOpenLoop: z.boolean(),
    })
  ),
});

/**
 * LLM response for VIP signal detection.
 */
export const VIPSignalResponseSchema = z.object({
  isLikelyVip: z.boolean(),
  confidence: z.number().min(0).max(1),
  signals: z.array(
    z.object({
      type: z.enum(["frequency", "seniority", "deal", "explicit"]),
      strength: z.number().min(0).max(1),
      description: z.string(),
    })
  ),
  reasoning: z.string(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type SignatureExtractionResponse = z.infer<
  typeof SignatureExtractionResponseSchema
>;
export type ProfileEnrichmentResponse = z.infer<
  typeof ProfileEnrichmentResponseSchema
>;
export type RecentHistorySummaryResponse = z.infer<
  typeof RecentHistorySummaryResponseSchema
>;
export type VIPSignalResponse = z.infer<typeof VIPSignalResponseSchema>;
export type MeetingBriefResponse = z.infer<typeof MeetingBriefResponseSchema>;
