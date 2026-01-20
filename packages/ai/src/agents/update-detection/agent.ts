import { generateObject } from "ai";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDefaultModel } from "../../providers/index.js";
import type {
  DetectedReference,
  MessageInput,
  TrackedUIO,
  UpdateDetectionContext,
  UpdateDetectionResult,
} from "./types.js";
import { LLMUpdateDetectionResponseSchema } from "./types.js";

// =============================================================================
// UPDATE DETECTION AGENT
// =============================================================================

/**
 * Agent that detects when messages reference or update existing UIOs.
 * Scans incoming messages for mentions of tracked commitments and decisions.
 */
export class UpdateDetectionAgent {
  private db: unknown;

  constructor(db: unknown) {
    this.db = db;
  }

  /**
   * Detect updates to UIOs in a message.
   */
  async detectUpdates(
    context: UpdateDetectionContext
  ): Promise<UpdateDetectionResult> {
    const { organizationId, message } = context;

    // 1. Get active UIOs that might be referenced
    const relevantUIOs = await this.getRelevantUIOs(
      organizationId,
      message.senderContactId
    );

    if (relevantUIOs.length === 0) {
      return {
        hasUpdates: false,
        references: [],
        unrelatedContent: true,
      };
    }

    // 2. Use LLM to detect references
    const references = await this.detectReferencesWithLLM(
      message,
      relevantUIOs
    );

    return {
      hasUpdates: references.length > 0,
      references,
      unrelatedContent: references.length === 0,
    };
  }

  /**
   * Get UIOs that might be relevant to this message.
   * Includes UIOs where sender is owner or participant.
   */
  private async getRelevantUIOs(
    organizationId: string,
    senderContactId?: string
  ): Promise<TrackedUIO[]> {
    const dbTyped = this.db as {
      query: {
        unifiedIntelligenceObject: {
          findMany: (args: {
            where: unknown;
            limit: number;
            orderBy: unknown[];
          }) => Promise<TrackedUIO[]>;
        };
      };
    };

    // Import schema dynamically to avoid circular dependencies
    const { schema } = await import("@memorystack/db");

    const conditions = [
      eq(schema.unifiedIntelligenceObject.organizationId, organizationId),
      eq(schema.unifiedIntelligenceObject.status, "active"),
    ];

    // If we know the sender, prioritize UIOs they're involved with
    if (senderContactId) {
      // Get UIOs where sender is owner or participant
      const involvedUIOs =
        await dbTyped.query.unifiedIntelligenceObject.findMany({
          where: and(
            ...conditions,
            or(
              eq(
                schema.unifiedIntelligenceObject.ownerContactId,
                senderContactId
              ),
              sql`${senderContactId} = ANY(${schema.unifiedIntelligenceObject.participantContactIds})`
            )
          ),
          limit: 50,
          orderBy: [desc(schema.unifiedIntelligenceObject.lastUpdatedAt)],
        });

      if (involvedUIOs.length > 0) {
        return involvedUIOs;
      }
    }

    // Fallback: get recent active UIOs
    return dbTyped.query.unifiedIntelligenceObject.findMany({
      where: and(...conditions),
      limit: 30,
      orderBy: [desc(schema.unifiedIntelligenceObject.lastUpdatedAt)],
    });
  }

  /**
   * Use LLM to detect references to UIOs in the message.
   */
  private async detectReferencesWithLLM(
    message: MessageInput,
    uios: TrackedUIO[]
  ): Promise<DetectedReference[]> {
    if (uios.length === 0) {
      return [];
    }

    const model = getDefaultModel();

    // Build context about tracked UIOs
    const uioContext = uios
      .map((uio, idx) => {
        const parts = [
          `[${idx + 1}] ID: ${uio.id}`,
          `   Title: ${uio.canonicalTitle}`,
          `   Type: ${uio.type}`,
          `   Status: ${uio.status}`,
        ];
        if (uio.dueDate) {
          parts.push(`   Due: ${uio.dueDate.toISOString().split("T")[0]}`);
        }
        if (uio.canonicalDescription) {
          parts.push(
            `   Description: ${uio.canonicalDescription.slice(0, 100)}...`
          );
        }
        return parts.join("\n");
      })
      .join("\n\n");

    const systemPrompt = `You are an expert at detecting references to tracked commitments and decisions in messages.

Given a message and a list of tracked items (commitments, decisions), identify any references to these items.

A reference can be:
- Direct mention of the item by name or topic
- Update about progress, status, or timeline
- Completion or cancellation announcement
- Request for more time or delay
- Blocker or issue related to the item
- Delegation to someone else

For each reference found, extract:
1. The matched UIO ID
2. The type of update (status_change, due_date_change, due_date_confirmation, completion, cancellation, progress_update, blocker_mentioned, delegation, context_addition)
3. Confidence level (0-1)
4. The relevant quote from the message
5. Any extracted information (new date, new status, etc.)
6. Brief reasoning

Be conservative - only match if you're reasonably confident the message is referring to a tracked item.
Focus on semantic meaning, not just keyword matching.`;

    const userPrompt = `## Tracked Items

${uioContext}

## Message to Analyze

From: ${message.senderName || message.senderEmail || "Unknown"}
Subject: ${message.threadSubject || "(no subject)"}
Content:
${message.content}

---

Identify any references to the tracked items above. Return empty array if the message doesn't reference any of them.`;

    try {
      const { object: result } = await generateObject({
        model,
        schema: LLMUpdateDetectionResponseSchema,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.2,
      });

      // Map to our output format
      return result.referencesFound.map((ref) => {
        const matchedUio = uios.find((u) => u.id === ref.matchedUioId);
        return {
          uioId: ref.matchedUioId,
          uioTitle: matchedUio?.canonicalTitle || "Unknown",
          updateType: ref.updateType,
          confidence: ref.confidence,
          quotedText: ref.relevantQuote,
          extractedInfo: ref.extractedInfo,
          reasoning: ref.reasoning,
        };
      });
    } catch (error) {
      console.error("LLM update detection failed:", error);
      return [];
    }
  }

  /**
   * Apply detected updates to UIOs.
   * This modifies the UIOs based on detected references.
   */
  async applyUpdates(
    context: UpdateDetectionContext,
    references: DetectedReference[]
  ): Promise<void> {
    const { schema } = await import("@memorystack/db");
    const dbTyped = this.db as {
      update: (table: unknown) => {
        set: (values: unknown) => {
          where: (condition: unknown) => Promise<void>;
        };
      };
      insert: (table: unknown) => {
        values: (values: unknown) => Promise<void>;
      };
    };

    for (const ref of references) {
      if (ref.confidence < 0.6) {
        continue; // Skip low confidence updates
      }

      const updates: Record<string, unknown> = {
        lastUpdatedAt: new Date(),
        lastActivitySourceType: context.message.sourceType,
      };

      // Apply type-specific updates
      switch (ref.updateType) {
        case "completion":
          updates.status = "completed";
          break;

        case "cancellation":
          updates.status = "cancelled";
          break;

        case "due_date_change":
        case "due_date_confirmation":
          if (ref.extractedInfo.newDueDate) {
            updates.dueDate = new Date(ref.extractedInfo.newDueDate);
            updates.dueDateConfidence =
              ref.extractedInfo.dueDateConfidence ?? ref.confidence;
            updates.dueDateLastUpdatedAt = new Date();
          }
          break;
      }

      // Update the UIO
      if (Object.keys(updates).length > 2) {
        // More than just lastUpdatedAt and sourceType
        await dbTyped
          .update(schema.unifiedIntelligenceObject)
          .set(updates)
          .where(eq(schema.unifiedIntelligenceObject.id, ref.uioId));
      }

      // Add source reference
      await dbTyped.insert(schema.unifiedObjectSource).values({
        unifiedObjectId: ref.uioId,
        sourceType: context.message.sourceType,
        sourceAccountId: context.sourceAccountId,
        role: "update",
        conversationId: context.message.conversationId,
        messageId: context.message.id,
        quotedText: ref.quotedText,
        confidence: ref.confidence,
        sourceTimestamp: context.message.timestamp,
        detectionMethod: "llm_update_detection",
      });

      // Add timeline event
      await dbTyped.insert(schema.unifiedObjectTimeline).values({
        unifiedObjectId: ref.uioId,
        eventType: this.mapUpdateTypeToEventType(ref.updateType),
        eventDescription: this.generateEventDescription(ref),
        sourceType: context.message.sourceType,
        sourceId: context.message.conversationId,
        sourceName: context.message.senderName || context.message.senderEmail,
        messageId: context.message.id,
        quotedText: ref.quotedText,
        confidence: ref.confidence,
        triggeredBy: "system",
        eventAt: context.message.timestamp,
      });
    }
  }

  /**
   * Map update type to timeline event type.
   */
  private mapUpdateTypeToEventType(
    updateType: string
  ):
    | "status_changed"
    | "due_date_changed"
    | "due_date_confirmed"
    | "source_added" {
    switch (updateType) {
      case "completion":
      case "cancellation":
      case "status_change":
        return "status_changed";
      case "due_date_change":
        return "due_date_changed";
      case "due_date_confirmation":
        return "due_date_confirmed";
      default:
        return "source_added";
    }
  }

  /**
   * Generate a human-readable description of the update.
   */
  private generateEventDescription(ref: DetectedReference): string {
    switch (ref.updateType) {
      case "completion":
        return "Marked as completed";
      case "cancellation":
        return "Cancelled";
      case "due_date_change":
        return ref.extractedInfo.newDueDate
          ? `Due date changed to ${ref.extractedInfo.newDueDate}`
          : "Due date updated";
      case "due_date_confirmation":
        return "Due date confirmed";
      case "progress_update":
        return ref.extractedInfo.progressPercentage
          ? `Progress update: ${ref.extractedInfo.progressPercentage}%`
          : "Progress update received";
      case "blocker_mentioned":
        return ref.extractedInfo.blockerDescription
          ? `Blocker: ${ref.extractedInfo.blockerDescription.slice(0, 50)}...`
          : "Blocker mentioned";
      case "delegation":
        return ref.extractedInfo.delegatedTo
          ? `Delegated to ${ref.extractedInfo.delegatedTo}`
          : "Reassigned";
      case "context_addition":
        return "Additional context provided";
      default:
        return "Updated";
    }
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

export function createUpdateDetectionAgent(db: unknown): UpdateDetectionAgent {
  return new UpdateDetectionAgent(db);
}
