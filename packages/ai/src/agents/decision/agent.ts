// =============================================================================
// DECISION AGENT (Agent 3)
// =============================================================================
//
// Extracts and tracks decisions from email threads.
// Captures rationale, alternatives, and detects supersession.
//

import { generateObject } from "ai";
import { observability } from "../../observability";
import { getModel } from "../../providers/index";
import {
  buildDecisionExtractionPrompt,
  buildDecisionQueryPrompt,
  buildRationaleExtractionPrompt,
  buildSupersessionPrompt,
  formatMessagesForDecision,
} from "./prompts/extraction";
import {
  type Alternative,
  type DecisionClaimInput,
  DecisionExtractionResponseSchema,
  type DecisionParticipant,
  DecisionQueryResponseSchema,
  type DecisionSearchResult,
  type DecisionThreadContext,
  type ExtractedDecision,
  RationaleExtractionResponseSchema,
  type Supersession,
  SupersessionDetectionResponseSchema,
} from "./types";

// Model version for tracking
const MODEL_VERSION = "1.0.0";

/**
 * Decision Agent
 *
 * Extracts decisions from email claims and tracks their evolution.
 */
export class DecisionAgent {
  /**
   * Extract decisions from decision claims.
   */
  async extractDecisions(
    context: DecisionThreadContext,
    decisionClaims: DecisionClaimInput[]
  ): Promise<ExtractedDecision[]> {
    const trace = observability.trace({
      name: "decision-extraction",
      metadata: {
        threadId: context.threadId,
        claimCount: decisionClaims.length,
      },
    });

    // If no claims to process, return early
    if (decisionClaims.length === 0) {
      return [];
    }

    try {
      const prompt = buildDecisionExtractionPrompt(context, decisionClaims);

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: DecisionExtractionResponseSchema,
        prompt,
        temperature: 0.3,
      });

      const decisions: ExtractedDecision[] = [];

      for (const llmDecision of result.object.decisions) {
        // Find the source claim
        const sourceClaim = findSourceClaim(llmDecision, decisionClaims);

        // Build owners list
        const owners: DecisionParticipant[] = [];
        if (llmDecision.decisionMakerEmail || llmDecision.decisionMakerName) {
          owners.push({
            email: llmDecision.decisionMakerEmail,
            name: llmDecision.decisionMakerName,
            isUser:
              llmDecision.decisionMakerEmail?.toLowerCase() ===
              context.userEmail.toLowerCase(),
            role: "decision_maker",
            confidence: 0.8,
          });
        }

        // Build participants list
        const participants: DecisionParticipant[] = [];
        if (llmDecision.participantEmails) {
          for (const email of llmDecision.participantEmails) {
            participants.push({
              email,
              isUser: email.toLowerCase() === context.userEmail.toLowerCase(),
              role: "participant",
              confidence: 0.7,
            });
          }
        }

        // Build alternatives list
        const alternatives: Alternative[] = [];
        if (llmDecision.alternatives) {
          for (const alt of llmDecision.alternatives) {
            alternatives.push({
              title: alt.title,
              description: alt.description,
              pros: alt.pros,
              cons: alt.cons,
              rejected: true,
              rejectionReason: alt.rejectionReason,
            });
          }
        }

        // Get source message IDs from claim evidence
        const sourceMessageIds =
          sourceClaim?.evidence.map((e) => e.messageId) || [];

        decisions.push({
          title: llmDecision.title,
          statement: llmDecision.statement,
          rationale: llmDecision.rationale,
          topic: llmDecision.topic,
          impactAreas: llmDecision.impactAreas,
          alternatives: alternatives.length > 0 ? alternatives : undefined,
          owners: owners.length > 0 ? owners : undefined,
          participants: participants.length > 0 ? participants : undefined,
          decidedAt: llmDecision.decidedAt,
          sourceClaimId: sourceClaim?.id || "",
          sourceThreadId: context.threadId,
          sourceMessageIds,
          confidence: llmDecision.confidence,
          isExplicit: llmDecision.isExplicit,
          isTentative: llmDecision.isTentative,
          requiresApproval: false,
          metadata: {
            reasoning: llmDecision.reasoning,
          },
        });
      }

      trace.generation({
        name: "extract-decisions",
        model: "claude-3-5-haiku",
        output: { count: decisions.length },
      });

      return decisions;
    } catch (error) {
      trace.generation({
        name: "extract-decisions-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      throw error;
    }
  }

  /**
   * Extract deeper rationale for a decision.
   */
  async extractRationale(
    decision: { title: string; statement: string },
    context: DecisionThreadContext
  ): Promise<{
    rationale: string;
    supportingEvidence: string[];
    confidence: number;
    isExplicit: boolean;
  }> {
    const trace = observability.trace({
      name: "rationale-extraction",
      metadata: {
        decisionTitle: decision.title,
        threadId: context.threadId,
      },
    });

    try {
      const threadContent = formatMessagesForDecision(context);
      const prompt = buildRationaleExtractionPrompt(decision, threadContent);

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: RationaleExtractionResponseSchema,
        prompt,
        temperature: 0.3,
      });

      trace.generation({
        name: "extract-rationale",
        model: "claude-3-5-haiku",
        output: { confidence: result.object.confidence },
      });

      return result.object;
    } catch (error) {
      trace.generation({
        name: "extract-rationale-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      return {
        rationale: "",
        supportingEvidence: [],
        confidence: 0,
        isExplicit: false,
      };
    }
  }

  /**
   * Detect if a new decision supersedes existing decisions.
   */
  async detectSupersession(
    newDecision: ExtractedDecision,
    existingDecisions: Array<{
      id: string;
      title: string;
      statement: string;
      topic?: string;
      decidedAt: Date;
    }>
  ): Promise<Supersession[]> {
    // Filter to decisions on similar topics
    const relevantDecisions = existingDecisions.filter((d) => {
      // Simple topic matching (could be enhanced with embeddings)
      if (newDecision.topic && d.topic) {
        return (
          d.topic.toLowerCase().includes(newDecision.topic.toLowerCase()) ||
          newDecision.topic.toLowerCase().includes(d.topic.toLowerCase())
        );
      }
      // Title similarity check
      const newWords = new Set(newDecision.title.toLowerCase().split(/\s+/));
      const existingWords = d.title.toLowerCase().split(/\s+/);
      const overlap = existingWords.filter((w) => newWords.has(w)).length;
      return overlap >= 2;
    });

    if (relevantDecisions.length === 0) {
      return [];
    }

    const trace = observability.trace({
      name: "supersession-detection",
      metadata: {
        newDecisionTitle: newDecision.title,
        existingCount: relevantDecisions.length,
      },
    });

    try {
      const prompt = buildSupersessionPrompt(
        {
          title: newDecision.title,
          statement: newDecision.statement,
          topic: newDecision.topic,
          decidedAt: newDecision.decidedAt,
        },
        relevantDecisions
      );

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: SupersessionDetectionResponseSchema,
        prompt,
        temperature: 0.2,
      });

      const supersessions: Supersession[] = [];

      for (const s of result.object.supersessions) {
        // Find the matching existing decision
        const oldDecision = relevantDecisions.find(
          (d) =>
            d.title.toLowerCase().includes(s.oldDecisionTitle.toLowerCase()) ||
            s.oldDecisionTitle.toLowerCase().includes(d.title.toLowerCase())
        );

        if (oldDecision && s.confidence > 0.5) {
          supersessions.push({
            supersededDecisionId: oldDecision.id,
            supersedingDecisionId: "", // Will be filled in by caller
            reason: s.reason,
            confidence: s.confidence,
            isReversal: s.isReversal,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      trace.generation({
        name: "detect-supersession",
        model: "claude-3-5-haiku",
        output: { count: supersessions.length },
      });

      return supersessions;
    } catch (error) {
      trace.generation({
        name: "detect-supersession-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return [];
    }
  }

  /**
   * Query decisions to answer questions like "What did we decide about X?"
   */
  async queryDecisions(
    query: string,
    decisions: Array<{
      id: string;
      title: string;
      statement: string;
      rationale?: string;
      decidedAt: Date;
    }>
  ): Promise<{
    relevantDecisions: DecisionSearchResult[];
    answer?: string;
  }> {
    if (decisions.length === 0) {
      return { relevantDecisions: [] };
    }

    const trace = observability.trace({
      name: "decision-query",
      metadata: {
        query,
        decisionCount: decisions.length,
      },
    });

    try {
      const prompt = buildDecisionQueryPrompt(query, decisions);

      const result = await generateObject({
        model: getModel("anthropic", "claude-3-5-haiku-20241022"),
        schema: DecisionQueryResponseSchema,
        prompt,
        temperature: 0.3,
      });

      const relevantDecisions: DecisionSearchResult[] = [];

      for (const r of result.object.relevantDecisions) {
        const decision = decisions.find(
          (d) =>
            d.title.toLowerCase() === r.title.toLowerCase() ||
            d.title.toLowerCase().includes(r.title.toLowerCase())
        );

        if (decision) {
          relevantDecisions.push({
            id: decision.id,
            title: decision.title,
            statement: decision.statement,
            rationale: decision.rationale,
            decidedAt: decision.decidedAt,
            relevanceScore: r.relevance,
            matchedTerms: r.keyPoints,
          });
        }
      }

      // Sort by relevance
      relevantDecisions.sort((a, b) => b.relevanceScore - a.relevanceScore);

      trace.generation({
        name: "query-decisions",
        model: "claude-3-5-haiku",
        output: { resultCount: relevantDecisions.length },
      });

      return {
        relevantDecisions,
        answer: result.object.answer,
      };
    } catch (error) {
      trace.generation({
        name: "query-decisions-error",
        model: "claude-3-5-haiku",
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });
      return { relevantDecisions: [] };
    }
  }

  /**
   * Get owner attribution for a decision.
   */
  identifyOwners(
    decision: ExtractedDecision,
    context: DecisionThreadContext
  ): DecisionParticipant[] {
    const owners: DecisionParticipant[] = [];

    // Use existing owners if available
    if (decision.owners && decision.owners.length > 0) {
      return decision.owners;
    }

    // Find the message where decision was made
    const decisionDate = new Date(decision.decidedAt);
    const sourceMessage = context.messages.find((m) => {
      if (!m.sentAt) return false;
      return Math.abs(m.sentAt.getTime() - decisionDate.getTime()) < 86_400_000; // Within 1 day
    });

    if (sourceMessage) {
      owners.push({
        email: sourceMessage.fromEmail,
        name: sourceMessage.fromName,
        isUser: sourceMessage.isFromUser,
        role: "decision_maker",
        confidence: 0.7,
      });
    }

    return owners;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Find the source claim for an extracted decision.
 */
function findSourceClaim(
  decision: { title: string; statement: string; reasoning: string },
  decisionClaims: DecisionClaimInput[]
): DecisionClaimInput | undefined {
  // Try to match by text similarity
  for (const claim of decisionClaims) {
    if (
      decision.statement
        .toLowerCase()
        .includes(claim.text.substring(0, 30).toLowerCase()) ||
      decision.reasoning
        .toLowerCase()
        .includes(claim.text.substring(0, 30).toLowerCase())
    ) {
      return claim;
    }
  }

  // Return first claim as fallback
  return decisionClaims[0];
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Create a new Decision Agent instance.
 */
export function createDecisionAgent(): DecisionAgent {
  return new DecisionAgent();
}

/**
 * Extract decisions from a thread (convenience function).
 */
export async function extractDecisions(
  context: DecisionThreadContext,
  decisionClaims: DecisionClaimInput[]
): Promise<ExtractedDecision[]> {
  const agent = new DecisionAgent();
  return await agent.extractDecisions(context, decisionClaims);
}
