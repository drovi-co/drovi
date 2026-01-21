// =============================================================================
// UNIFIED OBJECT SERVICE
// =============================================================================
//
// Service for managing Unified Intelligence Objects (UIOs).
// Handles creation, merging, timeline events, and embedding generation.
//

import type {
  DeduplicationResult,
  ExtractedCommitmentForDedup,
} from "@memorystack/ai/agents";
import { createDeduplicationAgent } from "@memorystack/ai/agents";
import { db, schema } from "@memorystack/db";
import { and, desc, eq, sql } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface SourceContext {
  organizationId: string;
  sourceType: string;
  sourceAccountId?: string;
  conversationId?: string;
  messageId?: string;
  emailThreadId?: string;
  emailMessageId?: string;
  sourceName?: string;
  messageTimestamp?: Date;
}

export interface CreateUIOInput {
  commitment: ExtractedCommitmentForDedup;
  source: SourceContext;
  originalCommitmentId?: string;
  originalDecisionId?: string;
  originalClaimId?: string;
}

export interface TimelineEventInput {
  eventType:
    | "created"
    | "status_changed"
    | "due_date_changed"
    | "due_date_confirmed"
    | "participant_added"
    | "source_added"
    | "merged"
    | "user_verified"
    | "user_corrected"
    | "auto_completed";
  eventDescription: string;
  sourceType?: string;
  sourceId?: string;
  sourceName?: string;
  messageId?: string;
  quotedText?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  confidence?: number;
  triggeredBy?: string;
}

export interface SourceBreadcrumb {
  sourceType: string;
  count: number;
  latestTimestamp: Date | null;
  sourceName: string;
}

// =============================================================================
// UNIFIED OBJECT SERVICE
// =============================================================================

export class UnifiedObjectService {
  /**
   * Process a new commitment into the UIO system.
   * Checks for duplicates and either creates new or merges into existing.
   */
  async processNewCommitment(
    input: CreateUIOInput
  ): Promise<typeof schema.unifiedIntelligenceObject.$inferSelect> {
    // biome-ignore lint/suspicious/noExplicitAny: db type is compatible but TypeScript can't infer it
    const deduplicationAgent = createDeduplicationAgent(db as any);

    const result = await deduplicationAgent.checkForDuplicates({
      organizationId: input.source.organizationId,
      newCommitment: input.commitment,
      sourceType: input.source.sourceType,
      sourceConversationId: input.source.conversationId || "",
      sourceMessageId: input.source.messageId,
      sourceAccountId: input.source.sourceAccountId,
    });

    switch (result.action) {
      case "create_new":
        return this.createNewUIO(input);

      case "merge_into":
        if (!result.targetUioId) {
          throw new Error("merge_into action requires targetUioId");
        }
        return this.mergeIntoExistingUIO(result.targetUioId, input);

      case "pending_review": {
        // Create new UIO and deduplication candidate
        const newUio = await this.createNewUIO(input);
        if (result.targetUioId) {
          await this.createDeduplicationCandidate(
            newUio.id,
            result.targetUioId,
            result,
            input.source.organizationId
          );
        }
        return newUio;
      }
    }
  }

  /**
   * Create a new UIO from a commitment.
   */
  async createNewUIO(
    input: CreateUIOInput
  ): Promise<typeof schema.unifiedIntelligenceObject.$inferSelect> {
    const { commitment, source } = input;

    // Resolve owner contact
    const ownerContactId = await this.resolvePartyToContact(
      commitment.debtorEmail || commitment.creditorEmail,
      source.organizationId
    );

    // Create UIO
    const [uio] = await db
      .insert(schema.unifiedIntelligenceObject)
      .values({
        organizationId: source.organizationId,
        type: "commitment",
        status: "active",
        canonicalTitle: commitment.title,
        canonicalDescription: commitment.description,
        dueDate: commitment.dueDate,
        dueDateConfidence: commitment.dueDateConfidence,
        dueDateLastUpdatedAt: new Date(),
        dueDateLastUpdatedSourceId: source.sourceAccountId,
        ownerContactId,
        participantContactIds: [],
        overallConfidence: commitment.confidence,
        firstSeenAt: new Date(),
        lastUpdatedAt: new Date(),
        lastActivitySourceType:
          source.sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
      })
      .returning();

    if (!uio) {
      throw new Error("Failed to create UIO");
    }

    // Add source reference
    await this.addSourceToUIO(uio.id, input, "origin");

    // Add timeline event
    await this.addTimelineEvent(uio.id, {
      eventType: "created",
      eventDescription: `Created from ${source.sourceType}`,
      sourceType: source.sourceType,
      sourceId: source.conversationId,
      sourceName: source.sourceName,
      confidence: commitment.confidence,
      triggeredBy: "system",
    });

    // Trigger embedding generation (async)
    this.generateUIOEmbedding(uio.id).catch(console.error);

    return uio;
  }

  /**
   * Merge a new commitment into an existing UIO.
   */
  async mergeIntoExistingUIO(
    uioId: string,
    input: CreateUIOInput
  ): Promise<typeof schema.unifiedIntelligenceObject.$inferSelect> {
    const { commitment, source } = input;

    const existingUio = await db.query.unifiedIntelligenceObject.findFirst({
      where: eq(schema.unifiedIntelligenceObject.id, uioId),
    });

    if (!existingUio) {
      throw new Error(`UIO ${uioId} not found`);
    }

    // Determine what changed
    const updates: Partial<
      typeof schema.unifiedIntelligenceObject.$inferInsert
    > = {
      lastUpdatedAt: new Date(),
      lastActivitySourceType:
        source.sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
    };

    // Update due date if more confident or more recent
    if (commitment.dueDate) {
      const shouldUpdateDueDate =
        !existingUio.dueDate ||
        (commitment.dueDateConfidence ?? 0) >
          (existingUio.dueDateConfidence ?? 0) ||
        (source.messageTimestamp &&
          existingUio.dueDateLastUpdatedAt &&
          source.messageTimestamp > existingUio.dueDateLastUpdatedAt);

      if (shouldUpdateDueDate) {
        updates.dueDate = commitment.dueDate;
        updates.dueDateConfidence = commitment.dueDateConfidence;
        updates.dueDateLastUpdatedAt = new Date();
        updates.dueDateLastUpdatedSourceId = source.sourceAccountId;

        // Add timeline event for due date change
        await this.addTimelineEvent(uioId, {
          eventType: "due_date_changed",
          eventDescription: `Due date updated from ${source.sourceType}`,
          sourceType: source.sourceType,
          sourceId: source.conversationId,
          sourceName: source.sourceName,
          previousValue: { dueDate: existingUio.dueDate?.toISOString() },
          newValue: { dueDate: commitment.dueDate.toISOString() },
          confidence: commitment.dueDateConfidence,
          triggeredBy: "system",
        });
      }
    }

    // Update UIO
    await db
      .update(schema.unifiedIntelligenceObject)
      .set(updates)
      .where(eq(schema.unifiedIntelligenceObject.id, uioId));

    // Add source reference
    await this.addSourceToUIO(uioId, input, "update");

    // Add timeline event for new source
    await this.addTimelineEvent(uioId, {
      eventType: "source_added",
      eventDescription: `Mentioned in ${source.sourceType}`,
      sourceType: source.sourceType,
      sourceId: source.conversationId,
      sourceName: source.sourceName,
      messageId: source.messageId,
      quotedText: commitment.sourceQuote,
      confidence: commitment.confidence,
      triggeredBy: "system",
    });

    // Re-generate embedding (async)
    this.generateUIOEmbedding(uioId).catch(console.error);

    return (await db.query.unifiedIntelligenceObject.findFirst({
      where: eq(schema.unifiedIntelligenceObject.id, uioId),
    }))!;
  }

  /**
   * Merge two UIOs together (user-triggered).
   */
  async mergeUIOs(
    sourceId: string,
    targetId: string,
    userId: string
  ): Promise<typeof schema.unifiedIntelligenceObject.$inferSelect> {
    // Get both UIOs
    const [sourceUio, targetUio] = await Promise.all([
      db.query.unifiedIntelligenceObject.findFirst({
        where: eq(schema.unifiedIntelligenceObject.id, sourceId),
        with: { sources: true },
      }),
      db.query.unifiedIntelligenceObject.findFirst({
        where: eq(schema.unifiedIntelligenceObject.id, targetId),
      }),
    ]);

    if (!(sourceUio && targetUio)) {
      throw new Error("One or both UIOs not found");
    }

    // Move all source references from source to target
    await db
      .update(schema.unifiedObjectSource)
      .set({ unifiedObjectId: targetId })
      .where(eq(schema.unifiedObjectSource.unifiedObjectId, sourceId));

    // Mark source as merged
    await db
      .update(schema.unifiedIntelligenceObject)
      .set({
        status: "merged",
        mergedIntoId: targetId,
        updatedAt: new Date(),
      })
      .where(eq(schema.unifiedIntelligenceObject.id, sourceId));

    // Update target
    await db
      .update(schema.unifiedIntelligenceObject)
      .set({ lastUpdatedAt: new Date() })
      .where(eq(schema.unifiedIntelligenceObject.id, targetId));

    // Add timeline event
    await this.addTimelineEvent(targetId, {
      eventType: "merged",
      eventDescription: `Merged with "${sourceUio.canonicalTitle}"`,
      previousValue: { mergedUioId: sourceId },
      triggeredBy: userId,
    });

    // Re-generate embedding
    this.generateUIOEmbedding(targetId).catch(console.error);

    return (await db.query.unifiedIntelligenceObject.findFirst({
      where: eq(schema.unifiedIntelligenceObject.id, targetId),
    }))!;
  }

  /**
   * Add a source reference to a UIO.
   */
  private async addSourceToUIO(
    uioId: string,
    input: CreateUIOInput,
    role: "origin" | "update" | "confirmation" | "context"
  ): Promise<void> {
    const { commitment, source } = input;

    await db.insert(schema.unifiedObjectSource).values({
      unifiedObjectId: uioId,
      sourceType:
        source.sourceType as (typeof schema.sourceTypeEnum.enumValues)[number],
      sourceAccountId: source.sourceAccountId,
      role,
      conversationId: source.conversationId,
      messageId: source.messageId,
      emailThreadId: source.emailThreadId,
      emailMessageId: source.emailMessageId,
      originalCommitmentId: input.originalCommitmentId,
      originalDecisionId: input.originalDecisionId,
      originalClaimId: input.originalClaimId,
      quotedText: commitment.sourceQuote,
      extractedTitle: commitment.title,
      extractedDueDate: commitment.dueDate,
      confidence: commitment.confidence,
      sourceTimestamp: source.messageTimestamp,
      detectionMethod: "extraction",
    });
  }

  /**
   * Add a timeline event to a UIO.
   */
  async addTimelineEvent(
    uioId: string,
    input: TimelineEventInput
  ): Promise<void> {
    await db.insert(schema.unifiedObjectTimeline).values({
      unifiedObjectId: uioId,
      eventType: input.eventType,
      eventDescription: input.eventDescription,
      sourceType: input.sourceType as
        | (typeof schema.sourceTypeEnum.enumValues)[number]
        | undefined,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      messageId: input.messageId,
      quotedText: input.quotedText,
      previousValue: input.previousValue,
      newValue: input.newValue,
      confidence: input.confidence,
      triggeredBy: input.triggeredBy,
      eventAt: new Date(),
    });
  }

  /**
   * Create a deduplication candidate for human review.
   */
  async createDeduplicationCandidate(
    sourceId: string,
    targetId: string,
    result: DeduplicationResult,
    organizationId: string
  ): Promise<void> {
    // Check if candidate already exists
    const existing = await db.query.deduplicationCandidate.findFirst({
      where: and(
        eq(schema.deduplicationCandidate.sourceObjectId, sourceId),
        eq(schema.deduplicationCandidate.targetObjectId, targetId)
      ),
    });

    if (existing) {
      return;
    }

    await db.insert(schema.deduplicationCandidate).values({
      organizationId,
      sourceObjectId: sourceId,
      targetObjectId: targetId,
      semanticSimilarity: result.scores?.semanticSimilarity ?? 0,
      partyMatchScore: result.scores?.partyMatchScore,
      temporalScore: result.scores?.temporalScore,
      overallScore: result.scores?.overallScore ?? result.confidence,
      matchReasons: result.matchReasons,
      matchExplanation: result.explanation,
      status: "pending_review",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
  }

  /**
   * Generate embedding for a UIO.
   */
  async generateUIOEmbedding(uioId: string): Promise<void> {
    const uio = await db.query.unifiedIntelligenceObject.findFirst({
      where: eq(schema.unifiedIntelligenceObject.id, uioId),
    });

    if (!uio) {
      throw new Error(`UIO ${uioId} not found`);
    }

    // Build text for embedding
    const text = `[${uio.type.toUpperCase()}] ${uio.canonicalTitle}\n${uio.canonicalDescription ?? ""}`;

    // Generate embedding
    const response = await fetch(
      `${process.env.EMBEDDING_SERVICE_URL || "https://api.openai.com/v1"}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    const embedding = data.data[0]?.embedding;

    if (!embedding) {
      throw new Error("No embedding returned");
    }

    // Upsert embedding
    await db
      .insert(schema.unifiedObjectEmbedding)
      .values({
        unifiedObjectId: uioId,
        embedding,
        model: "text-embedding-3-small",
        inputHash: this.hashString(text),
      })
      .onConflictDoUpdate({
        target: schema.unifiedObjectEmbedding.unifiedObjectId,
        set: {
          embedding,
          inputHash: this.hashString(text),
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Resolve an email to a contact ID.
   */
  private async resolvePartyToContact(
    email: string | undefined,
    organizationId: string
  ): Promise<string | null> {
    if (!email) {
      return null;
    }

    const contact = await db.query.contact.findFirst({
      where: and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.primaryEmail, email.toLowerCase())
      ),
    });

    return contact?.id ?? null;
  }

  /**
   * Simple string hash for cache invalidation.
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Get a UIO with all its sources and timeline.
   */
  async getUIOWithDetails(uioId: string): Promise<
    | (typeof schema.unifiedIntelligenceObject.$inferSelect & {
        sources: (typeof schema.unifiedObjectSource.$inferSelect)[];
        timeline: (typeof schema.unifiedObjectTimeline.$inferSelect)[];
        sourceBreadcrumbs: SourceBreadcrumb[];
      })
    | null
  > {
    const uio = await db.query.unifiedIntelligenceObject.findFirst({
      where: eq(schema.unifiedIntelligenceObject.id, uioId),
      with: {
        sources: {
          orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
        },
        timeline: {
          orderBy: [desc(schema.unifiedObjectTimeline.eventAt)],
        },
      },
    });

    if (!uio) {
      return null;
    }

    return {
      ...uio,
      sourceBreadcrumbs: this.buildSourceBreadcrumbs(uio.sources),
    };
  }

  /**
   * Build source breadcrumbs from sources.
   */
  buildSourceBreadcrumbs(
    sources: (typeof schema.unifiedObjectSource.$inferSelect)[]
  ): SourceBreadcrumb[] {
    const uniqueSources = new Map<string, SourceBreadcrumb>();

    for (const source of sources) {
      const existing = uniqueSources.get(source.sourceType);
      if (existing) {
        existing.count++;
        if (
          source.sourceTimestamp &&
          (!existing.latestTimestamp ||
            source.sourceTimestamp > existing.latestTimestamp)
        ) {
          existing.latestTimestamp = source.sourceTimestamp;
        }
      } else {
        uniqueSources.set(source.sourceType, {
          sourceType: source.sourceType,
          count: 1,
          latestTimestamp: source.sourceTimestamp,
          sourceName: this.getSourceDisplayName(source.sourceType),
        });
      }
    }

    return Array.from(uniqueSources.values()).sort(
      (a, b) =>
        (b.latestTimestamp?.getTime() ?? 0) -
        (a.latestTimestamp?.getTime() ?? 0)
    );
  }

  /**
   * Get display name for a source type.
   */
  private getSourceDisplayName(sourceType: string): string {
    const names: Record<string, string> = {
      email: "Email",
      slack: "Slack",
      calendar: "Calendar",
      whatsapp: "WhatsApp",
      notion: "Notion",
      google_docs: "Google Docs",
      google_sheets: "Google Sheets",
      meeting_transcript: "Meeting",
      teams: "Teams",
      discord: "Discord",
      linear: "Linear",
      github: "GitHub",
    };
    return names[sourceType] || sourceType;
  }

  /**
   * List UIOs for an organization.
   */
  async listUIOs(options: {
    organizationId: string;
    type?: "commitment" | "decision" | "topic" | "all";
    status?: "active" | "merged" | "archived" | "all";
    limit?: number;
    offset?: number;
  }): Promise<{
    items: (typeof schema.unifiedIntelligenceObject.$inferSelect & {
      sourceBreadcrumbs: SourceBreadcrumb[];
    })[];
    total: number;
  }> {
    const {
      organizationId,
      type = "all",
      status = "active",
      limit = 50,
      offset = 0,
    } = options;

    const conditions = [
      eq(schema.unifiedIntelligenceObject.organizationId, organizationId),
    ];

    if (type !== "all") {
      conditions.push(eq(schema.unifiedIntelligenceObject.type, type));
    }

    if (status !== "all") {
      conditions.push(eq(schema.unifiedIntelligenceObject.status, status));
    }

    const [uios, countResult] = await Promise.all([
      db.query.unifiedIntelligenceObject.findMany({
        where: and(...conditions),
        limit,
        offset,
        orderBy: [desc(schema.unifiedIntelligenceObject.lastUpdatedAt)],
        with: {
          sources: {
            orderBy: [desc(schema.unifiedObjectSource.sourceTimestamp)],
          },
        },
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(schema.unifiedIntelligenceObject)
        .where(and(...conditions)),
    ]);

    return {
      items: uios.map((uio) => ({
        ...uio,
        sourceBreadcrumbs: this.buildSourceBreadcrumbs(uio.sources),
      })),
      total: countResult[0]?.count ?? 0,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const unifiedObjectService = new UnifiedObjectService();
