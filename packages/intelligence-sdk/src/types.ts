// =============================================================================
// INTELLIGENCE SDK TYPES
// =============================================================================
//
// TypeScript types for the Drovi Intelligence Platform SDK.
//

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * SDK configuration options.
 */
export interface IntelligenceClientConfig {
  /** API key for authentication (required) */
  apiKey: string;
  /** Base URL for the API (defaults to production) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Custom fetch implementation for advanced use cases */
  fetch?: typeof fetch;
  /** Custom headers to include with every request */
  headers?: Record<string, string>;
}

// =============================================================================
// COMMON TYPES
// =============================================================================

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  _links: {
    self: string;
    next: string | null;
  };
}

/**
 * Single item response wrapper.
 */
export interface ItemResponse<T> {
  data: T;
  _links: {
    self: string;
    [key: string]: string | null;
  };
}

/**
 * Error response from the API.
 */
export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

// =============================================================================
// UIO (UNIFIED INTELLIGENCE OBJECT) TYPES
// =============================================================================

/**
 * UIO type enum.
 */
export type UIOType = "commitment" | "decision" | "topic" | "project";

/**
 * UIO status enum.
 */
export type UIOStatus = "active" | "merged" | "archived" | "dismissed";

/**
 * Source role in contributing to a UIO.
 */
export type SourceRole =
  | "origin"
  | "update"
  | "confirmation"
  | "context"
  | "supersession";

/**
 * Source type.
 */
export type SourceType =
  | "email"
  | "slack"
  | "notion"
  | "google_docs"
  | "calendar"
  | "whatsapp";

/**
 * Timeline event type.
 */
export type TimelineEventType =
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

/**
 * UIO source reference.
 */
export interface UIOSource {
  id: string;
  sourceType: SourceType;
  role: SourceRole;
  confidence: number;
  quotedText: string | null;
  extractedTitle: string | null;
  extractedDueDate: string | null;
  sourceTimestamp: string | null;
  createdAt: string;
}

/**
 * UIO timeline event.
 */
export interface UIOTimelineEvent {
  id: string;
  eventType: TimelineEventType;
  eventDescription: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  sourceType: SourceType | null;
  sourceName: string | null;
  eventAt: string;
}

/**
 * UIO owner contact.
 */
export interface UIOOwner {
  id: string;
  displayName: string | null;
  emails: string[] | null;
}

/**
 * Related task summary.
 */
export interface RelatedTask {
  id: string;
  title: string;
  status: string;
  priority: string | null;
}

/**
 * UIO list item (summary).
 */
export interface UIOListItem {
  id: string;
  type: UIOType;
  status: UIOStatus;
  canonicalTitle: string;
  canonicalDescription: string | null;
  overallConfidence: number;
  dueDate: string | null;
  ownerContactId: string | null;
  sourceCount: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  _links: {
    self: string;
  };
}

/**
 * UIO full detail.
 */
export interface UIODetail extends Omit<UIOListItem, "sourceCount"> {
  dueDateConfidence: number | null;
  owner: UIOOwner | null;
  participantContactIds: string[] | null;
  isUserVerified: boolean | null;
  isUserDismissed: boolean | null;
  userCorrectedTitle: string | null;
  mergedIntoId: string | null;
  sources: UIOSource[];
  timeline: UIOTimelineEvent[];
  relatedTasks: RelatedTask[];
  organizationId: string;
}

/**
 * Filters for listing UIOs.
 */
export interface UIOFilters {
  /** Filter by UIO type */
  type?: UIOType;
  /** Filter by status */
  status?: UIOStatus;
  /** Filter by owner contact ID */
  ownerContactId?: string;
  /** Filter UIOs created after this date (ISO 8601) */
  since?: string;
  /** Filter UIOs created before this date (ISO 8601) */
  until?: string;
  /** Minimum confidence score (0-1) */
  minConfidence?: number;
  /** Search term for title/description */
  search?: string;
  /** Number of results per page (1-100, default: 20) */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
}

// =============================================================================
// ANALYSIS TYPES
// =============================================================================

/**
 * Analysis request options.
 */
export interface AnalyzeOptions {
  /** Extract commitments from content (default: true) */
  extractCommitments?: boolean;
  /** Extract decisions from content (default: true) */
  extractDecisions?: boolean;
  /** Detect topics in content (default: true) */
  detectTopics?: boolean;
  /** Analyze for risks (default: false) */
  analyzeRisk?: boolean;
  /** Return evidence citations (default: true) */
  returnEvidence?: boolean;
}

/**
 * Analysis request input.
 */
export interface AnalyzeInput {
  /** Content to analyze */
  content: string;
  /** Source type */
  sourceType: "email" | "slack" | "document" | "calendar" | "raw";
  /** Optional source identifier */
  sourceId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Analysis options */
  options?: AnalyzeOptions;
}

/**
 * Analysis result.
 */
export interface AnalysisResult {
  analysisId: string;
  status: "pending" | "processing" | "completed" | "failed";
  organizationId: string | null;
  input: {
    sourceType: string;
    sourceId?: string;
    contentLength: number;
    options: AnalyzeOptions;
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  results: {
    uios: UIOListItem[];
    tasks: RelatedTask[];
    confidence: number;
  };
  _links: {
    self: string;
    status: string;
    stream: string;
  };
}

/**
 * Streaming analysis event types.
 */
export type StreamEventType =
  | "start"
  | "node_start"
  | "node_complete"
  | "progress"
  | "complete"
  | "error";

/**
 * Stream event data.
 */
export interface StreamEvent {
  event: StreamEventType;
  data: {
    analysisId: string;
    node?: string;
    progress?: number;
    results?: AnalysisResult["results"];
    error?: string;
    timestamp: number;
  };
}

// =============================================================================
// GRAPH TYPES
// =============================================================================

/**
 * Graph query request.
 */
export interface GraphQueryInput {
  /** Cypher query string */
  cypher: string;
  /** Query parameters */
  params?: Record<string, unknown>;
}

/**
 * Graph query result.
 */
export interface GraphQueryResult<T = unknown> {
  data: T;
  query: {
    cypher: string;
    params: Record<string, unknown>;
  };
  metadata: {
    executionTimeMs: number;
    nodesReturned: number;
    relationshipsReturned: number;
  };
  _links: {
    self: string;
  };
}

// =============================================================================
// WEBHOOK TYPES
// =============================================================================

/**
 * Webhook registration input.
 */
export interface WebhookInput {
  /** URL to receive webhook events */
  url: string;
  /** Event types to subscribe to */
  events: string[];
  /** Secret for webhook signature verification */
  secret?: string;
  /** Description of the webhook */
  description?: string;
}

/**
 * Registered webhook.
 */
export interface Webhook {
  id: string;
  organizationId: string | null;
  url: string;
  events: string[];
  description?: string;
  status: "active" | "paused" | "failed";
  createdAt: string;
  _links: {
    self: string;
    test: string;
  };
}

// =============================================================================
// EVENT STREAM TYPES
// =============================================================================

/**
 * Intelligence event from the stream.
 */
export interface IntelligenceEvent {
  id: string;
  type: string;
  timestamp: number;
  organizationId: string;
  correlationId?: string;
  source: string;
  payload: Record<string, unknown>;
}

/**
 * Event stream options.
 */
export interface EventStreamOptions {
  /** Topics to subscribe to (default: ["uio.*", "task.*"]) */
  topics?: string[];
  /** Callback for received events */
  onEvent?: (event: IntelligenceEvent) => void;
  /** Callback for connection events */
  onConnect?: () => void;
  /** Callback for disconnection */
  onDisconnect?: () => void;
  /** Callback for errors */
  onError?: (error: Error) => void;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;
}

// =============================================================================
// STATS TYPES
// =============================================================================

/**
 * Intelligence statistics.
 */
export interface IntelligenceStats {
  organizationId: string | null;
  stats: {
    totalUIOs: number;
    byType: Record<string, number>;
    recentActivity: {
      last24Hours: number;
    };
  };
  _links: {
    self: string;
    uios: string;
  };
}
