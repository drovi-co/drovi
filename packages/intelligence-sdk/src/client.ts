// =============================================================================
// INTELLIGENCE CLIENT
// =============================================================================
//
// Main client class for interacting with the Drovi Intelligence Platform API.
//

import { EventStream, type AnalysisStreamOptions, createAnalysisStream } from "./stream";
import type {
  AnalysisResult,
  AnalyzeInput,
  ErrorResponse,
  EventStreamOptions,
  GraphQueryInput,
  GraphQueryResult,
  IntelligenceClientConfig,
  IntelligenceStats,
  ItemResponse,
  PaginatedResponse,
  UIODetail,
  UIOFilters,
  UIOListItem,
  Webhook,
  WebhookInput,
} from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_BASE_URL = "https://api.drovi.io";
const DEFAULT_TIMEOUT = 30000;

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Base error class for SDK errors.
 */
export class IntelligenceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "IntelligenceError";
  }
}

/**
 * Error thrown when authentication fails.
 */
export class AuthenticationError extends IntelligenceError {
  constructor(message: string) {
    super(message, "UNAUTHORIZED", 401);
    this.name = "AuthenticationError";
  }
}

/**
 * Error thrown when the requested resource is not found.
 */
export class NotFoundError extends IntelligenceError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

/**
 * Error thrown when the request is invalid.
 */
export class ValidationError extends IntelligenceError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

/**
 * Error thrown when rate limited.
 */
export class RateLimitError extends IntelligenceError {
  constructor(message: string, public readonly retryAfter?: number) {
    super(message, "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}

// =============================================================================
// CLIENT CLASS
// =============================================================================

/**
 * Client for the Drovi Intelligence Platform API.
 *
 * @example
 * ```typescript
 * import { IntelligenceClient } from '@memorystack/intelligence-sdk';
 *
 * const client = new IntelligenceClient({
 *   apiKey: 'your-api-key',
 * });
 *
 * // Analyze content
 * const result = await client.analyze({
 *   content: 'I will send the report by Friday',
 *   sourceType: 'email',
 * });
 *
 * // List UIOs
 * const uios = await client.listUIOs({ type: 'commitment' });
 *
 * // Subscribe to events
 * const stream = client.subscribe({
 *   onEvent: (event) => console.log('Event:', event),
 * });
 * stream.connect();
 * ```
 */
export class IntelligenceClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly customFetch: typeof fetch;
  private readonly customHeaders: Record<string, string>;

  constructor(config: IntelligenceClientConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.customFetch = config.fetch ?? fetch;
    this.customHeaders = config.headers ?? {};
  }

  // ===========================================================================
  // ANALYSIS
  // ===========================================================================

  /**
   * Analyze content and extract intelligence.
   *
   * @param input - Analysis input
   * @returns Analysis result with extracted UIOs and tasks
   */
  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    return this.post<AnalysisResult>("/api/v1/intelligence/analyze", input);
  }

  /**
   * Analyze content with streaming progress updates.
   *
   * @param input - Analysis input
   * @param options - Stream options for callbacks
   * @returns Async generator yielding stream events
   */
  async *analyzeStream(
    input: AnalyzeInput,
    options: AnalysisStreamOptions = {}
  ): AsyncGenerator<{
    type: string;
    analysisId?: string;
    node?: string;
    results?: unknown;
    error?: string;
  }> {
    const response = await this.request("/api/v1/intelligence/analyze/stream", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
    });

    yield* createAnalysisStream(response, options);
  }

  // ===========================================================================
  // UIOs
  // ===========================================================================

  /**
   * List UIOs with optional filters.
   *
   * @param filters - Optional filters for the list
   * @returns Paginated list of UIOs
   */
  async listUIOs(
    filters?: UIOFilters
  ): Promise<PaginatedResponse<UIOListItem>> {
    const params = new URLSearchParams();

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined) {
          params.set(key, String(value));
        }
      }
    }

    const query = params.toString();
    const url = `/api/v1/intelligence/uios${query ? `?${query}` : ""}`;

    return this.get<PaginatedResponse<UIOListItem>>(url);
  }

  /**
   * Get a single UIO by ID.
   *
   * @param id - UIO ID
   * @returns UIO detail with sources and timeline
   */
  async getUIO(id: string): Promise<ItemResponse<UIODetail>> {
    return this.get<ItemResponse<UIODetail>>(
      `/api/v1/intelligence/uios/${encodeURIComponent(id)}`
    );
  }

  /**
   * Iterate over all UIOs matching the filters.
   * Automatically handles pagination.
   *
   * @param filters - Optional filters
   * @yields UIOs one at a time
   */
  async *iterateUIOs(filters?: Omit<UIOFilters, "cursor">): AsyncGenerator<UIOListItem> {
    let cursor: string | undefined;

    do {
      const response = await this.listUIOs({ ...filters, cursor });

      for (const uio of response.data) {
        yield uio;
      }

      cursor = response.pagination.nextCursor ?? undefined;
    } while (cursor);
  }

  // ===========================================================================
  // GRAPH
  // ===========================================================================

  /**
   * Execute a Cypher query on the knowledge graph.
   * Only read queries are allowed.
   *
   * @param input - Query input
   * @returns Query result
   */
  async graphQuery<T = unknown>(
    input: GraphQueryInput
  ): Promise<GraphQueryResult<T>> {
    return this.post<GraphQueryResult<T>>(
      "/api/v1/intelligence/graph/query",
      input
    );
  }

  // ===========================================================================
  // WEBHOOKS
  // ===========================================================================

  /**
   * Register a new webhook.
   *
   * @param input - Webhook configuration
   * @returns Created webhook
   */
  async createWebhook(input: WebhookInput): Promise<Webhook> {
    return this.post<Webhook>("/api/v1/intelligence/webhooks", input);
  }

  /**
   * List registered webhooks.
   *
   * @returns Paginated list of webhooks
   */
  async listWebhooks(): Promise<PaginatedResponse<Webhook>> {
    return this.get<PaginatedResponse<Webhook>>(
      "/api/v1/intelligence/webhooks"
    );
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  /**
   * Create an event stream subscription.
   * Call `.connect()` on the returned stream to start receiving events.
   *
   * @param options - Stream options
   * @returns Event stream instance
   */
  subscribe(options?: EventStreamOptions): EventStream {
    // Note: For browser environments, the API key needs to be handled differently
    // since EventSource doesn't support custom headers.
    // Consider using a session token or including the key in the URL.
    const streamUrl = `${this.baseUrl}/api/v1/intelligence/events/stream`;
    return new EventStream(streamUrl, options);
  }

  // ===========================================================================
  // STATS
  // ===========================================================================

  /**
   * Get intelligence statistics for the organization.
   *
   * @returns Statistics summary
   */
  async getStats(): Promise<IntelligenceStats> {
    return this.get<IntelligenceStats>("/api/v1/intelligence/stats");
  }

  // ===========================================================================
  // HTTP HELPERS
  // ===========================================================================

  /**
   * Make a GET request.
   */
  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: "GET" });
    return response.json() as Promise<T>;
  }

  /**
   * Make a POST request.
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.json() as Promise<T>;
  }

  /**
   * Make an HTTP request.
   */
  private async request(
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.customFetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.customHeaders,
          ...(init.headers ?? {}),
        },
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      if (error instanceof IntelligenceError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new IntelligenceError(
          "Request timeout",
          "TIMEOUT",
          undefined,
          undefined
        );
      }

      throw new IntelligenceError(
        error instanceof Error ? error.message : "Request failed",
        "REQUEST_FAILED",
        undefined,
        error
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle error responses from the API.
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ErrorResponse | undefined;

    try {
      const json = await response.json();
      errorData = json as ErrorResponse;
    } catch {
      // Ignore JSON parse errors
    }

    const message = errorData?.message ?? `HTTP ${response.status}`;

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      case 400:
        throw new ValidationError(message, errorData?.details);
      case 429: {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(
          message,
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined
        );
      }
      default:
        throw new IntelligenceError(
          message,
          errorData?.error ?? "UNKNOWN_ERROR",
          response.status,
          errorData?.details
        );
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new Intelligence client.
 *
 * @param config - Client configuration
 * @returns Intelligence client instance
 */
export function createClient(
  config: IntelligenceClientConfig
): IntelligenceClient {
  return new IntelligenceClient(config);
}
