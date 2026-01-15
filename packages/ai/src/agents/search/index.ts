// =============================================================================
// SEARCH AGENT (Agent 5)
// =============================================================================
//
// Semantic search and question answering over email content.
// Combines vector similarity with LLM-powered answer generation.
//

import { generateText } from "ai";
import {
  cosineSimilarity,
  generateQueryEmbedding,
} from "../../embeddings/generator.js";
import { observability } from "../../observability.js";
import {
  buildAnswerGenerationSystemPrompt,
  buildAnswerGenerationUserPrompt,
  buildNoAnswerPrompt,
  buildQueryUnderstandingSystemPrompt,
  buildQueryUnderstandingUserPrompt,
  type EvidenceItem,
  type GeneratedAnswer,
  GeneratedAnswerSchema,
  type ParsedQuery,
  ParsedQuerySchema,
} from "../../prompts/search/index.js";
import {
  type AIProvider,
  getDefaultModel,
  getModel,
  isReasoningModel,
} from "../../providers/index.js";

// =============================================================================
// TYPES
// =============================================================================

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  types?: Array<"message" | "thread" | "claim">;
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  accountId?: string;
}

export interface SearchResult {
  id: string;
  type: "message" | "thread" | "claim";
  content: string;
  score: number;
  metadata: {
    threadId?: string;
    threadSubject?: string;
    messageDate?: Date;
    sender?: string;
    claimType?: string;
    confidence?: number;
  };
}

export interface AnswerResult {
  answer: string;
  citations: Array<{
    id: string;
    evidenceId: string;
    text: string;
    startIndex: number;
    endIndex: number;
  }>;
  confidence: number;
  sources: SearchResult[];
  followUpQuestions?: string[];
  caveats?: string[];
}

export interface SearchAgentConfig {
  provider?: AIProvider;
  model?: string;
  embeddingModel?: string;
  temperature?: number;
  maxTokens?: number;
}

// =============================================================================
// SEARCH AGENT CLASS
// =============================================================================

/**
 * Search Agent for semantic search and question answering.
 */
export class SearchAgent {
  private readonly config: SearchAgentConfig;

  constructor(config: SearchAgentConfig = {}) {
    this.config = {
      temperature: 0.3,
      maxTokens: 2048,
      ...config,
    };
  }

  /**
   * Get the model name being used (for checking if it's a reasoning model).
   */
  private getModelName(): string {
    return this.config.model ?? "gpt-5.2";
  }

  /**
   * Parse a natural language query into structured format.
   */
  async parseQuery(query: string): Promise<ParsedQuery> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "search:parse-query",
      metadata: { query },
    });

    try {
      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: buildQueryUnderstandingSystemPrompt() },
          { role: "user", content: buildQueryUnderstandingUserPrompt(query) },
        ],
        // Reasoning models don't support temperature
        ...(isReasoningModel(this.getModelName()) ? {} : { temperature: 0.2 }),
        maxTokens: 1024,
      });

      const parsed = JSON.parse(text);
      const validated = ParsedQuerySchema.parse(parsed);

      trace.generation({
        name: "parse-query",
        input: query,
        output: validated,
      });

      return validated;
    } catch (error) {
      trace.generation({
        name: "parse-query-error",
        input: query,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Return a basic parsed query on error
      return {
        intent: "search",
        originalQuery: query,
        entities: {
          people: [],
          companies: [],
          topics: [],
          products: [],
          dates: [],
          amounts: [],
        },
        filters: {
          fromEmails: [],
          toEmails: [],
          threadTypes: [],
          claimTypes: [],
        },
        searchTerms: [query],
        confidence: 0.5,
      };
    }
  }

  /**
   * Generate embedding for a query.
   */
  async embedQuery(query: string): Promise<number[]> {
    const result = await generateQueryEmbedding(query);
    return result.embedding;
  }

  /**
   * Perform similarity search against provided embeddings.
   * This is a pure function that takes embeddings as input.
   * Database queries should be done by the caller.
   */
  rankBySimiliarity(
    queryEmbedding: number[],
    candidates: Array<{
      id: string;
      embedding: number[];
      metadata: Record<string, unknown>;
    }>,
    options: { limit?: number; threshold?: number } = {}
  ): Array<{ id: string; score: number; metadata: Record<string, unknown> }> {
    const { limit = 20, threshold = 0.5 } = options;

    const scored = candidates
      .map((candidate) => ({
        id: candidate.id,
        score: cosineSimilarity(queryEmbedding, candidate.embedding),
        metadata: candidate.metadata,
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored;
  }

  /**
   * Combine vector similarity scores with keyword match scores.
   * Implements hybrid search scoring.
   */
  hybridScore(
    vectorResults: Array<{ id: string; score: number }>,
    keywordResults: Array<{ id: string; score: number }>,
    options: { vectorWeight?: number; keywordWeight?: number } = {}
  ): Array<{ id: string; score: number }> {
    const { vectorWeight = 0.7, keywordWeight = 0.3 } = options;

    // Normalize scores to 0-1 range
    const maxVector = Math.max(...vectorResults.map((r) => r.score), 0.001);
    const maxKeyword = Math.max(...keywordResults.map((r) => r.score), 0.001);

    const normalizedVector = new Map(
      vectorResults.map((r) => [r.id, r.score / maxVector])
    );
    const normalizedKeyword = new Map(
      keywordResults.map((r) => [r.id, r.score / maxKeyword])
    );

    // Combine scores
    const allIds = new Set([
      ...vectorResults.map((r) => r.id),
      ...keywordResults.map((r) => r.id),
    ]);

    const combined = Array.from(allIds).map((id) => ({
      id,
      score:
        (normalizedVector.get(id) ?? 0) * vectorWeight +
        (normalizedKeyword.get(id) ?? 0) * keywordWeight,
    }));

    return combined.sort((a, b) => b.score - a.score);
  }

  /**
   * Generate an answer from search results.
   */
  async generateAnswer(
    query: string,
    evidence: EvidenceItem[]
  ): Promise<GeneratedAnswer> {
    const model = this.config.provider
      ? getModel(this.config.provider, this.config.model)
      : getDefaultModel();

    const trace = observability.trace({
      name: "search:generate-answer",
      metadata: { query, evidenceCount: evidence.length },
    });

    try {
      // Handle no evidence case
      if (evidence.length === 0) {
        const { text } = await generateText({
          model,
          messages: [
            { role: "system", content: buildAnswerGenerationSystemPrompt() },
            { role: "user", content: buildNoAnswerPrompt(query) },
          ],
          // Reasoning models don't support temperature
          ...(isReasoningModel(this.getModelName()) ? {} : { temperature: 0.3 }),
          maxTokens: 1024,
        });

        const parsed = JSON.parse(text);
        return GeneratedAnswerSchema.parse(parsed);
      }

      // Generate answer with evidence
      const { text } = await generateText({
        model,
        messages: [
          { role: "system", content: buildAnswerGenerationSystemPrompt() },
          {
            role: "user",
            content: buildAnswerGenerationUserPrompt(query, evidence),
          },
        ],
        // Reasoning models don't support temperature
        ...(isReasoningModel(this.getModelName()) ? {} : { temperature: this.config.temperature ?? 0.3 }),
        maxTokens: this.config.maxTokens ?? 2048,
      });

      const parsed = JSON.parse(text);
      const validated = GeneratedAnswerSchema.parse(parsed);

      trace.generation({
        name: "generate-answer",
        input: { query, evidenceCount: evidence.length },
        output: validated,
      });

      return validated;
    } catch (error) {
      trace.generation({
        name: "generate-answer-error",
        input: { query, evidenceCount: evidence.length },
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      // Return error response
      return {
        answer:
          "I encountered an error while generating the answer. Please try again.",
        citations: [],
        confidence: 0,
        caveats: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  /**
   * Full search and answer pipeline.
   * Note: Database operations should be passed in as callbacks.
   */
  async searchAndAnswer(
    query: string,
    retrieveEvidence: (
      parsedQuery: ParsedQuery,
      queryEmbedding: number[]
    ) => Promise<EvidenceItem[]>
  ): Promise<AnswerResult> {
    const trace = observability.trace({
      name: "search:search-and-answer",
      metadata: { query },
    });

    try {
      // Parse query
      const parsedQuery = await this.parseQuery(query);

      // Generate embedding
      const queryEmbedding = await this.embedQuery(
        parsedQuery.rewrittenQuery ?? query
      );

      // Retrieve evidence (caller provides DB access)
      const evidence = await retrieveEvidence(parsedQuery, queryEmbedding);

      // Generate answer
      const answer = await this.generateAnswer(query, evidence);

      // Build full result
      const result: AnswerResult = {
        answer: answer.answer,
        citations: answer.citations,
        confidence: answer.confidence,
        sources: evidence.map((e) => ({
          id: e.id,
          type: e.type,
          content: e.content,
          score: e.relevanceScore,
          metadata: {
            threadId: e.metadata.threadId,
            threadSubject: e.metadata.threadSubject,
            messageDate: e.metadata.messageDate,
            sender: e.metadata.sender,
            claimType: e.metadata.claimType,
            confidence: e.metadata.confidence,
          },
        })),
        followUpQuestions: answer.followUpQuestions,
        caveats: answer.caveats,
      };

      trace.generation({
        name: "search-and-answer",
        input: query,
        output: {
          confidence: result.confidence,
          sourceCount: result.sources.length,
        },
      });

      return result;
    } catch (error) {
      trace.generation({
        name: "search-and-answer-error",
        input: query,
        output: error instanceof Error ? error.message : "Unknown error",
        level: "ERROR",
      });

      throw error;
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a new SearchAgent instance.
 */
export function createSearchAgent(config?: SearchAgentConfig): SearchAgent {
  return new SearchAgent(config);
}

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  EvidenceItem,
  GeneratedAnswer,
  ParsedQuery,
} from "../../prompts/search/index.js";

export {
  GeneratedAnswerSchema,
  ParsedQuerySchema,
  type QueryIntent,
  QueryIntentSchema,
} from "../../prompts/search/index.js";
