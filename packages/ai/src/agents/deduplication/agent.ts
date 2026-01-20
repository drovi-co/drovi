// =============================================================================
// DEDUPLICATION AGENT
// =============================================================================
//
// Detects cross-source duplicates of commitments and decisions.
// Uses semantic similarity + party matching + temporal proximity.
//

import { generateObject } from "ai";
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { observability } from "../../observability";
import { getDefaultModel } from "../../providers";
import type {
  DeduplicationContext,
  DeduplicationResult,
  ExtractedCommitmentForDedup,
  LLMMatchAnalysis,
  MatchCandidate,
  ResolvedParties,
  SimilarUIO,
} from "./types";
import { LLMMatchAnalysisSchema } from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

const SEMANTIC_THRESHOLD = 0.7;
const PARTY_OVERLAP_THRESHOLD = 0.5;
const AUTO_MERGE_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.65;

// Scoring weights
const WEIGHTS = {
  semantic: 0.5,
  party: 0.3,
  temporal: 0.2,
};

// =============================================================================
// DEDUPLICATION AGENT
// =============================================================================

/**
 * Deduplication Agent
 *
 * Checks if newly extracted commitments/decisions are duplicates of existing
 * Unified Intelligence Objects across sources.
 */
export class DeduplicationAgent {
  private db: PgDatabase<unknown>;

  constructor(db: PgDatabase<unknown>) {
    this.db = db;
  }

  /**
   * Check if a newly extracted commitment is a duplicate of an existing UIO.
   */
  async checkForDuplicates(
    context: DeduplicationContext
  ): Promise<DeduplicationResult> {
    const trace = observability.trace({
      name: "deduplication-check",
      metadata: {
        organizationId: context.organizationId,
        sourceType: context.sourceType,
        title: context.newCommitment.title,
      },
    });

    try {
      // 1. Generate embedding for the new commitment
      const embedding = await this.generateCommitmentEmbedding(
        context.newCommitment
      );

      // 2. Search for semantically similar UIOs
      const similarUios = await this.searchSimilarUIOs(
        context.organizationId,
        embedding,
        { limit: 10, threshold: SEMANTIC_THRESHOLD }
      );

      if (similarUios.length === 0) {
        trace.generation({
          name: "no-duplicates-found",
          model: "deduplication",
          output: { action: "create_new" },
        });

        return {
          action: "create_new",
          confidence: 1.0,
          matchReasons: [],
          explanation: "No similar commitments found across sources",
        };
      }

      // 3. Resolve parties for the new commitment
      const resolvedParties = await this.resolveParties(
        context.newCommitment,
        context.organizationId
      );

      // 4. For each candidate, verify party match and calculate scores
      const candidates = await this.verifyAndScoreCandidates(
        context.newCommitment,
        resolvedParties,
        similarUios
      );

      // 5. Score and decide
      const result = await this.scoreAndDecide(
        candidates,
        context.newCommitment
      );

      trace.generation({
        name: "deduplication-result",
        model: "deduplication",
        output: {
          action: result.action,
          confidence: result.confidence,
          candidatesFound: candidates.length,
        },
      });

      return result;
    } catch (error) {
      console.error("[DeduplicationAgent] Error:", error);

      // On error, default to creating new (safe fallback)
      return {
        action: "create_new",
        confidence: 0.5,
        matchReasons: [],
        explanation: `Deduplication check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Generate an embedding for a commitment.
   */
  private async generateCommitmentEmbedding(
    commitment: ExtractedCommitmentForDedup
  ): Promise<number[]> {
    // Build text representation of commitment
    const text = this.buildCommitmentText(commitment);

    // Use existing embedding generation
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
    return data.data[0]?.embedding ?? [];
  }

  /**
   * Build text representation of a commitment for embedding.
   */
  private buildCommitmentText(commitment: ExtractedCommitmentForDedup): string {
    const parts = [`[COMMITMENT] ${commitment.title}`];

    if (commitment.description) {
      parts.push(commitment.description);
    }

    if (commitment.dueDate) {
      parts.push(`Due: ${commitment.dueDate.toISOString().split("T")[0]}`);
    }

    if (commitment.debtorName || commitment.debtorEmail) {
      parts.push(`From: ${commitment.debtorName || commitment.debtorEmail}`);
    }

    if (commitment.creditorName || commitment.creditorEmail) {
      parts.push(`To: ${commitment.creditorName || commitment.creditorEmail}`);
    }

    return parts.join(" | ");
  }

  /**
   * Search for semantically similar UIOs using vector similarity.
   */
  private async searchSimilarUIOs(
    organizationId: string,
    queryEmbedding: number[],
    options: { limit?: number; threshold?: number } = {}
  ): Promise<SimilarUIO[]> {
    const { limit = 10, threshold = 0.7 } = options;
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const results = await this.db.execute<{
      id: string;
      canonical_title: string;
      canonical_description: string | null;
      due_date: Date | null;
      owner_contact_id: string | null;
      participant_contact_ids: string[];
      first_seen_at: Date;
      last_updated_at: Date;
      similarity: number;
    }>(sql`
      SELECT
        uio.id,
        uio.canonical_title,
        uio.canonical_description,
        uio.due_date,
        uio.owner_contact_id,
        uio.participant_contact_ids,
        uio.first_seen_at,
        uio.last_updated_at,
        1 - (uoe.embedding <=> ${sql.raw(`'${vectorStr}'::vector`)}) as similarity
      FROM unified_object_embedding uoe
      JOIN unified_intelligence_object uio ON uio.id = uoe.unified_object_id
      WHERE uio.organization_id = ${organizationId}
        AND uio.status = 'active'
        AND uio.type = 'commitment'
        AND 1 - (uoe.embedding <=> ${sql.raw(`'${vectorStr}'::vector`)}) > ${threshold}
      ORDER BY uoe.embedding <=> ${sql.raw(`'${vectorStr}'::vector`)}
      LIMIT ${limit}
    `);

    return results.rows.map((row) => ({
      id: row.id,
      canonicalTitle: row.canonical_title,
      canonicalDescription: row.canonical_description,
      dueDate: row.due_date,
      ownerContactId: row.owner_contact_id,
      participantContactIds: row.participant_contact_ids || [],
      firstSeenAt: row.first_seen_at,
      lastUpdatedAt: row.last_updated_at,
      similarity: row.similarity,
    }));
  }

  /**
   * Resolve commitment parties to contact IDs.
   */
  private async resolveParties(
    commitment: ExtractedCommitmentForDedup,
    organizationId: string
  ): Promise<ResolvedParties> {
    const participantContactIds: string[] = [];

    // If we already have contact IDs, use them
    if (commitment.debtorContactId) {
      participantContactIds.push(commitment.debtorContactId);
    }
    if (commitment.creditorContactId) {
      participantContactIds.push(commitment.creditorContactId);
    }

    // If we have emails, try to resolve them to contacts
    const emails = [commitment.debtorEmail, commitment.creditorEmail].filter(
      Boolean
    ) as string[];

    if (emails.length > 0) {
      const contacts = await this.db.execute<{
        id: string;
        primary_email: string;
      }>(
        sql`
          SELECT id, primary_email FROM contact
          WHERE organization_id = ${organizationId}
            AND primary_email = ANY(${emails})
        `
      );

      for (const contact of contacts.rows) {
        if (!participantContactIds.includes(contact.id)) {
          participantContactIds.push(contact.id);
        }
      }
    }

    return {
      debtorContactId: commitment.debtorContactId,
      creditorContactId: commitment.creditorContactId,
      participantContactIds,
    };
  }

  /**
   * Verify party match and calculate scores for candidates.
   */
  private async verifyAndScoreCandidates(
    commitment: ExtractedCommitmentForDedup,
    resolvedParties: ResolvedParties,
    candidates: SimilarUIO[]
  ): Promise<MatchCandidate[]> {
    const results: MatchCandidate[] = [];

    for (const candidate of candidates) {
      // Calculate party overlap
      const partyOverlap = this.calculatePartyOverlap(
        resolvedParties.participantContactIds,
        candidate.participantContactIds
      );

      // Only include if party overlap meets threshold OR semantic similarity is very high
      if (
        partyOverlap >= PARTY_OVERLAP_THRESHOLD ||
        candidate.similarity >= 0.9
      ) {
        // Calculate temporal score
        const temporalScore = this.calculateTemporalScore(
          commitment.dueDate,
          candidate.dueDate
        );

        results.push({
          uioId: candidate.id,
          canonicalTitle: candidate.canonicalTitle,
          canonicalDescription: candidate.canonicalDescription,
          dueDate: candidate.dueDate,
          ownerContactId: candidate.ownerContactId,
          participantContactIds: candidate.participantContactIds,
          firstSeenAt: candidate.firstSeenAt,
          lastUpdatedAt: candidate.lastUpdatedAt,
          semanticSimilarity: candidate.similarity,
          partyMatchScore: partyOverlap,
          temporalScore,
        });
      }
    }

    return results;
  }

  /**
   * Calculate party overlap between two sets of contact IDs.
   */
  private calculatePartyOverlap(partyA: string[], partyB: string[]): number {
    if (partyA.length === 0 && partyB.length === 0) {
      return 0;
    }

    const setA = new Set(partyA);
    const setB = new Set(partyB);
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    // Jaccard similarity
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Calculate temporal score based on due date proximity.
   */
  private calculateTemporalScore(
    dateA: Date | null | undefined,
    dateB: Date | null | undefined
  ): number {
    if (!(dateA && dateB)) {
      // If either has no due date, neutral score
      return 0.5;
    }

    const daysDiff = Math.abs(
      (dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Score: 1.0 if same day, decreasing to 0.1 at 30+ days difference
    if (daysDiff <= 1) return 1.0;
    if (daysDiff <= 7) return 0.8;
    if (daysDiff <= 14) return 0.6;
    if (daysDiff <= 30) return 0.4;
    return 0.1;
  }

  /**
   * Score candidates and decide action.
   */
  private async scoreAndDecide(
    candidates: MatchCandidate[],
    commitment: ExtractedCommitmentForDedup
  ): Promise<DeduplicationResult> {
    if (candidates.length === 0) {
      return {
        action: "create_new",
        confidence: 1.0,
        matchReasons: [],
        explanation: "No candidates passed party verification",
      };
    }

    // Calculate overall scores
    const scoredCandidates = candidates.map((c) => ({
      ...c,
      overallScore:
        c.semanticSimilarity * WEIGHTS.semantic +
        (c.partyMatchScore || 0) * WEIGHTS.party +
        (c.temporalScore || 0.5) * WEIGHTS.temporal,
    }));

    // Sort by overall score
    scoredCandidates.sort(
      (a, b) => (b.overallScore || 0) - (a.overallScore || 0)
    );
    const topCandidate = scoredCandidates[0];

    if (!topCandidate) {
      return {
        action: "create_new",
        confidence: 1.0,
        matchReasons: [],
        explanation: "No candidates found",
      };
    }

    const overallScore = topCandidate.overallScore || 0;

    // Build match reasons
    const matchReasons = this.buildMatchReasons(topCandidate);

    if (overallScore >= AUTO_MERGE_THRESHOLD) {
      // High confidence - use LLM to double-check
      const llmAnalysis = await this.llmVerifyMatch(commitment, topCandidate);

      if (llmAnalysis.isLikelyDuplicate && llmAnalysis.confidence >= 0.8) {
        return {
          action: "merge_into",
          targetUioId: topCandidate.uioId,
          confidence: overallScore,
          matchReasons: [...matchReasons, ...llmAnalysis.matchingElements],
          explanation: `High confidence match (${(overallScore * 100).toFixed(0)}%). ${llmAnalysis.reasoning}`,
          scores: {
            semanticSimilarity: topCandidate.semanticSimilarity,
            partyMatchScore: topCandidate.partyMatchScore,
            temporalScore: topCandidate.temporalScore,
            overallScore,
          },
        };
      }

      // LLM disagreed, send to review
      return {
        action: "pending_review",
        targetUioId: topCandidate.uioId,
        confidence: overallScore * 0.8, // Reduce confidence
        matchReasons,
        explanation: `Score suggests match but LLM uncertain. ${llmAnalysis.reasoning}`,
        scores: {
          semanticSimilarity: topCandidate.semanticSimilarity,
          partyMatchScore: topCandidate.partyMatchScore,
          temporalScore: topCandidate.temporalScore,
          overallScore,
        },
      };
    }

    if (overallScore >= REVIEW_THRESHOLD) {
      // Medium confidence - needs human review
      return {
        action: "pending_review",
        targetUioId: topCandidate.uioId,
        confidence: overallScore,
        matchReasons,
        explanation: `Potential duplicate requiring review (${(overallScore * 100).toFixed(0)}%)`,
        scores: {
          semanticSimilarity: topCandidate.semanticSimilarity,
          partyMatchScore: topCandidate.partyMatchScore,
          temporalScore: topCandidate.temporalScore,
          overallScore,
        },
      };
    }

    // Low confidence - create new
    return {
      action: "create_new",
      confidence: 1 - overallScore,
      matchReasons: [],
      explanation: "No confident matches found",
    };
  }

  /**
   * Build human-readable match reasons.
   */
  private buildMatchReasons(candidate: MatchCandidate): string[] {
    const reasons: string[] = [];

    if (candidate.semanticSimilarity >= 0.9) {
      reasons.push(
        `Very similar content (${(candidate.semanticSimilarity * 100).toFixed(0)}%)`
      );
    } else if (candidate.semanticSimilarity >= 0.8) {
      reasons.push(
        `Similar content (${(candidate.semanticSimilarity * 100).toFixed(0)}%)`
      );
    }

    if (candidate.partyMatchScore && candidate.partyMatchScore >= 0.8) {
      reasons.push("Same parties involved");
    } else if (candidate.partyMatchScore && candidate.partyMatchScore >= 0.5) {
      reasons.push("Overlapping parties");
    }

    if (candidate.temporalScore && candidate.temporalScore >= 0.8) {
      reasons.push("Similar due dates");
    }

    return reasons;
  }

  /**
   * Use LLM to verify a potential match.
   */
  private async llmVerifyMatch(
    newCommitment: ExtractedCommitmentForDedup,
    candidate: MatchCandidate
  ): Promise<LLMMatchAnalysis> {
    try {
      const prompt = this.buildLLMVerificationPrompt(newCommitment, candidate);

      const result = await generateObject({
        model: getDefaultModel(),
        schema: LLMMatchAnalysisSchema,
        prompt,
        temperature: 0.1,
      });

      return result.object;
    } catch {
      // On error, return uncertain
      return {
        isLikelyDuplicate: false,
        confidence: 0.5,
        reasoning: "LLM verification failed",
        matchingElements: [],
        differingElements: [],
      };
    }
  }

  /**
   * Build prompt for LLM verification.
   */
  private buildLLMVerificationPrompt(
    newCommitment: ExtractedCommitmentForDedup,
    candidate: MatchCandidate
  ): string {
    return `You are verifying if two commitments refer to the same underlying promise or task.

NEW COMMITMENT (from recent message):
- Title: ${newCommitment.title}
- Description: ${newCommitment.description || "N/A"}
- Due Date: ${newCommitment.dueDate?.toISOString().split("T")[0] || "Not specified"}
- From: ${newCommitment.debtorName || newCommitment.debtorEmail || "Unknown"}
- To: ${newCommitment.creditorName || newCommitment.creditorEmail || "Unknown"}
${newCommitment.sourceQuote ? `- Quote: "${newCommitment.sourceQuote}"` : ""}

EXISTING COMMITMENT (already tracked):
- Title: ${candidate.canonicalTitle}
- Description: ${candidate.canonicalDescription || "N/A"}
- Due Date: ${candidate.dueDate?.toISOString().split("T")[0] || "Not specified"}
- First seen: ${candidate.firstSeenAt.toISOString().split("T")[0]}
- Last updated: ${candidate.lastUpdatedAt.toISOString().split("T")[0]}

Determine if these refer to the SAME commitment (just mentioned in different sources/messages) or DIFFERENT commitments.

Consider:
1. Are they about the same deliverable/action?
2. Do the parties match?
3. Are the due dates compatible?
4. Could the new message be an update/confirmation of the existing commitment?

Return your analysis.`;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a new DeduplicationAgent instance.
 */
export function createDeduplicationAgent(
  db: PgDatabase<unknown>
): DeduplicationAgent {
  return new DeduplicationAgent(db);
}
