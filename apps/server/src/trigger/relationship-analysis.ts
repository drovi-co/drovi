// =============================================================================
// RELATIONSHIP ANALYSIS TRIGGER.DEV TASKS
// =============================================================================
//
// Background tasks for analyzing contact relationships and building profiles.
// Processes email data to calculate metrics, scores, and VIP status.
//

import {
  createRelationshipAgent,
  type RelationshipThreadContext,
} from "@saas-template/ai/agents";
import { db } from "@saas-template/db";
import {
  contact,
  emailMessage,
  emailThread,
  threadTopic,
} from "@saas-template/db/schema";
import { task } from "@trigger.dev/sdk";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface AnalyzeContactPayload {
  contactId: string;
  force?: boolean;
}

interface BatchAnalyzePayload {
  organizationId: string;
  contactIds?: string[];
  limit?: number;
  onlyStale?: boolean;
}

interface ContactAnalysisResult {
  success: boolean;
  contactId: string;
  metrics?: {
    importanceScore: number;
    healthScore: number;
    engagementScore: number;
    isVip: boolean;
    isAtRisk: boolean;
  };
  error?: string;
}

interface GenerateMeetingBriefPayload {
  contactId: string;
  organizationId: string;
}

// =============================================================================
// SINGLE CONTACT ANALYSIS
// =============================================================================

/**
 * Analyze relationship with a single contact.
 * Updates metrics, scores, and VIP/risk status.
 */
export const analyzeContactTask = task({
  id: "relationship-analysis-single",
  queue: {
    name: "relationship-analysis",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 180,
  run: async (
    payload: AnalyzeContactPayload
  ): Promise<ContactAnalysisResult> => {
    const { contactId, force = false } = payload;

    log.info("Starting contact relationship analysis", { contactId, force });

    try {
      // Get contact with organization
      const contactRecord = await db.query.contact.findFirst({
        where: eq(contact.id, contactId),
        with: {
          organization: true,
        },
      });

      if (!contactRecord) {
        return {
          success: false,
          contactId,
          error: "Contact not found",
        };
      }

      // Check if analysis is stale (default: analyze if > 24 hours old)
      const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (
        !force &&
        contactRecord.analyzedAt &&
        contactRecord.analyzedAt > staleCutoff
      ) {
        log.info("Contact analysis is fresh, skipping", { contactId });
        return {
          success: true,
          contactId,
          metrics: {
            importanceScore: contactRecord.importanceScore ?? 0,
            healthScore: contactRecord.healthScore ?? 0,
            engagementScore: contactRecord.engagementScore ?? 0,
            isVip: contactRecord.isVip ?? false,
            isAtRisk: contactRecord.isAtRisk ?? false,
          },
        };
      }

      // Get threads involving this contact (last 90 days)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

      // Find threads where the contact participated
      const contactEmail = contactRecord.primaryEmail.toLowerCase();

      const threads = await db.query.emailThread.findMany({
        where: and(
          eq(emailThread.organizationId, contactRecord.organizationId),
          gte(emailThread.lastMessageAt, ninetyDaysAgo)
        ),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
          account: true,
        },
        orderBy: [desc(emailThread.lastMessageAt)],
        limit: 100,
      });

      // Filter to threads involving this contact
      const contactThreads = threads.filter((t) =>
        t.messages.some(
          (m) =>
            m.fromEmail.toLowerCase() === contactEmail ||
            m.toEmails?.some((e) => e.toLowerCase() === contactEmail)
        )
      );

      if (contactThreads.length === 0) {
        log.info("No threads found for contact", { contactId });

        // Update contact as analyzed but with no data
        await db
          .update(contact)
          .set({
            analyzedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(contact.id, contactId));

        return {
          success: true,
          contactId,
          metrics: {
            importanceScore: 0,
            healthScore: 0,
            engagementScore: 0,
            isVip: false,
            isAtRisk: false,
          },
        };
      }

      // Get thread topics
      const threadIds = contactThreads.map((t) => t.id);
      const threadTopicAssocs = await db.query.threadTopic.findMany({
        where: inArray(threadTopic.threadId, threadIds),
        with: {
          topic: true,
        },
      });

      // Build thread topics map
      const threadTopicsMap = new Map<
        string,
        { topicId: string; topicName: string }[]
      >();
      for (const assoc of threadTopicAssocs) {
        const existing = threadTopicsMap.get(assoc.threadId) ?? [];
        existing.push({
          topicId: assoc.topicId,
          topicName: assoc.topic.name,
        });
        threadTopicsMap.set(assoc.threadId, existing);
      }

      // Get user email from the first thread's account
      const userEmail = contactThreads[0]?.account.email ?? "";

      // Build thread context for agent
      const threadContexts: RelationshipThreadContext[] = contactThreads.map(
        (t) => ({
          threadId: t.id,
          subject: t.subject ?? undefined,
          participants: [
            ...new Set(
              t.messages.flatMap((m) => [m.fromEmail, ...(m.toEmails ?? [])])
            ),
          ],
          messageCount: t.messages.length,
          firstMessageAt: t.messages[0]?.sentAt ?? new Date(),
          lastMessageAt: t.messages.at(-1)?.sentAt ?? new Date(),
          messages: t.messages.map((m) => ({
            id: m.id,
            fromEmail: m.fromEmail,
            sentAt: m.sentAt ?? undefined,
            bodyText: m.bodyText ?? undefined,
            isFromUser: m.isFromUser,
          })),
        })
      );

      // Run relationship analysis
      const agent = createRelationshipAgent();
      const analysis = await agent.analyzeRelationship(
        {
          contactId,
          organizationId: contactRecord.organizationId,
          primaryEmail: contactRecord.primaryEmail,
          displayName: contactRecord.displayName ?? undefined,
          userEmail,
        },
        threadContexts,
        threadTopicsMap
      );

      // Update contact with analysis results
      await db
        .update(contact)
        .set({
          importanceScore: analysis.importanceScore.overall,
          healthScore: analysis.healthScore.overall,
          engagementScore: analysis.engagementScore,
          isVip: analysis.vipDetection.isVip,
          vipConfidence: analysis.vipDetection.confidence,
          isAtRisk: analysis.riskFlagging.isAtRisk,
          riskLevel: analysis.riskFlagging.riskLevel,
          frequencyTrend: analysis.metrics.frequency.trend,
          responseRate: analysis.metrics.responsiveness.responseRate,
          avgResponseTimeMinutes:
            analysis.metrics.responsiveness.avgResponseTimeMinutes,
          totalThreads: analysis.metrics.summary.totalThreads,
          totalMessages: analysis.metrics.summary.totalMessages,
          firstInteractionAt: analysis.metrics.summary.firstInteractionAt,
          lastInteractionAt: analysis.metrics.summary.lastInteractionAt,
          analyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(contact.id, contactId));

      log.info("Contact relationship analysis completed", {
        contactId,
        importanceScore: analysis.importanceScore.overall,
        isVip: analysis.vipDetection.isVip,
        isAtRisk: analysis.riskFlagging.isAtRisk,
      });

      return {
        success: true,
        contactId,
        metrics: {
          importanceScore: analysis.importanceScore.overall,
          healthScore: analysis.healthScore.overall,
          engagementScore: analysis.engagementScore,
          isVip: analysis.vipDetection.isVip,
          isAtRisk: analysis.riskFlagging.isAtRisk,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Contact relationship analysis failed", error, { contactId });

      return {
        success: false,
        contactId,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// BATCH CONTACT ANALYSIS
// =============================================================================

/**
 * Analyze relationships for multiple contacts.
 */
export const batchAnalyzeContactsTask = task({
  id: "relationship-analysis-batch",
  queue: {
    name: "relationship-analysis-batch",
    concurrencyLimit: 3,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600,
  run: async (
    payload: BatchAnalyzePayload
  ): Promise<{
    success: boolean;
    total: number;
    processed: number;
    errors: string[];
  }> => {
    const {
      organizationId,
      contactIds,
      limit = 50,
      onlyStale = true,
    } = payload;

    log.info("Starting batch contact analysis", {
      organizationId,
      providedCount: contactIds?.length,
      limit,
      onlyStale,
    });

    // Get contacts to process
    let contactsToProcess: string[];

    if (contactIds) {
      contactsToProcess = contactIds;
    } else {
      // Find contacts that need analysis
      const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const staleContacts = await db.query.contact.findMany({
        where: and(
          eq(contact.organizationId, organizationId),
          onlyStale
            ? sql`(${contact.analyzedAt} IS NULL OR ${contact.analyzedAt} < ${staleCutoff})`
            : undefined
        ),
        columns: { id: true },
        orderBy: [desc(contact.lastInteractionAt)],
        limit,
      });

      contactsToProcess = staleContacts.map((c) => c.id);
    }

    if (contactsToProcess.length === 0) {
      return {
        success: true,
        total: 0,
        processed: 0,
        errors: [],
      };
    }

    log.info("Found contacts to analyze", { count: contactsToProcess.length });

    // Process contacts
    const errors: string[] = [];
    let processed = 0;

    // Process in chunks
    const chunkSize = 10;
    for (let i = 0; i < contactsToProcess.length; i += chunkSize) {
      const chunk = contactsToProcess.slice(i, i + chunkSize);

      // Trigger tasks in parallel
      const handles = await Promise.all(
        chunk.map((contactId) => analyzeContactTask.trigger({ contactId }))
      );

      processed += handles.length;
    }

    log.info("Batch contact analysis completed", {
      total: contactsToProcess.length,
      processed,
      errors: errors.length,
    });

    return {
      success: errors.length === 0,
      total: contactsToProcess.length,
      processed,
      errors,
    };
  },
});

// =============================================================================
// MEETING BRIEF GENERATION
// =============================================================================

/**
 * Generate a meeting brief for a contact.
 */
export const generateMeetingBriefTask = task({
  id: "relationship-meeting-brief",
  queue: {
    name: "relationship-analysis",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 30_000,
    factor: 2,
  },
  maxDuration: 120,
  run: async (
    payload: GenerateMeetingBriefPayload
  ): Promise<{
    success: boolean;
    brief?: {
      talkingPoints: string[];
      suggestedTopics: string[];
      healthScore: number;
      isVip: boolean;
    };
    error?: string;
  }> => {
    const { contactId, organizationId } = payload;

    log.info("Generating meeting brief", { contactId, organizationId });

    try {
      // Get contact
      const contactRecord = await db.query.contact.findFirst({
        where: and(
          eq(contact.id, contactId),
          eq(contact.organizationId, organizationId)
        ),
      });

      if (!contactRecord) {
        return {
          success: false,
          error: "Contact not found",
        };
      }

      // Get recent threads (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const contactEmail = contactRecord.primaryEmail.toLowerCase();

      const threads = await db.query.emailThread.findMany({
        where: and(
          eq(emailThread.organizationId, organizationId),
          gte(emailThread.lastMessageAt, thirtyDaysAgo)
        ),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
          account: true,
        },
        orderBy: [desc(emailThread.lastMessageAt)],
        limit: 20,
      });

      // Filter to threads involving this contact
      const contactThreads = threads.filter((t) =>
        t.messages.some(
          (m) =>
            m.fromEmail.toLowerCase() === contactEmail ||
            m.toEmails?.some((e) => e.toLowerCase() === contactEmail)
        )
      );

      // Get thread topics
      const threadIds = contactThreads.map((t) => t.id);
      const threadTopicAssocs =
        threadIds.length > 0
          ? await db.query.threadTopic.findMany({
              where: inArray(threadTopic.threadId, threadIds),
              with: { topic: true },
            })
          : [];

      // Build thread topics map
      const threadTopicsMap = new Map<
        string,
        { topicId: string; topicName: string }[]
      >();
      for (const assoc of threadTopicAssocs) {
        const existing = threadTopicsMap.get(assoc.threadId) ?? [];
        existing.push({
          topicId: assoc.topicId,
          topicName: assoc.topic.name,
        });
        threadTopicsMap.set(assoc.threadId, existing);
      }

      // Get user email
      const userEmail = contactThreads[0]?.account.email ?? "";

      // Build thread context
      const threadContexts: RelationshipThreadContext[] = contactThreads.map(
        (t) => ({
          threadId: t.id,
          subject: t.subject ?? undefined,
          participants: [
            ...new Set(
              t.messages.flatMap((m) => [m.fromEmail, ...(m.toEmails ?? [])])
            ),
          ],
          messageCount: t.messages.length,
          firstMessageAt: t.messages[0]?.sentAt ?? new Date(),
          lastMessageAt: t.messages.at(-1)?.sentAt ?? new Date(),
          messages: t.messages.map((m) => ({
            id: m.id,
            fromEmail: m.fromEmail,
            sentAt: m.sentAt ?? undefined,
            bodyText: m.bodyText ?? undefined,
            isFromUser: m.isFromUser,
          })),
        })
      );

      // Generate meeting brief
      const agent = createRelationshipAgent();
      const brief = await agent.generateMeetingBrief(
        {
          contactId,
          organizationId,
          primaryEmail: contactRecord.primaryEmail,
          displayName: contactRecord.displayName ?? undefined,
          userEmail,
        },
        threadContexts,
        threadTopicsMap
      );

      log.info("Meeting brief generated", {
        contactId,
        talkingPointsCount: brief.talkingPoints.length,
      });

      return {
        success: true,
        brief: {
          talkingPoints: brief.talkingPoints,
          suggestedTopics: brief.suggestedTopics,
          healthScore: brief.relationshipSummary.healthScore,
          isVip: brief.relationshipSummary.isVip,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Meeting brief generation failed", error, { contactId });

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
});

// =============================================================================
// PROFILE ENRICHMENT
// =============================================================================

/**
 * Enrich contact profile from email signatures and content.
 */
export const enrichContactProfileTask = task({
  id: "relationship-profile-enrichment",
  queue: {
    name: "relationship-analysis",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 3000,
    maxTimeoutInMs: 15_000,
    factor: 2,
  },
  maxDuration: 60,
  run: async (payload: {
    contactId: string;
  }): Promise<{
    success: boolean;
    enriched: boolean;
    profile?: {
      title?: string;
      company?: string;
      phone?: string;
    };
    error?: string;
  }> => {
    const { contactId } = payload;

    log.info("Enriching contact profile", { contactId });

    try {
      // Get contact
      const contactRecord = await db.query.contact.findFirst({
        where: eq(contact.id, contactId),
      });

      if (!contactRecord) {
        return {
          success: false,
          enriched: false,
          error: "Contact not found",
        };
      }

      // Get recent messages from this contact
      const contactEmail = contactRecord.primaryEmail.toLowerCase();

      const recentMessages = await db.query.emailMessage.findMany({
        where: eq(sql`LOWER(${emailMessage.fromEmail})`, contactEmail),
        orderBy: [desc(emailMessage.sentAt)],
        limit: 10,
      });

      if (recentMessages.length === 0) {
        return {
          success: true,
          enriched: false,
        };
      }

      // Extract signatures
      const agent = createRelationshipAgent();
      const signatures = await agent.extractSignatures(
        recentMessages.map((m) => ({
          bodyText: m.bodyText ?? "",
          fromEmail: m.fromEmail,
          fromName: m.fromName ?? undefined,
        }))
      );

      if (signatures.length === 0) {
        return {
          success: true,
          enriched: false,
        };
      }

      // Use the highest confidence signature
      const bestSignature = signatures.sort(
        (a, b) => b.confidence - a.confidence
      )[0];

      if (!bestSignature || bestSignature.confidence < 0.5) {
        return {
          success: true,
          enriched: false,
        };
      }

      // Update contact with enriched data
      const updates: Record<string, unknown> = {};

      if (bestSignature.title && !contactRecord.title) {
        updates.title = bestSignature.title;
      }
      if (bestSignature.company && !contactRecord.company) {
        updates.company = bestSignature.company;
      }
      if (bestSignature.phone && !contactRecord.phone) {
        updates.phone = bestSignature.phone;
      }
      if (bestSignature.linkedinUrl && !contactRecord.linkedinUrl) {
        updates.linkedinUrl = bestSignature.linkedinUrl;
      }
      if (bestSignature.name && !contactRecord.displayName) {
        updates.displayName = bestSignature.name;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();

        await db.update(contact).set(updates).where(eq(contact.id, contactId));

        log.info("Contact profile enriched", {
          contactId,
          fieldsUpdated: Object.keys(updates).filter((k) => k !== "updatedAt"),
        });

        return {
          success: true,
          enriched: true,
          profile: {
            title: bestSignature.title,
            company: bestSignature.company,
            phone: bestSignature.phone,
          },
        };
      }

      return {
        success: true,
        enriched: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log.error("Contact profile enrichment failed", error, { contactId });

      return {
        success: false,
        enriched: false,
        error: errorMessage,
      };
    }
  },
});
