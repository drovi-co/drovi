// =============================================================================
// RELATIONSHIP INTELLIGENCE AGENT (Agent 4)
// =============================================================================
//
// Analyzes communication patterns, builds contact profiles, and tracks
// relationship health. Generates meeting briefs and context for contacts.
//

import { generateObject } from "ai";
import { observability } from "../../observability";
import { getModel } from "../../providers/index";
import {
  type CommunicationMetrics,
  calculateCommunicationMetrics,
  extractDomain,
  findMergeCandidates,
  isExecutiveTitle,
  isHighValueDomain,
  normalizeEmail,
  resolveIdentity,
} from "./analyzers";
import {
  calculateEngagementScore,
  calculateHealthScore,
  calculateImportanceScore,
  detectVIP,
  flagRisk,
} from "./analyzers/scoring";
import {
  buildMeetingBriefPrompt,
  buildOpenLoopDetectionPrompt,
  buildProfileEnrichmentPrompt,
  buildRecentHistorySummaryPrompt,
  buildSignatureExtractionPrompt,
  buildVIPSignalPrompt,
} from "./prompts";
import type {
  ContactContext,
  ContactOpenLoop,
  EnrichedProfile,
  HealthScore,
  IdentityResolutionResult,
  ImportanceScore,
  MeetingBrief,
  MergeCandidate,
  RecentInteraction,
  ResponseTimePrediction,
  RiskFlagging,
  SignatureExtraction,
  ThreadContext,
  VIPDetection,
} from "./types";
import {
  MeetingBriefResponseSchema,
  ProfileEnrichmentResponseSchema,
  RecentHistorySummaryResponseSchema,
  SignatureExtractionResponseSchema,
  VIPSignalResponseSchema,
} from "./types";

// =============================================================================
// RELATIONSHIP AGENT
// =============================================================================

/**
 * Relationship Intelligence Agent
 *
 * Analyzes contacts, communication patterns, and relationship health.
 */
export class RelationshipAgent {
  // ===========================================================================
  // IDENTITY RESOLUTION
  // ===========================================================================

  /**
   * Resolve identity from multiple email addresses.
   */
  resolveIdentity(emails: string[], names: string[]): IdentityResolutionResult {
    return resolveIdentity(emails, names);
  }

  /**
   * Find potential merge candidates for a contact.
   */
  findMergeCandidates(
    targetEmail: string,
    targetName: string | undefined,
    existingContacts: Array<{
      id: string;
      primaryEmail: string;
      emails?: string[];
      displayName?: string;
    }>
  ): MergeCandidate[] {
    return findMergeCandidates(targetEmail, targetName, existingContacts);
  }

  /**
   * Normalize an email address.
   */
  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  /**
   * Extract domain from email.
   */
  extractDomain(email: string): string {
    return extractDomain(email);
  }

  // ===========================================================================
  // PROFILE ENRICHMENT
  // ===========================================================================

  /**
   * Extract contact information from email signatures.
   */
  async extractSignatures(
    emails: Array<{
      bodyText: string;
      fromEmail: string;
      fromName?: string;
    }>
  ): Promise<SignatureExtraction[]> {
    if (emails.length === 0) {
      return [];
    }

    const trace = observability.trace({
      name: "signature-extraction",
      metadata: { emailCount: emails.length },
    });

    try {
      const prompt = buildSignatureExtractionPrompt(emails);

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: SignatureExtractionResponseSchema,
        prompt,
        temperature: 0.2,
      });

      trace.generation({
        name: "extract-signatures",
        model: "claude-3-5-haiku",
        output: { count: result.object.extractions.length },
      });

      return result.object.extractions;
    } catch (error) {
      trace.generation({
        name: "extract-signatures-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return [];
    }
  }

  /**
   * Enrich a contact profile from email conversations.
   */
  async enrichProfile(
    contactEmail: string,
    existingProfile: {
      displayName?: string;
      title?: string;
      company?: string;
    },
    threads: ThreadContext[]
  ): Promise<EnrichedProfile | null> {
    if (threads.length === 0) {
      return null;
    }

    const trace = observability.trace({
      name: "profile-enrichment",
      metadata: {
        contactEmail,
        threadCount: threads.length,
      },
    });

    try {
      const prompt = buildProfileEnrichmentPrompt(
        contactEmail,
        existingProfile,
        threads
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: ProfileEnrichmentResponseSchema,
        prompt,
        temperature: 0.3,
      });

      trace.generation({
        name: "enrich-profile",
        model: "claude-3-5-haiku",
        output: { confidence: result.object.confidence },
      });

      return {
        displayName: result.object.displayName ?? undefined,
        firstName: result.object.firstName ?? undefined,
        lastName: result.object.lastName ?? undefined,
        title: result.object.title ?? undefined,
        company: result.object.company ?? undefined,
        department: result.object.department ?? undefined,
        phone: result.object.phone ?? undefined,
        linkedinUrl: result.object.linkedinUrl ?? undefined,
        enrichmentSource: "email_analysis",
        confidence: result.object.confidence,
      };
    } catch (error) {
      trace.generation({
        name: "enrich-profile-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return null;
    }
  }

  // ===========================================================================
  // COMMUNICATION ANALYTICS
  // ===========================================================================

  /**
   * Calculate communication metrics for a contact.
   */
  calculateCommunicationMetrics(
    threads: ThreadContext[],
    contactEmail: string,
    userEmail: string,
    threadTopics: Map<string, { topicId: string; topicName: string }[]>
  ): CommunicationMetrics {
    return calculateCommunicationMetrics(
      threads,
      contactEmail,
      userEmail,
      threadTopics
    );
  }

  // ===========================================================================
  // RELATIONSHIP SCORING
  // ===========================================================================

  /**
   * Calculate importance score for a contact.
   */
  calculateImportanceScore(
    metrics: CommunicationMetrics,
    contact: {
      title?: string;
      email: string;
    },
    dealInvolvement: {
      isInActiveDeals: boolean;
      dealValue?: number;
      dealCount: number;
    }
  ): ImportanceScore {
    return calculateImportanceScore(
      metrics,
      {
        hasExecutiveTitle: contact.title
          ? isExecutiveTitle(contact.title)
          : false,
        hasHighValueDomain: isHighValueDomain(contact.email),
        hasDecisionMakerIndicators: contact.title
          ? /decision|approve|sign|budget/i.test(contact.title)
          : false,
      },
      dealInvolvement
    );
  }

  /**
   * Calculate relationship health score.
   */
  calculateHealthScore(
    currentMetrics: CommunicationMetrics,
    baselineMetrics: CommunicationMetrics,
    sentimentData: {
      recentSentiment: number;
      baselineSentiment: number;
    }
  ): HealthScore {
    return calculateHealthScore(currentMetrics, baselineMetrics, sentimentData);
  }

  /**
   * Detect if a contact is VIP.
   */
  async detectVIP(
    importanceScore: ImportanceScore,
    contact: {
      title?: string;
      email: string;
      company?: string;
      userOverrideVip?: boolean;
    },
    threads: ThreadContext[]
  ): Promise<VIPDetection> {
    // First, use heuristic detection
    const heuristicResult = detectVIP(importanceScore, contact);

    // If already clearly VIP or not VIP, return early
    if (heuristicResult.confidence > 0.9) {
      return heuristicResult;
    }

    // Use LLM for additional signal detection
    const trace = observability.trace({
      name: "vip-detection",
      metadata: {
        contactEmail: contact.email,
        heuristicIsVip: heuristicResult.isVip,
      },
    });

    try {
      const prompt = buildVIPSignalPrompt(
        contact.email,
        contact.title,
        threads
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: VIPSignalResponseSchema,
        prompt,
        temperature: 0.2,
      });

      trace.generation({
        name: "detect-vip",
        model: "claude-3-5-haiku",
        output: {
          isVip: result.object.isLikelyVip,
          confidence: result.object.confidence,
        },
      });

      // Merge heuristic and LLM results
      const combinedSignals = [
        ...heuristicResult.signals,
        ...result.object.signals,
      ];

      const totalStrength = combinedSignals.reduce(
        (sum, s) => sum + s.strength,
        0
      );
      const avgStrength =
        combinedSignals.length > 0 ? totalStrength / combinedSignals.length : 0;

      const isVip =
        heuristicResult.isVip ||
        result.object.isLikelyVip ||
        avgStrength >= 0.7;

      const confidence = isVip
        ? Math.max(heuristicResult.confidence, result.object.confidence)
        : 1 - avgStrength;

      return {
        isVip,
        confidence: Math.round(confidence * 100) / 100,
        reasons: [
          ...heuristicResult.reasons,
          ...result.object.signals
            .filter((s) => s.strength >= 0.5)
            .map((s) => s.description),
        ],
        signals: combinedSignals,
      };
    } catch (error) {
      trace.generation({
        name: "detect-vip-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Fall back to heuristic result
      return heuristicResult;
    }
  }

  /**
   * Flag relationship risk.
   */
  flagRisk(
    healthScore: HealthScore,
    metrics: CommunicationMetrics,
    lastContactDaysAgo: number
  ): RiskFlagging {
    return flagRisk(healthScore, metrics, lastContactDaysAgo);
  }

  /**
   * Calculate engagement score.
   */
  calculateEngagementScore(metrics: CommunicationMetrics): number {
    return calculateEngagementScore(metrics);
  }

  // ===========================================================================
  // CONTEXT GENERATION
  // ===========================================================================

  /**
   * Summarize recent interaction history.
   */
  async summarizeRecentHistory(
    contactName: string,
    contactEmail: string,
    threads: ThreadContext[]
  ): Promise<RecentInteraction[]> {
    if (threads.length === 0) {
      return [];
    }

    const trace = observability.trace({
      name: "history-summary",
      metadata: {
        contactEmail,
        threadCount: threads.length,
      },
    });

    try {
      const prompt = buildRecentHistorySummaryPrompt(
        contactName,
        contactEmail,
        threads
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: RecentHistorySummaryResponseSchema,
        prompt,
        temperature: 0.3,
      });

      trace.generation({
        name: "summarize-history",
        model: "claude-3-5-haiku",
        output: { count: result.object.interactions.length },
      });

      // Map back to thread dates
      return result.object.interactions.map((i) => {
        const thread = threads.find((t) => t.threadId === i.threadId);
        return {
          threadId: i.threadId,
          subject: thread?.subject ?? "(unknown)",
          date: thread?.lastMessageAt ?? new Date(),
          summary: i.summary,
          sentiment: i.sentiment,
          topics: i.topics,
          hasOpenLoop: i.hasOpenLoop,
        };
      });
    } catch (error) {
      trace.generation({
        name: "summarize-history-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return [];
    }
  }

  /**
   * Detect open loops with a contact.
   */
  async detectOpenLoops(
    contactName: string,
    threads: ThreadContext[]
  ): Promise<ContactOpenLoop[]> {
    if (threads.length === 0) {
      return [];
    }

    const trace = observability.trace({
      name: "open-loop-detection",
      metadata: { threadCount: threads.length },
    });

    try {
      const prompt = buildOpenLoopDetectionPrompt(contactName, threads);

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: {
          type: "object",
          properties: {
            openLoops: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["commitment", "question", "request"],
                  },
                  title: { type: "string" },
                  direction: {
                    type: "string",
                    enum: ["owed_by_contact", "owed_to_contact"],
                  },
                  dueDate: { type: "string", nullable: true },
                  threadId: { type: "string" },
                  threadSubject: { type: "string" },
                },
                required: ["type", "title", "direction", "threadId"],
              },
            },
          },
          required: ["openLoops"],
        },
        prompt,
        temperature: 0.3,
      });

      trace.generation({
        name: "detect-open-loops",
        model: "claude-3-5-haiku",
        output: { count: result.object.openLoops.length },
      });

      return result.object.openLoops.map(
        (
          loop: {
            type: "commitment" | "question" | "request";
            title: string;
            direction: "owed_by_contact" | "owed_to_contact";
            dueDate?: string | null;
            threadId: string;
            threadSubject?: string;
          },
          index: number
        ) => ({
          id: `loop-${index}`,
          type: loop.type,
          title: loop.title,
          direction: loop.direction,
          dueDate: loop.dueDate ? new Date(loop.dueDate) : undefined,
          threadId: loop.threadId,
          threadSubject: loop.threadSubject,
        })
      );
    } catch (error) {
      trace.generation({
        name: "detect-open-loops-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return [];
    }
  }

  /**
   * Generate a meeting brief for a contact.
   */
  async generateMeetingBrief(
    context: ContactContext,
    threads: ThreadContext[],
    threadTopics: Map<string, { topicId: string; topicName: string }[]>,
    existingOpenLoops: ContactOpenLoop[] = []
  ): Promise<MeetingBrief> {
    const trace = observability.trace({
      name: "meeting-brief-generation",
      metadata: {
        contactId: context.contactId,
        threadCount: threads.length,
      },
    });

    // Calculate metrics
    const metrics = this.calculateCommunicationMetrics(
      threads,
      context.primaryEmail,
      context.userEmail,
      threadTopics
    );

    // Calculate scores
    const importanceScore = this.calculateImportanceScore(
      metrics,
      { email: context.primaryEmail },
      { isInActiveDeals: false, dealCount: 0 }
    );

    // Create baseline metrics (older data or default)
    const baselineMetrics = this.calculateCommunicationMetrics(
      threads.slice(Math.floor(threads.length / 2)),
      context.primaryEmail,
      context.userEmail,
      threadTopics
    );

    const healthScore = this.calculateHealthScore(metrics, baselineMetrics, {
      recentSentiment: 0,
      baselineSentiment: 0,
    });

    const vipResult = await this.detectVIP(
      importanceScore,
      { email: context.primaryEmail },
      threads
    );

    // Summarize recent history
    const recentHistory = await this.summarizeRecentHistory(
      context.displayName ?? context.primaryEmail,
      context.primaryEmail,
      threads.slice(0, 10)
    );

    // Detect open loops if not provided
    const openLoops =
      existingOpenLoops.length > 0
        ? existingOpenLoops
        : await this.detectOpenLoops(
            context.displayName ?? context.primaryEmail,
            threads.slice(0, 10)
          );

    // Generate talking points and suggestions
    try {
      const prompt = buildMeetingBriefPrompt(
        {
          name: context.displayName ?? context.primaryEmail,
          email: context.primaryEmail,
        },
        {
          firstContact: metrics.summary.firstInteractionAt ?? new Date(),
          totalThreads: metrics.summary.totalThreads,
          totalMessages: metrics.summary.totalMessages,
          lastInteraction: metrics.summary.lastInteractionAt ?? new Date(),
          healthScore: healthScore.overall,
          isVip: vipResult.isVip,
        },
        recentHistory,
        openLoops
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: MeetingBriefResponseSchema,
        prompt,
        temperature: 0.4,
      });

      trace.generation({
        name: "generate-meeting-brief",
        model: "claude-3-5-haiku",
        output: {
          talkingPoints: result.object.talkingPoints.length,
          suggestedTopics: result.object.suggestedTopics.length,
        },
      });

      return {
        contactId: context.contactId,
        generatedAt: new Date(),
        profile: {
          name: context.displayName ?? context.primaryEmail,
          email: context.primaryEmail,
        },
        relationshipSummary: {
          firstContact: metrics.summary.firstInteractionAt ?? new Date(),
          totalThreads: metrics.summary.totalThreads,
          totalMessages: metrics.summary.totalMessages,
          lastInteraction: metrics.summary.lastInteractionAt ?? new Date(),
          healthScore: healthScore.overall,
          isVip: vipResult.isVip,
        },
        recentHistory,
        openLoops,
        talkingPoints: result.object.talkingPoints,
        suggestedTopics: result.object.suggestedTopics,
      };
    } catch (error) {
      trace.generation({
        name: "generate-meeting-brief-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Return brief without LLM-generated content
      return {
        contactId: context.contactId,
        generatedAt: new Date(),
        profile: {
          name: context.displayName ?? context.primaryEmail,
          email: context.primaryEmail,
        },
        relationshipSummary: {
          firstContact: metrics.summary.firstInteractionAt ?? new Date(),
          totalThreads: metrics.summary.totalThreads,
          totalMessages: metrics.summary.totalMessages,
          lastInteraction: metrics.summary.lastInteractionAt ?? new Date(),
          healthScore: healthScore.overall,
          isVip: vipResult.isVip,
        },
        recentHistory,
        openLoops,
        talkingPoints: [],
        suggestedTopics: [],
      };
    }
  }

  /**
   * Predict response time for a contact.
   */
  predictResponseTime(
    metrics: CommunicationMetrics,
    messageContext: {
      isUrgent: boolean;
      isQuestion: boolean;
      isRequest: boolean;
      dayOfWeek: number;
      hourOfDay: number;
    }
  ): ResponseTimePrediction {
    const baseTime = metrics.responsiveness.medianResponseTimeMinutes;
    const factors: ResponseTimePrediction["factors"] = [];

    let predictedTime = baseTime || 60; // Default 1 hour if no data

    // Adjust for urgency
    if (messageContext.isUrgent) {
      predictedTime *= 0.5;
      factors.push({
        factor: "Urgent message",
        impact: "faster",
        description: "Urgent messages typically get faster responses",
      });
    }

    // Adjust for questions
    if (messageContext.isQuestion) {
      predictedTime *= 0.8;
      factors.push({
        factor: "Contains question",
        impact: "faster",
        description: "Questions often prompt quicker responses",
      });
    }

    // Adjust for time of day (outside business hours)
    const isBusinessHours =
      messageContext.hourOfDay >= 9 && messageContext.hourOfDay <= 17;
    if (!isBusinessHours) {
      predictedTime *= 1.5;
      factors.push({
        factor: "Outside business hours",
        impact: "slower",
        description: "Messages sent outside business hours take longer",
      });
    }

    // Adjust for weekends
    const isWeekend =
      messageContext.dayOfWeek === 0 || messageContext.dayOfWeek === 6;
    if (isWeekend) {
      predictedTime *= 2;
      factors.push({
        factor: "Weekend",
        impact: "slower",
        description: "Weekend messages typically take longer to get responses",
      });
    }

    // Calculate confidence based on data availability
    const hasHistoricalData = metrics.responsiveness.avgResponseTimeMinutes > 0;
    const confidence = hasHistoricalData ? 0.7 : 0.3;

    // Calculate range
    const minTime = Math.round(predictedTime * 0.5);
    const maxTime = Math.round(predictedTime * 2);

    return {
      predictedMinutes: Math.round(predictedTime),
      confidence,
      range: { min: minTime, max: maxTime },
      factors,
    };
  }

  // ===========================================================================
  // FULL ANALYSIS
  // ===========================================================================

  /**
   * Run full relationship analysis for a contact.
   */
  async analyzeRelationship(
    context: ContactContext,
    threads: ThreadContext[],
    threadTopics: Map<string, { topicId: string; topicName: string }[]>,
    dealInvolvement: {
      isInActiveDeals: boolean;
      dealValue?: number;
      dealCount: number;
    } = { isInActiveDeals: false, dealCount: 0 }
  ): Promise<{
    metrics: CommunicationMetrics;
    importanceScore: ImportanceScore;
    healthScore: HealthScore;
    vipDetection: VIPDetection;
    riskFlagging: RiskFlagging;
    engagementScore: number;
  }> {
    const trace = observability.trace({
      name: "relationship-analysis",
      metadata: {
        contactId: context.contactId,
        threadCount: threads.length,
      },
    });

    // Calculate communication metrics
    const metrics = this.calculateCommunicationMetrics(
      threads,
      context.primaryEmail,
      context.userEmail,
      threadTopics
    );

    // Calculate baseline metrics (using older half of threads)
    const olderThreads = threads.slice(Math.floor(threads.length / 2));
    const baselineMetrics =
      olderThreads.length > 0
        ? this.calculateCommunicationMetrics(
            olderThreads,
            context.primaryEmail,
            context.userEmail,
            threadTopics
          )
        : metrics;

    // Calculate importance score
    const importanceScore = this.calculateImportanceScore(
      metrics,
      { email: context.primaryEmail },
      dealInvolvement
    );

    // Calculate health score
    const healthScore = this.calculateHealthScore(metrics, baselineMetrics, {
      recentSentiment: 0,
      baselineSentiment: 0,
    });

    // Detect VIP status
    const vipDetection = await this.detectVIP(
      importanceScore,
      { email: context.primaryEmail },
      threads
    );

    // Calculate days since last contact
    const lastContactDaysAgo = metrics.summary.lastInteractionAt
      ? Math.floor(
          (Date.now() - metrics.summary.lastInteractionAt.getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 999;

    // Flag risk
    const riskFlagging = this.flagRisk(
      healthScore,
      metrics,
      lastContactDaysAgo
    );

    // Calculate engagement score
    const engagementScore = this.calculateEngagementScore(metrics);

    trace.generation({
      name: "analyze-relationship",
      model: "heuristic",
      output: {
        importance: importanceScore.overall,
        health: healthScore.overall,
        isVip: vipDetection.isVip,
        isAtRisk: riskFlagging.isAtRisk,
        engagement: engagementScore,
      },
    });

    return {
      metrics,
      importanceScore,
      healthScore,
      vipDetection,
      riskFlagging,
      engagementScore,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Create a new Relationship Agent instance.
 */
export function createRelationshipAgent(): RelationshipAgent {
  return new RelationshipAgent();
}

/**
 * Analyze a contact relationship (convenience function).
 */
export async function analyzeRelationship(
  context: ContactContext,
  threads: ThreadContext[],
  threadTopics: Map<string, { topicId: string; topicName: string }[]>
) {
  const agent = new RelationshipAgent();
  return await agent.analyzeRelationship(context, threads, threadTopics);
}

/**
 * Generate a meeting brief (convenience function).
 */
export async function generateMeetingBrief(
  context: ContactContext,
  threads: ThreadContext[],
  threadTopics: Map<string, { topicId: string; topicName: string }[]>
) {
  const agent = new RelationshipAgent();
  return await agent.generateMeetingBrief(context, threads, threadTopics);
}
