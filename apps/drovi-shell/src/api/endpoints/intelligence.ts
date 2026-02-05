import { apiClient } from "../client";
import {
  AnalyzeResponseSchema,
  AskResponseSchema,
  BriefResponseSchema,
  SearchResponseSchema,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AskRequest,
  type AskResponse,
  type BriefResponse,
  type SearchRequest,
  type SearchResponse,
} from "../schemas";

// SSE event types for Ask streaming
export type AskStreamEvent =
  | { event: "truth"; data: { results: unknown[]; citations: unknown[] } }
  | { event: "reasoning_start"; data: Record<string, unknown> }
  | { event: "token"; data: { token: string } }
  | { event: "done"; data: { session_id?: string } }
  | { event: "error"; data: { message: string } };

export const intelligenceEndpoints = {
  /**
   * Analyze content and extract intelligence
   */
  async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
    return apiClient.requestWithSchema(
      "/api/v1/analyze",
      AnalyzeResponseSchema,
      {
        method: "POST",
        body: request,
      }
    );
  },

  /**
   * Stream analysis results
   */
  async *analyzeStream(
    request: AnalyzeRequest
  ): AsyncGenerator<{ event: string; data: unknown }> {
    yield* apiClient.stream("/api/v1/analyze/stream", {
      method: "POST",
      body: request,
    });
  },

  /**
   * Ask a question using GraphRAG (non-streaming)
   */
  async ask(request: AskRequest): Promise<AskResponse> {
    return apiClient.requestWithSchema("/api/v1/ask", AskResponseSchema, {
      method: "POST",
      body: request,
    });
  },

  /**
   * Stream ask response with 2-phase truth+reasoning protocol
   */
  async *askStream(request: AskRequest): AsyncGenerator<AskStreamEvent> {
    const stream = apiClient.stream("/api/v1/ask/stream", {
      method: "POST",
      body: { ...request, mode: "truth+reasoning" },
    });

    for await (const { event, data } of stream) {
      yield { event, data } as AskStreamEvent;
    }
  },

  /**
   * Get daily brief
   */
  async getBrief(
    organizationId: string,
    period: "today" | "last_7_days" = "last_7_days"
  ): Promise<BriefResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/brief?organization_id=${organizationId}&period=${period}`,
      BriefResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Hybrid search across knowledge graph
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    return apiClient.requestWithSchema("/api/v1/search", SearchResponseSchema, {
      method: "POST",
      body: request,
    });
  },
};
