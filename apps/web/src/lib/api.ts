/**
 * API Client for Python Backend
 *
 * Handles all communication with the drovi-intelligence FastAPI backend.
 * Uses cookie-based session auth (httpOnly cookies set by /auth/callback).
 */

import { env } from "@memorystack/env/web";
import { markApiReachable, markApiUnreachable } from "./api-reachability";
import { recordApiTrace } from "./api-trace";
import { getSessionToken } from "./session-token";

// Types
export interface User {
  user_id: string;
  org_id: string;
  org_name: string;
  role: string;
  email: string;
  exp: string;
}

export interface OrgInfo {
  id: string;
  name: string;
  status: string;
  region: string | null;
  allowed_domains: string[];
  notification_emails: string[] | null;
  allowed_connectors: string[] | null;
  default_connection_visibility: "org_shared" | "private";
  expires_at: string | null;
  created_at: string | null;
  member_count: number;
  connection_count: number;
}

export interface OrgMember {
  id: string;
  role: string;
  name: string | null;
  email: string;
  created_at: string | null;
}

export interface OrgInvite {
  token: string;
  org_id: string;
  role: string;
  expires_at: string;
  used_at: string | null;
  created_at: string | null;
  email?: string | null;
}

export interface OrgExportResponse {
  export_job_id: string;
  status: "processing" | "completed" | "failed";
  progress: number;
  download_url: string | null;
  expires_at: string;
}

export interface Connection {
  id: string;
  connector_type: string;
  name: string;
  organization_id: string;
  status: string;
  created_at: string;
  last_sync_at: string | null;
  sync_enabled: boolean;
  streams: string[];
}

export interface ConnectorCapabilities {
  supports_incremental: boolean;
  supports_full_refresh: boolean;
  supports_webhooks: boolean;
  supports_real_time: boolean;
}

export interface AvailableConnector {
  type: string;
  configured: boolean;
  missing_env: string[];
  capabilities: ConnectorCapabilities;
}

// =============================================================================
// Extended UIO Types (matches Python backend response models)
// =============================================================================

export interface Contact {
  id: string;
  displayName: string | null;
  primaryEmail: string;
  avatarUrl: string | null;
  company: string | null;
  title: string | null;
}

export interface CommitmentDetails {
  status: string | null;
  priority: string | null;
  direction: string | null;
  dueDateSource: string | null;
  isConditional: boolean;
  condition: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
}

export interface DecisionDetails {
  status: string | null;
  statement: string | null;
  rationale: string | null;
  decidedAt: string | null;
  supersedesUioId: string | null;
  supersededByUioId: string | null;
  impactAreas: string[] | null;
}

export interface TaskDetails {
  status: string | null;
  priority: string | null;
  estimatedEffort: string | null;
  completedAt: string | null;
  project: string | null;
  tags: string[] | null;
}

export interface RiskDetails {
  severity: string | null;
  riskType: string | null;
  suggestedAction: string | null;
  findings: Record<string, unknown> | null;
}

export interface ClaimDetails {
  claimType: string | null;
  quotedText: string | null;
  normalizedText: string | null;
  importance: string | null;
}

export interface BriefDetails {
  priorityTier: string | null;
  summary: string | null;
  suggestedAction: string | null;
  actionReasoning: string | null;
  urgencyScore: number | null;
  importanceScore: number | null;
  intentClassification: string | null;
}

export interface SourceInfo {
  id: string;
  sourceType: string | null;
  sourceTimestamp: string | null;
  quotedText: string | null;
  segmentHash: string | null;
  conversationId: string | null;
  messageId: string | null;
  role: string | null;
}

export interface UIO {
  id: string;
  type: "commitment" | "decision" | "task" | "claim" | "risk" | "topic" | "project" | "brief";
  canonicalTitle: string;
  canonicalDescription: string | null;
  userCorrectedTitle: string | null;
  status: string;
  overallConfidence: number | null;
  confidenceTier: "high" | "medium" | "low";
  isUserVerified: boolean;
  isUserDismissed: boolean;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string | null;
  firstSeenAt: string | null;

  // Resolved contacts
  owner: Contact | null;
  debtor: Contact | null;
  creditor: Contact | null;
  decisionMaker: Contact | null;
  assignee: Contact | null;
  createdBy: Contact | null;

  // Type-specific details (only one populated based on type)
  commitmentDetails: CommitmentDetails | null;
  decisionDetails: DecisionDetails | null;
  taskDetails: TaskDetails | null;
  riskDetails: RiskDetails | null;
  claimDetails: ClaimDetails | null;
  briefDetails: BriefDetails | null;

  // Evidence sources
  sources: SourceInfo[] | null;
  evidenceId: string | null;

  // Legacy compat - computed from details
  title: string;
  description: string | null;
  confidence: number;
  direction?: "owed_to_me" | "owed_by_me";
  extractedAt: string;
}

export interface UIOListResponse {
  items: UIO[];
  total: number;
  cursor: string | null;
  hasMore: boolean;
}

// =============================================================================
// Response Transformer (snake_case → camelCase)
// =============================================================================

function transformContact(raw: Record<string, unknown> | null): Contact | null {
  if (!raw || !raw.id) return null;
  return {
    id: raw.id as string,
    displayName: (raw.display_name as string | null) ?? null,
    primaryEmail: (raw.primary_email as string) || (raw.email as string) || "",
    avatarUrl: (raw.avatar_url as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
  };
}

function transformCommitmentDetails(raw: Record<string, unknown> | null): CommitmentDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    priority: (raw.priority as string | null) ?? null,
    direction: (raw.direction as string | null) ?? null,
    dueDateSource: (raw.due_date_source as string | null) ?? null,
    isConditional: (raw.is_conditional as boolean) ?? false,
    condition: (raw.condition as string | null) ?? null,
    snoozedUntil: (raw.snoozed_until as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
  };
}

function transformDecisionDetails(raw: Record<string, unknown> | null): DecisionDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    statement: (raw.statement as string | null) ?? null,
    rationale: (raw.rationale as string | null) ?? null,
    decidedAt: (raw.decided_at as string | null) ?? null,
    supersedesUioId: (raw.supersedes_uio_id as string | null) ?? null,
    supersededByUioId: (raw.superseded_by_uio_id as string | null) ?? null,
    impactAreas: (raw.impact_areas as string[] | null) ?? null,
  };
}

function transformTaskDetails(raw: Record<string, unknown> | null): TaskDetails | null {
  if (!raw) return null;
  return {
    status: (raw.status as string | null) ?? null,
    priority: (raw.priority as string | null) ?? null,
    estimatedEffort: (raw.estimated_effort as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
    project: (raw.project as string | null) ?? null,
    tags: (raw.tags as string[] | null) ?? null,
  };
}

function transformRiskDetails(raw: Record<string, unknown> | null): RiskDetails | null {
  if (!raw) return null;
  return {
    severity: (raw.severity as string | null) ?? null,
    riskType: (raw.risk_type as string | null) ?? null,
    suggestedAction: (raw.suggested_action as string | null) ?? null,
    findings: (raw.findings as Record<string, unknown> | null) ?? null,
  };
}

function transformClaimDetails(raw: Record<string, unknown> | null): ClaimDetails | null {
  if (!raw) return null;
  return {
    claimType: (raw.claim_type as string | null) ?? null,
    quotedText: (raw.quoted_text as string | null) ?? null,
    normalizedText: (raw.normalized_text as string | null) ?? null,
    importance: (raw.importance as string | null) ?? null,
  };
}

function transformBriefDetails(raw: Record<string, unknown> | null): BriefDetails | null {
  if (!raw) return null;
  return {
    priorityTier: (raw.priority_tier as string | null) ?? null,
    summary: (raw.summary as string | null) ?? null,
    suggestedAction: (raw.suggested_action as string | null) ?? null,
    actionReasoning: (raw.action_reasoning as string | null) ?? null,
    urgencyScore: (raw.urgency_score as number | null) ?? null,
    importanceScore: (raw.importance_score as number | null) ?? null,
    intentClassification: (raw.intent_classification as string | null) ?? null,
  };
}

function transformSourceInfo(raw: Record<string, unknown>): SourceInfo {
  return {
    id: raw.id as string,
    sourceType: (raw.source_type as string | null) ?? null,
    sourceTimestamp: (raw.source_timestamp as string | null) ?? null,
    quotedText: (raw.quoted_text as string | null) ?? null,
    segmentHash: (raw.segment_hash as string | null) ?? null,
    conversationId: (raw.conversation_id as string | null) ?? null,
    messageId: (raw.message_id as string | null) ?? null,
    role: (raw.role as string | null) ?? null,
  };
}

export function transformUIO(raw: Record<string, unknown>): UIO {
  const canonicalTitle = (raw.canonical_title as string) || (raw.title as string) || "Untitled";
  const confidence = (raw.overall_confidence as number) ?? (raw.confidence as number) ?? 0;
  const direction = (raw.commitment_details as Record<string, unknown>)?.direction as string | undefined;

  return {
    id: raw.id as string,
    type: raw.type as UIO["type"],
    canonicalTitle,
    canonicalDescription: (raw.canonical_description as string | null) ?? null,
    userCorrectedTitle: (raw.user_corrected_title as string | null) ?? null,
    status: (raw.status as string) || "active",
    overallConfidence: confidence,
    confidenceTier: (raw.confidence_tier as UIO["confidenceTier"]) || "medium",
    isUserVerified: (raw.is_user_verified as boolean) ?? false,
    isUserDismissed: (raw.is_user_dismissed as boolean) ?? false,
    dueDate: (raw.due_date as string | null) ?? null,
    createdAt: (raw.created_at as string) || new Date().toISOString(),
    updatedAt: (raw.updated_at as string | null) ?? null,
    firstSeenAt: (raw.first_seen_at as string | null) ?? null,

    owner: transformContact(raw.owner as Record<string, unknown> | null),
    debtor: transformContact(raw.debtor as Record<string, unknown> | null),
    creditor: transformContact(raw.creditor as Record<string, unknown> | null),
    decisionMaker: transformContact(raw.decision_maker as Record<string, unknown> | null),
    assignee: transformContact(raw.assignee as Record<string, unknown> | null),
    createdBy: transformContact(raw.created_by as Record<string, unknown> | null),

    commitmentDetails: transformCommitmentDetails(raw.commitment_details as Record<string, unknown> | null),
    decisionDetails: transformDecisionDetails(raw.decision_details as Record<string, unknown> | null),
    taskDetails: transformTaskDetails(raw.task_details as Record<string, unknown> | null),
    riskDetails: transformRiskDetails(raw.risk_details as Record<string, unknown> | null),
    claimDetails: transformClaimDetails(raw.claim_details as Record<string, unknown> | null),
    briefDetails: transformBriefDetails(raw.brief_details as Record<string, unknown> | null),

    sources: raw.sources
      ? (raw.sources as Record<string, unknown>[]).map(transformSourceInfo)
      : null,
    evidenceId: (raw.evidence_id as string | null) ?? (raw.source_id as string | null) ?? null,

    // Legacy compat
    title: canonicalTitle,
    description: (raw.canonical_description as string | null) ?? null,
    confidence,
    direction: direction as "owed_to_me" | "owed_by_me" | undefined,
    extractedAt: (raw.created_at as string) || new Date().toISOString(),
  };
}

export interface Brief {
  id: string;
  summary: string;
  highlights: BriefHighlight[];
  open_loops: OpenLoop[];
  generated_at: string;
}

export interface BriefHighlight {
  type: string;
  title: string;
  description: string;
  uio_id: string | null;
}

export interface OpenLoop {
  id: string;
  title: string;
  type: string;
  due_date: string | null;
  priority: "high" | "medium" | "low";
}

export interface Evidence {
  id: string;
  content: string;
  source_type: string;
  source_id: string;
  extracted_at: string;
}

export interface AskSource {
  name?: string | null;
  title?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  source_timestamp?: string | null;
  quoted_text?: string | null;
  segment_hash?: string | null;
  conversation_id?: string | null;
  message_id?: string | null;
  url?: string | null;
  [key: string]: unknown;
}

export interface AskResponse {
  answer: string;
  intent: string;
  sources: AskSource[];
  cypher_query: string | null;
  results_count: number;
  duration_seconds: number;
  timestamp: string;
  session_id: string | null;
  context_used: boolean;
  closest_matches_used: boolean;
  user_context: Record<string, unknown> | null;
}

export interface SyncStatus {
  connection_id: string;
  status: "idle" | "syncing" | "completed" | "failed";
  progress: number;
  records_synced: number;
  total_records: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface LoginResponse {
  auth_url: string;
  state: string;
}

export interface OAuthInitResponse {
  auth_url: string;
  state: string;
}

export interface EmailAuthResponse {
  user: {
    id: string;
    email: string;
    name?: string | null;
    role?: string | null;
    created_at?: string | null;
  };
  session_token: string;
  organization?: {
    id: string;
    name: string;
    status?: string;
    region?: string | null;
    created_at?: string | null;
  } | null;
  organizations?: Array<{
    id: string;
    name: string;
    status?: string;
    region?: string | null;
    created_at?: string | null;
  }> | null;
}

// =============================================================================
// API Errors
// =============================================================================

export type ApiErrorCode =
  | "API_UNREACHABLE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "UNKNOWN_ERROR";

export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: ApiErrorCode,
    public detail?: string,
    public endpoint?: string,
    public method?: string,
    public requestId?: string,
    public url?: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

// API Base URL from environment
const APP_BASE_URL = env.VITE_SERVER_URL;

/**
 * API base for diagnostics only.
 *
 * The web app is deployed with an Nginx reverse-proxy that serves the UI and
 * forwards `/api/*` and `/health` to the intelligence API. Using same-origin
 * relative URLs avoids CORS/cookie issues and prevents "failed to fetch" loops.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return APP_BASE_URL;
}

function buildApiV1Url(path: string): string {
  if (typeof window !== "undefined") {
    return `/api/v1${path}`;
  }
  return `${APP_BASE_URL}/api/v1${path}`;
}

function buildHealthUrl(): string {
  if (typeof window !== "undefined") {
    return "/health";
  }
  return `${APP_BASE_URL}/health`;
}

/**
 * Core fetch wrapper with error handling
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const sessionToken = getSessionToken();
  const normalizedHeaders: Record<string, string> = (() => {
    if (!options.headers) {
      return {};
    }
    if (options.headers instanceof Headers) {
      return Object.fromEntries(options.headers.entries());
    }
    if (Array.isArray(options.headers)) {
      return Object.fromEntries(options.headers);
    }
    return options.headers;
  })();

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...normalizedHeaders,
  };

  const hasAuthHeader = Object.keys(baseHeaders).some(
    (key) => key.toLowerCase() === "authorization"
  );

  if (sessionToken && !hasAuthHeader) {
    baseHeaders.Authorization = `Bearer ${sessionToken}`;
  }

  const url = buildApiV1Url(path);
  const endpoint = `/api/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: "include", // Include cookies for session auth
      headers: baseHeaders,
    });
    markApiReachable();
  } catch (error) {
    markApiUnreachable(error);
    const durationMs =
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt;
    recordApiTrace({
      kind: "error",
      at: Date.now(),
      method,
      endpoint,
      url,
      status: 0,
      requestId: undefined,
      durationMs: Math.max(0, Math.round(durationMs)),
    });
    throw new APIError(
      `Drovi API unreachable (${method} /api/v1${path}). Check that the intelligence stack is running.`,
      0,
      "API_UNREACHABLE",
      error instanceof Error ? error.message : "Network error",
      endpoint,
      method,
      undefined,
      url
    );
  }

  if (!res.ok) {
    const requestId = res.headers.get("X-Request-ID") ?? undefined;
    const durationMs =
      (typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()) - startedAt;
    recordApiTrace({
      kind: "error",
      at: Date.now(),
      method,
      endpoint,
      url,
      status: res.status,
      requestId,
      durationMs: Math.max(0, Math.round(durationMs)),
    });
    let detail: string | undefined;
    try {
      const errorBody = await res.json();
      if (typeof errorBody?.detail === "string") {
        detail = errorBody.detail;
      } else if (Array.isArray(errorBody?.detail)) {
        // FastAPI validation errors: [{loc, msg, type}, ...]
        detail = errorBody.detail
          .map((item: unknown) => {
            if (item && typeof item === "object" && "msg" in item) {
              return String((item as { msg?: unknown }).msg ?? "");
            }
            return String(item);
          })
          .filter(Boolean)
          .slice(0, 3)
          .join("; ");
      } else if (typeof errorBody?.message === "string") {
        detail = errorBody.message;
      } else if (typeof errorBody === "string") {
        detail = errorBody;
      } else {
        detail = res.statusText;
      }
    } catch {
      detail = res.statusText;
    }

    const code: ApiErrorCode = (() => {
      if (res.status === 401) return "UNAUTHENTICATED";
      if (res.status === 403) return "FORBIDDEN";
      if (res.status === 400 || res.status === 422) return "VALIDATION_ERROR";
      if (res.status === 429) return "RATE_LIMITED";
      if (res.status >= 500) return "SERVER_ERROR";
      return "UNKNOWN_ERROR";
    })();

    const message = (() => {
      if (code === "UNAUTHENTICATED") {
        return `Not authenticated (${method} ${endpoint}). Please sign in again.`;
      }
      if (code === "FORBIDDEN") {
        return `Forbidden (${method} ${endpoint}).`;
      }
      if (code === "VALIDATION_ERROR") {
        return `${detail ? `Invalid request: ${detail}` : "Invalid request"} (${method} ${endpoint}).`;
      }
      if (code === "RATE_LIMITED") {
        return `Rate limited (${method} ${endpoint}). Try again soon.`;
      }
      if (code === "SERVER_ERROR") {
        return `${detail ? `Server error: ${detail}` : `Server error (${res.status})`} (${method} ${endpoint}).`;
      }
      return `${detail || `Request failed (${res.status})`} (${method} ${endpoint}).`;
    })();

    throw new APIError(
      message,
      res.status,
      code,
      detail,
      endpoint,
      method,
      requestId,
      url
    );
  }

  const requestId = res.headers.get("X-Request-ID") ?? undefined;
  const durationMs =
    (typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now()) - startedAt;
  recordApiTrace({
    kind: "ok",
    at: Date.now(),
    method,
    endpoint,
    url,
    status: res.status,
    requestId,
    durationMs: Math.max(0, Math.round(durationMs)),
  });

  // Handle empty responses
  const text = await res.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// =============================================================================
// AUTH API
// =============================================================================

export const authAPI = {
  /**
   * Login with email and password.
   * Sets a session cookie on success.
   */
  async loginWithEmail(params: { email: string; password: string }): Promise<EmailAuthResponse> {
    return apiFetch<EmailAuthResponse>("/auth/login/email", {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        password: params.password,
      }),
    });
  },

  /**
   * Sign up with email and password.
   * Creates an organization when no invite token is provided.
   */
  async signupWithEmail(params: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
    inviteToken?: string;
  }): Promise<EmailAuthResponse> {
    return apiFetch<EmailAuthResponse>("/auth/signup/email", {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        password: params.password,
        name: params.name ?? null,
        organization_name: params.organizationName ?? null,
        invite_token: params.inviteToken ?? null,
      }),
    });
  },

  /**
   * Get current authenticated user
   * Returns null if not authenticated
   */
  async getMe(): Promise<User | null> {
    try {
      return await apiFetch<User>("/auth/me");
    } catch (e) {
      if (e instanceof APIError && e.status === 401) {
        return null;
      }
      throw e;
    }
  },

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    await apiFetch<{ success: boolean }>("/auth/logout", { method: "POST" });
  },
};

// =============================================================================
// CONNECTIONS API
// =============================================================================

export const connectionsAPI = {
  /**
   * List available connector types
   */
  async listConnectors(): Promise<AvailableConnector[]> {
    const response = await apiFetch<{ connectors: AvailableConnector[] }>(
      "/connections/connectors"
    );
    return response.connectors || [];
  },

  /**
   * List all connections for the organization
   */
  async list(): Promise<Connection[]> {
    const response = await apiFetch<{ connections: Connection[] }>(
      "/connections"
    );
    return response.connections || [];
  },

  /**
   * Get a single connection by ID
   */
  async get(connectionId: string): Promise<Connection> {
    return apiFetch<Connection>(`/connections/${connectionId}`);
  },

  /**
   * Initiate OAuth flow for a connector
   */
  async initiateOAuth(
    connectorType: string,
    organizationId: string,
    options?: { restrictedLabels?: string[]; restrictedChannels?: string[] }
  ): Promise<OAuthInitResponse> {
    const redirectUri = `${getApiBase()}/api/v1/auth/callback`;
    return apiFetch<OAuthInitResponse>("/connections/oauth/initiate", {
      method: "POST",
      body: JSON.stringify({
        connector_type: connectorType,
        organization_id: organizationId,
        redirect_uri: redirectUri,
        ...options,
      }),
    });
  },

  /**
   * Trigger sync for a connection
   */
  async triggerSync(
    connectionId: string,
    fullRefresh = false
  ): Promise<{ job_id: string }> {
    return apiFetch<{ job_id: string }>(
      `/connections/${connectionId}/sync`,
      {
        method: "POST",
        body: JSON.stringify({ full_refresh: fullRefresh }),
      }
    );
  },

  /**
   * Get sync status for a connection
   */
  async getSyncStatus(connectionId: string): Promise<SyncStatus> {
    return apiFetch<SyncStatus>(`/connections/${connectionId}/sync/status`);
  },

  /**
   * Delete a connection
   */
  async delete(connectionId: string): Promise<void> {
    await apiFetch<void>(`/connections/${connectionId}`, {
      method: "DELETE",
    });
  },

  /**
   * Update a connection
   */
  async update(
    connectionId: string,
    updates: { name?: string; sync_enabled?: boolean }
  ): Promise<Connection> {
    return apiFetch<Connection>(`/connections/${connectionId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  },
};

// =============================================================================
// INTELLIGENCE API (UIOs)
// =============================================================================

export const intelligenceAPI = {
  /**
   * List UIOs with filtering and pagination
   * Returns fully transformed UIO objects with resolved contacts
   */
  async listUIOs(params?: {
    type?: string;
    status?: string;
    time_range?: string;
    cursor?: string;
    limit?: number;
  }): Promise<UIOListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set("type", params.type);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.time_range) searchParams.set("time_range", params.time_range);
    if (params?.cursor) searchParams.set("cursor", params.cursor);
    if (params?.limit) searchParams.set("limit", String(params.limit));

    const query = searchParams.toString();
    const raw = await apiFetch<{
      items: Record<string, unknown>[];
      total: number;
      cursor: string | null;
      has_more: boolean;
    }>(`/uios/v2${query ? `?${query}` : ""}`);

    return {
      items: raw.items.map(transformUIO),
      total: raw.total,
      cursor: raw.cursor,
      hasMore: raw.has_more,
    };
  },

  /**
   * Get a single UIO by ID
   */
  async getUIO(uioId: string): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}`);
    return transformUIO(raw);
  },

  /**
   * Update a UIO status
   */
  async updateStatus(uioId: string, status: string): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return transformUIO(raw);
  },

  /**
   * Apply user corrections to a UIO
   */
  async updateUIO(
    uioId: string,
    updates: { canonical_title?: string; canonical_description?: string; due_date?: string },
    organizationId: string
  ): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(
      `/uios/${uioId}?organization_id=${organizationId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );
    return transformUIO(raw);
  },

  /**
   * Verify a UIO (mark as user-confirmed)
   */
  async verify(uioId: string): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/verify`, {
      method: "POST",
    });
    return transformUIO(raw);
  },

  /**
   * Snooze a commitment/task until specified date
   */
  async snooze(uioId: string, snoozeUntil: string): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/snooze`, {
      method: "POST",
      body: JSON.stringify({ snooze_until: snoozeUntil }),
    });
    return transformUIO(raw);
  },

  /**
   * Update task status (Kanban workflow)
   */
  async updateTaskStatus(
    uioId: string,
    status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled"
  ): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/task-status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return transformUIO(raw);
  },

  /**
   * Update task priority
   */
  async updateTaskPriority(
    uioId: string,
    priority: "no_priority" | "low" | "medium" | "high" | "urgent"
  ): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/task-priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    });
    return transformUIO(raw);
  },

  /**
   * Update commitment priority
   */
  async updateCommitmentPriority(
    uioId: string,
    priority: "low" | "medium" | "high" | "urgent"
  ): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/commitment-priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    });
    return transformUIO(raw);
  },

  /**
   * Update commitment direction
   */
  async updateCommitmentDirection(
    uioId: string,
    direction: "owed_by_me" | "owed_to_me"
  ): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/commitment-direction`, {
      method: "PATCH",
      body: JSON.stringify({ direction }),
    });
    return transformUIO(raw);
  },

  /**
   * Mark a decision as superseded by another decision
   */
  async supersedeDecision(uioId: string, supersededById: string): Promise<UIO> {
    const raw = await apiFetch<Record<string, unknown>>(`/uios/${uioId}/supersede`, {
      method: "POST",
      body: JSON.stringify({ superseded_by_id: supersededById }),
    });
    return transformUIO(raw);
  },

  /**
   * Archive/dismiss a UIO
   */
  async archive(uioId: string): Promise<UIO> {
    return this.updateStatus(uioId, "archived");
  },

  /**
   * Mark a commitment/task as complete
   */
  async markComplete(uioId: string): Promise<UIO> {
    return this.updateStatus(uioId, "completed");
  },

  /**
   * Get evidence for a UIO
   */
  async getEvidence(evidenceId: string): Promise<Evidence> {
    return apiFetch<Evidence>(`/evidence/${evidenceId}`);
  },
};

// =============================================================================
// ASK API (Natural Language Queries)
// =============================================================================

export const askAPI = {
  /**
   * Ask a natural language question about your data
   */
  async ask(params: {
    question: string;
    organizationId: string;
    sessionId?: string;
    includeEvidence?: boolean;
    userId?: string;
  }): Promise<AskResponse> {
    return apiFetch<AskResponse>("/ask", {
      method: "POST",
      body: JSON.stringify({
        question: params.question,
        organization_id: params.organizationId,
        session_id: params.sessionId ?? null,
        include_evidence: params.includeEvidence ?? true,
        user_id: params.userId ?? null,
      }),
    });
  },
};

// =============================================================================
// SEARCH API (Hybrid Search)
// =============================================================================

export interface SearchResult {
  id: string | null;
  type: string;
  title: string | null;
  properties: Record<string, unknown>;
  score: number;
  scores: Record<string, number>;
  match_source: string;
  connections: Array<Record<string, unknown>> | null;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  count: number;
  query_time_ms: number;
  total: number;
}

export const searchAPI = {
  /**
   * Perform hybrid search combining vector and full-text search
   */
  async search(params: {
    query: string;
    types?: string[];
    source_types?: string[];
    include_graph_context?: boolean;
    limit?: number;
  }): Promise<SearchResponse> {
    const response = await apiFetch<SearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
        types: params.types,
        source_types: params.source_types,
        include_graph_context: params.include_graph_context ?? false,
        limit: params.limit ?? 20,
      }),
    });
    // Ensure total is set for frontend compatibility
    return {
      ...response,
      total: response.count,
    };
  },
};

// =============================================================================
// CONTENT SEARCH API (Unified Event Model)
// =============================================================================

export interface ContentSearchResult {
  id: string;
  kind: string;
  source_type: string;
  source_id: string | null;
  source_account_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  title: string | null;
  snippet: string | null;
  captured_at: string | null;
  received_at: string;
}

export interface ContentSearchResponse {
  success: boolean;
  results: ContentSearchResult[];
  count: number;
}

export const contentAPI = {
  async search(params: {
    query: string;
    organizationId?: string;
    kinds?: Array<"message" | "document" | "meeting" | "note">;
    limit?: number;
  }): Promise<ContentSearchResponse> {
    return apiFetch<ContentSearchResponse>("/content/search", {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
        organization_id: params.organizationId ?? null,
        kinds: params.kinds ?? null,
        limit: params.limit ?? 20,
      }),
    });
  },
};

// =============================================================================
// BRIEF API
// =============================================================================

export const briefAPI = {
  /**
   * Get the daily brief for the organization
   */
  async getDailyBrief(): Promise<Brief> {
    return apiFetch<Brief>("/brief");
  },

  /**
   * Generate a new daily brief
   */
  async generateBrief(): Promise<Brief> {
    return apiFetch<Brief>("/brief/generate", { method: "POST" });
  },
};

// =============================================================================
// SSE (Server-Sent Events) for Real-time Updates
// =============================================================================

export const sseAPI = {
  /**
   * Subscribe to sync progress events for a connection
   */
  subscribeSyncProgress(
    connectionId: string,
    onEvent: (event: SyncStatus) => void,
    onError?: (error: Event) => void
  ): () => void {
    const eventSource = new EventSource(
      `${getApiBase()}/api/v1/sse/sync/${connectionId}`,
      { withCredentials: true }
    );

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SyncStatus;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event.data);
      }
    };

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  },

  /**
   * Subscribe to new intelligence events
   */
  subscribeIntelligence(
    onEvent: (uio: UIO) => void,
    onError?: (error: Event) => void
  ): () => void {
    const eventSource = new EventSource(
      `${getApiBase()}/api/v1/sse/intelligence`,
      { withCredentials: true }
    );

    eventSource.addEventListener("new_uio", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as UIO;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event);
      }
    });

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    return () => {
      eventSource.close();
    };
  },
};

// =============================================================================
// CONNECTORS METADATA
// =============================================================================

export interface ConnectorInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  authType: "oauth" | "api_key" | "credentials";
  status: "available" | "coming_soon";
}

export const AVAILABLE_CONNECTORS: ConnectorInfo[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: "mail",
    description: "Email messages and threads from Gmail",
    authType: "oauth",
    status: "available",
  },
  {
    id: "slack",
    name: "Slack",
    icon: "message-square",
    description: "Messages and channels from Slack workspaces",
    authType: "oauth",
    status: "available",
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: "mail",
    description: "Email messages from Microsoft Outlook",
    authType: "oauth",
    status: "available",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    icon: "users",
    description: "Chats and channel messages from Teams",
    authType: "oauth",
    status: "available",
  },
  {
    id: "notion",
    name: "Notion",
    icon: "file-text",
    description: "Pages and databases from Notion",
    authType: "oauth",
    status: "available",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    icon: "phone",
    description: "Business messages from WhatsApp",
    authType: "oauth",
    status: "available",
  },
  {
    id: "google_docs",
    name: "Google Docs",
    icon: "file",
    description: "Documents from Google Drive",
    authType: "oauth",
    status: "available",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    icon: "target",
    description: "Contacts, deals, and engagements from HubSpot CRM",
    authType: "oauth",
    status: "available",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: "calendar",
    description: "Events and meetings from Google Calendar",
    authType: "oauth",
    status: "available",
  },
];

// =============================================================================
// ORG API (Pilot-Friendly Endpoints - Cookie Auth)
// =============================================================================

export interface OrgConnection {
  id: string;
  provider: string;
  email: string | null;
  workspace: string | null;
  status: string;
  visibility?: "org_shared" | "private";
  created_by_user_id?: string | null;
  created_by_email?: string | null;
  created_by_name?: string | null;
  live_status?: string | null;
  backfill_status?: string | null;
  last_error?: string | null;
  scopes: string[];
  last_sync: string | null;
  messages_synced: number;
  restricted_labels: string[];
  restricted_channels: string[];
  progress: number | null;
}

export interface ConnectResponse {
  auth_url: string;
  state: string;
  code_verifier: string;
}

export interface SyncTriggerResponse {
  connection_id: string;
  status: string;
  message: string;
}

export interface BackfillResponse {
  connection_id: string;
  backfill_jobs: string[];
  status: string;
}

export const orgAPI = {
  /**
   * List all connections for the authenticated org
   */
  async listConnections(): Promise<OrgConnection[]> {
    const response = await apiFetch<{ connections: OrgConnection[] }>(
      "/org/connections"
    );
    return response.connections || [];
  },

  /**
   * Initiate OAuth flow for a connector
   * @param provider - gmail, slack, etc.
   * @param options - Optional restrictions for labels/channels
   */
  async initiateConnect(
    provider: string,
    options?: {
      visibility?: "org_shared" | "private";
      restrictedLabels?: string[];
      restrictedChannels?: string[];
      returnTo?: string;
    }
  ): Promise<ConnectResponse> {
    const redirectUri = `${getApiBase()}/api/v1/auth/callback`;
    return apiFetch<ConnectResponse>(
      `/org/connections/${provider}/connect`,
      {
        method: "POST",
        body: JSON.stringify({
          redirect_uri: redirectUri,
          visibility: options?.visibility ?? null,
          restricted_labels: options?.restrictedLabels || [],
          restricted_channels: options?.restrictedChannels || [],
          return_to: options?.returnTo || null,
        }),
      }
    );
  },

  /**
   * Trigger a sync for a connection
   */
  async triggerSync(
    connectionId: string,
    options?: { fullRefresh?: boolean; streams?: string[] }
  ): Promise<SyncTriggerResponse> {
    return apiFetch<SyncTriggerResponse>(
      `/org/connections/${connectionId}/sync`,
      {
        method: "POST",
        body: JSON.stringify({
          full_refresh: options?.fullRefresh || false,
          streams: options?.streams || [],
        }),
      }
    );
  },

  async triggerBackfill(params: {
    connectionId: string;
    startDate: string;
    endDate?: string;
    windowDays?: number;
    streams?: string[];
    throttleSeconds?: number;
  }): Promise<BackfillResponse> {
    return apiFetch<BackfillResponse>(
      `/org/connections/${params.connectionId}/backfill`,
      {
        method: "POST",
        body: JSON.stringify({
          start_date: params.startDate,
          end_date: params.endDate ?? null,
          window_days: params.windowDays ?? 7,
          streams: params.streams ?? [],
          throttle_seconds: params.throttleSeconds ?? 1.0,
        }),
      }
    );
  },

  /**
   * Delete a connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await apiFetch<void>(`/org/connections/${connectionId}`, {
      method: "DELETE",
    });
  },

  /**
   * Update connection visibility (org_shared vs private).
   */
  async updateConnectionVisibility(params: {
    connectionId: string;
    visibility: "org_shared" | "private";
  }): Promise<{ updated: boolean; connection_id: string; visibility: string }> {
    return apiFetch<{ updated: boolean; connection_id: string; visibility: string }>(
      `/org/connections/${params.connectionId}/visibility`,
      {
        method: "PATCH",
        body: JSON.stringify({ visibility: params.visibility }),
      }
    );
  },

  /**
   * Get organization info
   */
  async getOrgInfo(): Promise<OrgInfo> {
    return apiFetch<OrgInfo>("/org/info");
  },

  async updateOrgInfo(params: {
    name?: string;
    allowedDomains?: string[];
    notificationEmails?: string[];
    region?: string;
    allowedConnectors?: string[] | null;
    defaultConnectionVisibility?: "org_shared" | "private" | null;
  }): Promise<OrgInfo> {
    return apiFetch<OrgInfo>("/org/info", {
      method: "PATCH",
      body: JSON.stringify({
        name: params.name ?? null,
        allowed_domains: params.allowedDomains ?? null,
        notification_emails: params.notificationEmails ?? null,
        region: params.region ?? null,
        allowed_connectors: params.allowedConnectors ?? null,
        default_connection_visibility: params.defaultConnectionVisibility ?? null,
      }),
    });
  },

  async listMembers(): Promise<OrgMember[]> {
    const response = await apiFetch<{ members: OrgMember[] }>("/org/members");
    return response.members || [];
  },

  async updateMemberRole(params: { userId: string; role: string }) {
    return apiFetch<{ updated: boolean }>(`/org/members/${params.userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role: params.role }),
    });
  },

  async removeMember(userId: string) {
    return apiFetch<{ removed: boolean }>(`/org/members/${userId}`, {
      method: "DELETE",
    });
  },

  async listInvites(): Promise<OrgInvite[]> {
    const response = await apiFetch<{ invites: OrgInvite[] }>("/org/invites");
    return response.invites || [];
  },

  async createInvite(params: {
    role?: "pilot_admin" | "pilot_member" | "pilot_viewer";
    expiresInDays?: number;
    email?: string;
  }): Promise<OrgInvite> {
    return apiFetch<OrgInvite>("/org/invites", {
      method: "POST",
      body: JSON.stringify({
        role: params.role ?? "pilot_member",
        expires_in_days: params.expiresInDays ?? 7,
        email: params.email ?? null,
      }),
    });
  },

  async revokeInvite(token: string) {
    return apiFetch<{ revoked: boolean }>(`/org/invites/${token}`, {
      method: "DELETE",
    });
  },

  async exportData(params: {
    format?: "json" | "csv" | "neo4j";
    include?: string[];
  }): Promise<OrgExportResponse> {
    return apiFetch<OrgExportResponse>("/org/export", {
      method: "POST",
      body: JSON.stringify({
        format: params.format ?? "json",
        include: params.include ?? ["uios", "evidence", "graph", "connections"],
      }),
    });
  },

  async getExportStatus(jobId: string): Promise<OrgExportResponse> {
    return apiFetch<OrgExportResponse>(`/org/export/${jobId}`);
  },
};

// =============================================================================
// SSE for ORG (Cookie Auth)
// =============================================================================

export interface SyncEvent {
  event_type: "started" | "progress" | "completed" | "failed";
  connection_id: string;
  connector_type?: string;
  job_id?: string | null;
  records_synced?: number;
  total_records?: number;
  progress?: number | null;
  status?: string;
  error?: string;
  sync_params?: Record<string, unknown> | null;
  timestamp?: string;
}

export const orgSSE = {
  /**
   * Subscribe to all sync events for the organization
   */
  subscribeSyncEvents(
    onEvent: (event: SyncEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    const eventSource = new EventSource(
      `${getApiBase()}/api/v1/org/connections/events`,
      { withCredentials: true }
    );

    eventSource.addEventListener("started", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as SyncEvent;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event);
      }
    });

    eventSource.addEventListener("progress", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as SyncEvent;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event);
      }
    });

    eventSource.addEventListener("completed", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as SyncEvent;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event);
      }
    });

    eventSource.addEventListener("failed", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as SyncEvent;
        onEvent(data);
      } catch {
        console.error("Failed to parse SSE event", event);
      }
    });

    eventSource.onerror = (error) => {
      onError?.(error);
    };

    return () => {
      eventSource.close();
    };
  },
};

// =============================================================================
// CONTACTS API
// =============================================================================

export interface ContactSummary {
  id: string;
  primaryEmail: string;
  displayName: string | null;
  avatarUrl: string | null;
  company: string | null;
  title: string | null;
  healthScore: number | null;
  importanceScore: number | null;
  engagementScore: number | null;
  sentimentScore: number | null;
  isVip: boolean;
  isAtRisk: boolean;
  isInternal: boolean;
  lifecycleStage: string | null;
  roleType: string | null;
  totalThreads: number;
  totalMessages: number;
  lastInteractionAt: string | null;
  daysSinceLastContact: number | null;
}

export interface ContactDetail extends ContactSummary {
  firstName: string | null;
  lastName: string | null;
  emails: string[];
  phone: string | null;
  linkedinUrl: string | null;
  department: string | null;
  seniorityLevel: string | null;
  roleConfidence: number | null;
  avgResponseTimeMinutes: number | null;
  responseRate: number | null;
  avgWordsPerMessage: number | null;
  communicationProfile: Record<string, unknown> | null;
  influenceScore: number | null;
  bridgingScore: number | null;
  communityIds: string[];
  contactBrief: string | null;
  riskReason: string | null;
  notes: string | null;
  lastIntelligenceAt: string | null;
  intelligenceVersion: number | null;
  firstInteractionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContactListResponse {
  items: ContactSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface ContactStats {
  totalContacts: number;
  vipCount: number;
  atRiskCount: number;
  internalCount: number;
  newThisWeek: number;
  avgHealthScore: number | null;
}

export interface MeetingBrief {
  contactId: string;
  contactName: string | null;
  brief: string;
  talkingPoints: string[];
  openCommitments: string[];
  pendingDecisions: string[];
  generatedAt: string;
}

export interface ContactIdentityRecord {
  id: string;
  identityType: string;
  identityValue: string;
  confidence: number;
  isVerified: boolean;
  source: string | null;
  sourceAccountId: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ContactMergeSuggestion {
  contactAId: string;
  contactAName: string | null;
  contactAEmail: string | null;
  contactBId: string;
  contactBName: string | null;
  contactBEmail: string | null;
  confidence: number;
  matchReasons: string[];
}

function transformContactSummary(raw: Record<string, unknown>): ContactSummary {
  return {
    id: raw.id as string,
    primaryEmail: raw.primary_email as string,
    displayName: raw.display_name as string | null,
    avatarUrl: raw.avatar_url as string | null,
    company: raw.company as string | null,
    title: raw.title as string | null,
    healthScore: raw.health_score as number | null,
    importanceScore: raw.importance_score as number | null,
    engagementScore: raw.engagement_score as number | null,
    sentimentScore: raw.sentiment_score as number | null,
    isVip: (raw.is_vip as boolean) ?? false,
    isAtRisk: (raw.is_at_risk as boolean) ?? false,
    isInternal: (raw.is_internal as boolean) ?? false,
    lifecycleStage: raw.lifecycle_stage as string | null,
    roleType: raw.role_type as string | null,
    totalThreads: (raw.total_threads as number) ?? 0,
    totalMessages: (raw.total_messages as number) ?? 0,
    lastInteractionAt: raw.last_interaction_at as string | null,
    daysSinceLastContact: raw.days_since_last_contact as number | null,
  };
}

function transformContactDetail(raw: Record<string, unknown>): ContactDetail {
  return {
    ...transformContactSummary(raw),
    firstName: raw.first_name as string | null,
    lastName: raw.last_name as string | null,
    emails: (raw.emails as string[]) ?? [],
    phone: raw.phone as string | null,
    linkedinUrl: raw.linkedin_url as string | null,
    department: raw.department as string | null,
    seniorityLevel: raw.seniority_level as string | null,
    roleConfidence: raw.role_confidence as number | null,
    avgResponseTimeMinutes: raw.avg_response_time_minutes as number | null,
    responseRate: raw.response_rate as number | null,
    avgWordsPerMessage: raw.avg_words_per_message as number | null,
    communicationProfile: raw.communication_profile as Record<string, unknown> | null,
    influenceScore: raw.influence_score as number | null,
    bridgingScore: raw.bridging_score as number | null,
    communityIds: (raw.community_ids as string[]) ?? [],
    contactBrief: raw.contact_brief as string | null,
    riskReason: raw.risk_reason as string | null,
    notes: raw.notes as string | null,
    lastIntelligenceAt: raw.last_intelligence_at as string | null,
    intelligenceVersion: raw.intelligence_version as number | null,
    firstInteractionAt: raw.first_interaction_at as string | null,
    createdAt: raw.created_at as string | null,
    updatedAt: raw.updated_at as string | null,
  };
}

function transformContactStats(raw: Record<string, unknown>): ContactStats {
  return {
    totalContacts: (raw.total_contacts as number) ?? 0,
    vipCount: (raw.vip_count as number) ?? 0,
    atRiskCount: (raw.at_risk_count as number) ?? 0,
    internalCount: (raw.internal_count as number) ?? 0,
    newThisWeek: (raw.new_this_week as number) ?? 0,
    avgHealthScore: raw.avg_health_score as number | null,
  };
}

function transformMeetingBrief(raw: Record<string, unknown>): MeetingBrief {
  return {
    contactId: raw.contact_id as string,
    contactName: raw.contact_name as string | null,
    brief: raw.brief as string,
    talkingPoints: (raw.talking_points as string[]) ?? [],
    openCommitments: (raw.open_commitments as string[]) ?? [],
    pendingDecisions: (raw.pending_decisions as string[]) ?? [],
    generatedAt: raw.generated_at as string,
  };
}

export const contactsAPI = {
  /**
   * List contacts with optional filters
   */
  async list(params: {
    organizationId: string;
    limit?: number;
    offset?: number;
    isVip?: boolean;
    isAtRisk?: boolean;
    sortBy?: "importance_score" | "health_score" | "last_interaction_at" | "display_name";
    sortOrder?: "asc" | "desc";
  }): Promise<ContactListResponse> {
    const searchParams = new URLSearchParams({
      organization_id: params.organizationId,
      limit: String(params.limit ?? 50),
      offset: String(params.offset ?? 0),
      sort_by: params.sortBy ?? "importance_score",
      sort_order: params.sortOrder ?? "desc",
    });
    if (params.isVip !== undefined) {
      searchParams.set("is_vip", String(params.isVip));
    }
    if (params.isAtRisk !== undefined) {
      searchParams.set("is_at_risk", String(params.isAtRisk));
    }
    const raw = await apiFetch<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/contacts?${searchParams.toString()}`
    );
    return {
      items: raw.items.map(transformContactSummary),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  },

  /**
   * Get contact statistics
   */
  async getStats(organizationId: string): Promise<ContactStats> {
    const raw = await apiFetch<Record<string, unknown>>(
      `/contacts/stats?organization_id=${organizationId}`
    );
    return transformContactStats(raw);
  },

  /**
   * Get VIP contacts
   */
  async getVips(params: { organizationId: string; limit?: number }): Promise<ContactListResponse> {
    const raw = await apiFetch<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/contacts/vips?organization_id=${params.organizationId}&limit=${params.limit ?? 50}`
    );
    return {
      items: raw.items.map(transformContactSummary),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  },

  /**
   * Get at-risk contacts
   */
  async getAtRisk(params: { organizationId: string; limit?: number }): Promise<ContactListResponse> {
    const raw = await apiFetch<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/contacts/at-risk?organization_id=${params.organizationId}&limit=${params.limit ?? 50}`
    );
    return {
      items: raw.items.map(transformContactSummary),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  },

  /**
   * Search contacts
   */
  async search(params: { organizationId: string; query: string; limit?: number }): Promise<ContactListResponse> {
    const raw = await apiFetch<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }>(
      `/contacts/search?organization_id=${params.organizationId}&query=${encodeURIComponent(params.query)}&limit=${params.limit ?? 20}`
    );
    return {
      items: raw.items.map(transformContactSummary),
      total: raw.total,
      limit: raw.limit,
      offset: raw.offset,
    };
  },

  /**
   * Get contact details
   */
  async get(contactId: string, organizationId: string): Promise<ContactDetail> {
    const raw = await apiFetch<Record<string, unknown>>(
      `/contacts/${contactId}?organization_id=${organizationId}`
    );
    return transformContactDetail(raw);
  },

  /**
   * Toggle VIP status
   */
  async toggleVip(contactId: string, organizationId: string, isVip: boolean): Promise<{ success: boolean; isVip: boolean }> {
    const raw = await apiFetch<{ success: boolean; is_vip: boolean }>(
      `/contacts/${contactId}/toggle-vip?organization_id=${organizationId}`,
      {
        method: "POST",
        body: JSON.stringify({ is_vip: isVip }),
      }
    );
    return { success: raw.success, isVip: raw.is_vip };
  },

  /**
   * Trigger contact intelligence analysis
   */
  async analyze(contactId: string, organizationId: string): Promise<{ success: boolean; analysisId: string }> {
    const raw = await apiFetch<{ success: boolean; analysis_id: string }>(
      `/contacts/${contactId}/analyze?organization_id=${organizationId}`,
      { method: "POST" }
    );
    return { success: raw.success, analysisId: raw.analysis_id };
  },

  /**
   * Generate meeting brief
   */
  async generateMeetingBrief(contactId: string, organizationId: string): Promise<MeetingBrief> {
    const raw = await apiFetch<Record<string, unknown>>(
      `/contacts/${contactId}/meeting-brief?organization_id=${organizationId}`,
      { method: "POST" }
    );
    return transformMeetingBrief(raw);
  },

  async listMergeSuggestions(params: {
    organizationId: string;
    minConfidence?: number;
    limit?: number;
  }): Promise<ContactMergeSuggestion[]> {
    const searchParams = new URLSearchParams({
      organization_id: params.organizationId,
      min_confidence: String(params.minConfidence ?? 0.7),
      limit: String(params.limit ?? 50),
    });
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/contacts/merge-suggestions?${searchParams.toString()}`
    );
    return raw.map((item) => ({
      contactAId: item.contact_a_id as string,
      contactAName: (item.contact_a_name as string) ?? null,
      contactAEmail: (item.contact_a_email as string) ?? null,
      contactBId: item.contact_b_id as string,
      contactBName: (item.contact_b_name as string) ?? null,
      contactBEmail: (item.contact_b_email as string) ?? null,
      confidence: item.confidence as number,
      matchReasons: (item.match_reasons as string[]) ?? [],
    }));
  },

  async mergeContacts(params: {
    organizationId: string;
    sourceContactId: string;
    targetContactId: string;
    reason?: string;
  }): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/contacts/merge?organization_id=${params.organizationId}`, {
      method: "POST",
      body: JSON.stringify({
        source_contact_id: params.sourceContactId,
        target_contact_id: params.targetContactId,
        reason: params.reason,
      }),
    });
  },

  async exportIdentityAudit(params: {
    organizationId: string;
    contactId?: string;
  }): Promise<ContactIdentityRecord[]> {
    const searchParams = new URLSearchParams({
      organization_id: params.organizationId,
    });
    if (params.contactId) {
      searchParams.set("contact_id", params.contactId);
    }
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/contacts/identities/audit?${searchParams.toString()}`
    );
    return raw.map((item) => ({
      id: item.id as string,
      identityType: item.identity_type as string,
      identityValue: item.identity_value as string,
      confidence: item.confidence as number,
      isVerified: (item.is_verified as boolean) ?? false,
      source: (item.source as string) ?? null,
      sourceAccountId: (item.source_account_id as string) ?? null,
      lastSeenAt: (item.last_seen_at as string) ?? null,
      createdAt: (item.created_at as string) ?? null,
      updatedAt: (item.updated_at as string) ?? null,
    }));
  },
};

// =============================================================================
// CUSTOMER CONTEXT API
// =============================================================================

export interface CustomerCommitment {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  direction: string;
  dueDate: string | null;
  confidence: number;
}

export interface CustomerDecision {
  id: string;
  title: string;
  statement: string | null;
  status: string;
  decidedAt: string | null;
}

export interface CustomerContact {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  interactionCount: number;
}

export interface CustomerTimelineEvent {
  id: string;
  eventType: string;
  title: string;
  summary: string | null;
  sourceType: string | null;
  timestamp: string | null;
  participants: string[];
}

export interface CustomerContext {
  contactId: string;
  email: string | null;
  name: string | null;
  company: string | null;
  title: string | null;
  interactionCount: number;
  lastInteraction: string | null;
  relationshipHealth: number;
  sourceTypes: string[];
  openCommitments: CustomerCommitment[];
  relatedDecisions: CustomerDecision[];
  topContacts: CustomerContact[];
  topTopics: string[];
  timeline: CustomerTimelineEvent[];
  relationshipSummary: string | null;
}

export interface CustomerTimeline {
  contactId: string;
  events: CustomerTimelineEvent[];
  total: number;
}

export interface RelationshipHealth {
  contactId: string;
  healthScore: number;
  factors: Record<string, unknown>;
}

function transformCustomerCommitment(raw: Record<string, unknown>): CustomerCommitment {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? "Untitled",
    status: (raw.status as string) ?? "open",
    priority: (raw.priority as string | null) ?? null,
    direction: (raw.direction as string) ?? "unknown",
    dueDate: (raw.due_date as string | null) ?? null,
    confidence: (raw.confidence as number) ?? 0,
  };
}

function transformCustomerDecision(raw: Record<string, unknown>): CustomerDecision {
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? "Untitled",
    statement: (raw.statement as string | null) ?? null,
    status: (raw.status as string) ?? "active",
    decidedAt: (raw.decided_at as string | null) ?? null,
  };
}

function transformCustomerContact(raw: Record<string, unknown>): CustomerContact {
  return {
    id: raw.id as string,
    email: (raw.email as string | null) ?? null,
    name: (raw.name as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
    interactionCount: (raw.interaction_count as number) ?? 0,
  };
}

function transformCustomerTimelineEvent(raw: Record<string, unknown>): CustomerTimelineEvent {
  return {
    id: raw.id as string,
    eventType: (raw.event_type as string) ?? "event",
    title: (raw.title as string) ?? "Event",
    summary: (raw.summary as string | null) ?? null,
    sourceType: (raw.source_type as string | null) ?? null,
    timestamp: (raw.reference_time as string | null) ?? null,
    participants: (raw.participants as string[] | null) ?? [],
  };
}

function transformCustomerContext(raw: Record<string, unknown>): CustomerContext {
  return {
    contactId: raw.contact_id as string,
    email: (raw.email as string | null) ?? null,
    name: (raw.name as string | null) ?? null,
    company: (raw.company as string | null) ?? null,
    title: (raw.title as string | null) ?? null,
    interactionCount: (raw.interaction_count as number) ?? 0,
    lastInteraction: (raw.last_interaction as string | null) ?? null,
    relationshipHealth: (raw.relationship_health as number) ?? 1,
    sourceTypes: (raw.source_types as string[] | null) ?? [],
    openCommitments: (raw.open_commitments as Record<string, unknown>[] | null)
      ? (raw.open_commitments as Record<string, unknown>[]).map(transformCustomerCommitment)
      : [],
    relatedDecisions: (raw.related_decisions as Record<string, unknown>[] | null)
      ? (raw.related_decisions as Record<string, unknown>[]).map(transformCustomerDecision)
      : [],
    topContacts: (raw.top_contacts as Record<string, unknown>[] | null)
      ? (raw.top_contacts as Record<string, unknown>[]).map(transformCustomerContact)
      : [],
    topTopics: (raw.top_topics as string[] | null) ?? [],
    timeline: (raw.timeline as Record<string, unknown>[] | null)
      ? (raw.timeline as Record<string, unknown>[]).map(transformCustomerTimelineEvent)
      : [],
    relationshipSummary: (raw.relationship_summary as string | null) ?? null,
  };
}

export const customerAPI = {
  async getContext(params: {
    organizationId: string;
    contactId?: string;
    email?: string;
    includeTimeline?: boolean;
    maxTimelineItems?: number;
  }): Promise<CustomerContext> {
    const raw = await apiFetch<Record<string, unknown>>("/customer/context", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        contact_id: params.contactId ?? null,
        email: params.email ?? null,
        include_timeline: params.includeTimeline ?? true,
        max_timeline_items: params.maxTimelineItems ?? 50,
      }),
    });
    return transformCustomerContext(raw);
  },

  async getTimeline(params: {
    organizationId: string;
    contactId: string;
    limit?: number;
  }): Promise<CustomerTimeline> {
    const raw = await apiFetch<{ contact_id: string; events: Record<string, unknown>[]; total: number }>(
      `/customer/timeline/${params.contactId}?organization_id=${params.organizationId}&limit=${params.limit ?? 50}`
    );
    return {
      contactId: raw.contact_id,
      events: raw.events.map(transformCustomerTimelineEvent),
      total: raw.total,
    };
  },

  async getRelationshipHealth(params: {
    organizationId: string;
    contactId: string;
  }): Promise<RelationshipHealth> {
    const raw = await apiFetch<Record<string, unknown>>(
      `/customer/health/${params.contactId}?organization_id=${params.organizationId}`
    );
    return {
      contactId: raw.contact_id as string,
      healthScore: (raw.health_score as number) ?? 0,
      factors: (raw.factors as Record<string, unknown> | null) ?? {},
    };
  },
};

// =============================================================================
// CONTINUUMS API
// =============================================================================

export interface ContinuumSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currentVersion: number | null;
  activeVersion: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  nextRunAt: string | null;
}

export interface ContinuumRun {
  id: string;
  status: string;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface ContinuumCreateResponse {
  id: string;
  version: number;
  status: string;
  next_run_at: string | null;
}

export interface ContinuumPreview {
  continuum_id: string;
  name: string;
  goal: string;
  schedule: Record<string, unknown>;
  expected_actions: string[];
  proof_requirements: Record<string, unknown>[];
  risk_snapshot: {
    open_commitments: number;
    overdue_commitments: number;
    at_risk_commitments: number;
    risk_score: number;
    risk_outlook: string;
  };
}

function transformContinuumSummary(raw: Record<string, unknown>): ContinuumSummary {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string | null) ?? null,
    status: raw.status as string,
    currentVersion: (raw.current_version as number | null) ?? null,
    activeVersion: (raw.active_version as number | null) ?? null,
    createdAt: (raw.created_at as string | null) ?? null,
    updatedAt: (raw.updated_at as string | null) ?? null,
    nextRunAt: (raw.next_run_at as string | null) ?? null,
  };
}

function transformContinuumRun(raw: Record<string, unknown>): ContinuumRun {
  return {
    id: raw.id as string,
    status: raw.status as string,
    version: (raw.version as number) ?? 0,
    startedAt: (raw.started_at as string | null) ?? null,
    completedAt: (raw.completed_at as string | null) ?? null,
    errorMessage: (raw.error_message as string | null) ?? null,
  };
}

export const continuumsAPI = {
  async list(organizationId: string): Promise<ContinuumSummary[]> {
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/continuums?organization_id=${organizationId}`
    );
    return raw.map(transformContinuumSummary);
  },

  async create(params: {
    organizationId: string;
    definition: Record<string, unknown>;
    activate?: boolean;
    createdBy?: string;
  }): Promise<ContinuumCreateResponse> {
    return apiFetch<ContinuumCreateResponse>("/continuums", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        definition: params.definition,
        activate: params.activate ?? false,
        created_by: params.createdBy ?? null,
      }),
    });
  },

  async addVersion(params: {
    continuumId: string;
    organizationId: string;
    definition: Record<string, unknown>;
    activate?: boolean;
    createdBy?: string;
  }) {
    return apiFetch<Record<string, unknown>>(
      `/continuums/${params.continuumId}/versions`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          definition: params.definition,
          activate: params.activate ?? false,
          created_by: params.createdBy ?? null,
        }),
      }
    );
  },

  async activate(params: { continuumId: string; organizationId: string }) {
    return apiFetch<Record<string, unknown>>(
      `/continuums/${params.continuumId}/activate`,
      {
        method: "POST",
        body: JSON.stringify({ organization_id: params.organizationId }),
      }
    );
  },

  async pause(params: { continuumId: string; organizationId: string }) {
    return apiFetch<Record<string, unknown>>(
      `/continuums/${params.continuumId}/pause`,
      {
        method: "POST",
        body: JSON.stringify({ organization_id: params.organizationId }),
      }
    );
  },

  async run(params: {
    continuumId: string;
    organizationId: string;
    triggeredBy?: string;
  }) {
    return apiFetch<Record<string, unknown>>(
      `/continuums/${params.continuumId}/run`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          triggered_by: params.triggeredBy ?? "manual",
        }),
      }
    );
  },

  async rollback(params: {
    continuumId: string;
    organizationId: string;
    targetVersion?: number;
    triggeredBy?: string;
  }) {
    return apiFetch<Record<string, unknown>>(
      `/continuums/${params.continuumId}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          target_version: params.targetVersion ?? null,
          triggered_by: params.triggeredBy ?? null,
        }),
      }
    );
  },

  async preview(params: {
    continuumId: string;
    organizationId: string;
    horizonDays?: number;
  }): Promise<ContinuumPreview> {
    return apiFetch<ContinuumPreview>(
      `/continuums/${params.continuumId}/preview`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          horizon_days: params.horizonDays ?? 30,
        }),
      }
    );
  },

  async getRuns(params: { continuumId: string; organizationId: string }): Promise<ContinuumRun[]> {
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/continuums/${params.continuumId}/runs?organization_id=${params.organizationId}`
    );
    return raw.map(transformContinuumRun);
  },
};

// =============================================================================
// CONTINUUM EXCHANGE API
// =============================================================================

export interface ContinuumBundle {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  visibility: string;
  governanceStatus: string;
  priceCents: number | null;
  currency: string | null;
  billingModel: string | null;
  version: string;
  manifest: Record<string, unknown>;
  signature: string;
}

function transformBundle(raw: Record<string, unknown>): ContinuumBundle {
  return {
    id: raw.id as string,
    name: raw.name as string,
    description: (raw.description as string | null) ?? null,
    organizationId: raw.organization_id as string,
    visibility: raw.visibility as string,
    governanceStatus: raw.governance_status as string,
    priceCents: (raw.price_cents as number | null) ?? null,
    currency: (raw.currency as string | null) ?? null,
    billingModel: (raw.billing_model as string | null) ?? null,
    version: raw.version as string,
    manifest: (raw.manifest as Record<string, unknown>) ?? {},
    signature: raw.signature as string,
  };
}

export const continuumExchangeAPI = {
  async list(params: {
    organizationId: string;
    visibility?: string;
    governanceStatus?: string;
  }): Promise<ContinuumBundle[]> {
    const search = new URLSearchParams({
      organization_id: params.organizationId,
    });
    if (params.visibility) {
      search.set("visibility", params.visibility);
    }
    if (params.governanceStatus) {
      search.set("governance_status", params.governanceStatus);
    }
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/continuum-exchange/bundles?${search.toString()}`
    );
    return raw.map(transformBundle);
  },

  async publish(params: {
    organizationId: string;
    manifest: Record<string, unknown>;
    signature?: string | null;
    createdBy?: string | null;
    visibility?: "private" | "public" | "curated";
    governanceStatus?: "pending" | "approved" | "rejected";
    priceCents?: number | null;
    currency?: string | null;
    billingModel?: "one_time" | "subscription" | "usage" | null;
  }) {
    return apiFetch<{ bundle_id: string; version: string; signature: string }>(
      "/continuum-exchange/bundles/publish",
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          manifest: params.manifest,
          signature: params.signature ?? null,
          created_by: params.createdBy ?? null,
          visibility: params.visibility ?? "private",
          governance_status: params.governanceStatus ?? "pending",
          price_cents: params.priceCents ?? null,
          currency: params.currency ?? null,
          billing_model: params.billingModel ?? null,
        }),
      }
    );
  },

  async install(params: {
    organizationId: string;
    bundleId: string;
    version?: string | null;
    installedBy?: string | null;
  }) {
    return apiFetch<Record<string, unknown>>(
      `/continuum-exchange/bundles/${params.bundleId}/install`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          version: params.version ?? null,
          installed_by: params.installedBy ?? null,
        }),
      }
    );
  },

  async updateGovernance(params: {
    organizationId: string;
    bundleId: string;
    governanceStatus: "pending" | "approved" | "rejected";
  }) {
    return apiFetch<Record<string, unknown>>(
      `/continuum-exchange/bundles/${params.bundleId}/governance`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          governance_status: params.governanceStatus,
        }),
      }
    );
  },
};

// =============================================================================
// SIMULATION API
// =============================================================================

export interface SimulationOverridePayload {
  commitment_delays?: Record<string, number>;
  commitment_cancellations?: string[];
}

export interface SimulationSnapshot {
  open_commitments: number;
  overdue_commitments: number;
  at_risk_commitments: number;
  risk_score: number;
  risk_outlook: string;
}

export interface SimulationSensitivity {
  commitment_id: string;
  change_type: "delay" | "cancel";
  delta_risk_score: number;
  delta_overdue: number;
}

export interface SimulationResult {
  simulation_id: string;
  scenario_name: string;
  baseline: SimulationSnapshot;
  simulated: SimulationSnapshot;
  delta: Record<string, unknown>;
  sensitivity: SimulationSensitivity[];
  narrative: string;
}

export const simulationsAPI = {
  async run(params: {
    organizationId: string;
    scenarioName?: string;
    horizonDays?: number;
    overrides?: SimulationOverridePayload;
  }): Promise<SimulationResult> {
    return apiFetch<SimulationResult>("/simulations/run", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        scenario_name: params.scenarioName ?? "what_if",
        horizon_days: params.horizonDays ?? 30,
        overrides: params.overrides ?? {},
      }),
    });
  },

  async history(params: { organizationId: string; limit?: number }) {
    const search = new URLSearchParams({
      organization_id: params.organizationId,
      limit: String(params.limit ?? 50),
    });
    return apiFetch<Record<string, unknown>[]>(`/simulations/history?${search.toString()}`);
  },
};

// =============================================================================
// ACTUATIONS API
// =============================================================================

export interface ActuationRecordSummary {
  id: string;
  driver: string;
  actionType: string;
  tier: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function transformActuationSummary(raw: Record<string, unknown>): ActuationRecordSummary {
  return {
    id: raw.id as string,
    driver: raw.driver as string,
    actionType: raw.action_type as string,
    tier: raw.tier as string,
    status: raw.status as string,
    createdAt: (raw.created_at as string | null) ?? null,
    updatedAt: (raw.updated_at as string | null) ?? null,
  };
}

export const actuationsAPI = {
  async listDrivers(): Promise<string[]> {
    const raw = await apiFetch<{ drivers: string[] }>("/actuations/drivers");
    return raw.drivers;
  },

  async list(organizationId: string): Promise<ActuationRecordSummary[]> {
    const raw = await apiFetch<Record<string, unknown>[]>(
      `/actuations?organization_id=${organizationId}`
    );
    return raw.map(transformActuationSummary);
  },

  async run(params: {
    organizationId: string;
    driver: string;
    action: string;
    payload?: Record<string, unknown>;
    tier?: string;
    policyContext?: Record<string, unknown>;
    actorId?: string | null;
    approvalBy?: string | null;
    approvalReason?: string | null;
    mode?: "draft" | "stage" | "execute";
    actionId?: string | null;
    forceExecute?: boolean;
  }) {
    return apiFetch<Record<string, unknown>>("/actuations", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        driver: params.driver,
        action: params.action,
        payload: params.payload ?? {},
        tier: params.tier ?? null,
        policy_context: params.policyContext ?? null,
        actor_id: params.actorId ?? null,
        approval_by: params.approvalBy ?? null,
        approval_reason: params.approvalReason ?? null,
        force_execute: params.forceExecute ?? false,
        mode: params.mode ?? "execute",
        action_id: params.actionId ?? null,
      }),
    });
  },

  async approve(params: {
    organizationId: string;
    actionId: string;
    actorId?: string | null;
    approvalBy?: string | null;
    approvalReason?: string | null;
  }) {
    return apiFetch<Record<string, unknown>>(
      `/actuations/${params.actionId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          actor_id: params.actorId ?? null,
          approval_by: params.approvalBy ?? null,
          approval_reason: params.approvalReason ?? null,
        }),
      }
    );
  },

  async rollback(params: { organizationId: string; actionId: string; actorId?: string | null }) {
    return apiFetch<Record<string, unknown>>(
      `/actuations/${params.actionId}/rollback`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          actor_id: params.actorId ?? null,
        }),
      }
    );
  },
};

// =============================================================================
// TRUST + AUDIT API
// =============================================================================

export interface TrustIndicator {
  uio_id: string;
  trust_score: number;
  confidence: number;
  belief_state: string | null;
  truth_state: string | null;
  last_update_reason: string | null;
  last_updated_at: string | null;
  evidence_count: number;
  evidence: Array<Record<string, unknown>>;
  confidence_reasoning: string[];
}

export const trustAPI = {
  async getIndicators(params: {
    organizationId: string;
    uioIds: string[];
    evidenceLimit?: number;
  }): Promise<TrustIndicator[]> {
    return apiFetch<TrustIndicator[]>("/trust/uios", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        uio_ids: params.uioIds,
        evidence_limit: params.evidenceLimit ?? 3,
      }),
    });
  },
};

export const auditAPI = {
  async verifyLedger(organizationId: string) {
    return apiFetch<Record<string, unknown>>(
      `/audit/verify?organization_id=${organizationId}`
    );
  },
};

// =============================================================================
// HEALTH API
// =============================================================================

export const healthAPI = {
  async ping(): Promise<Record<string, unknown>> {
    const url = buildHealthUrl();
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const requestId = res.headers.get("X-Request-ID") ?? undefined;
        throw new APIError(
          "Health check failed (GET /health).",
          res.status,
          res.status >= 500 ? "SERVER_ERROR" : "UNKNOWN_ERROR",
          res.statusText,
          "/health",
          "GET",
          requestId,
          url
        );
      }
      const data = (await res.json()) as Record<string, unknown>;
      markApiReachable();
      return data;
    } catch (error) {
      markApiUnreachable(error);
      if (error instanceof Error) {
        throw error;
      }
      throw new APIError(
        "Drovi API unreachable (GET /health).",
        0,
        "API_UNREACHABLE",
        "Network error",
        "/health",
        "GET",
        undefined,
        url
      );
    }
  },
};

// =============================================================================
// GRAPH API
// =============================================================================

export interface GraphQueryResponse {
  success: boolean;
  results: Array<Record<string, unknown>>;
  count: number;
}

export const graphAPI = {
  async query(params: {
    organizationId: string;
    cypher: string;
    params?: Record<string, unknown>;
  }): Promise<GraphQueryResponse> {
    return apiFetch<GraphQueryResponse>("/graph/query", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        cypher: params.cypher,
        params: params.params ?? {},
      }),
    });
  },

  async stats(organizationId: string): Promise<Record<string, unknown>> {
    return apiFetch<Record<string, unknown>>(
      `/graph/stats?organization_id=${organizationId}`
    );
  },
};

// =============================================================================
// CHANGES API (Reality Stream)
// =============================================================================

export interface ChangeRecord {
  entity_id: string;
  entity_type: string;
  change_type: string;
  version: number;
  timestamp: string;
  changed_by: string | null;
  change_reason: string | null;
  diff?: {
    change_summary: string;
    changes: Array<{
      field_name: string;
      change_type: string;
      old_value: unknown;
      new_value: unknown;
    }>;
  } | null;
}

export const changesAPI = {
  async list(params: {
    organizationId: string;
    since?: string;
    until?: string;
    entityTypes?: string[];
    limit?: number;
  }) {
    const search = new URLSearchParams({
      organization_id: params.organizationId,
      limit: String(params.limit ?? 100),
    });
    if (params.since) {
      search.set("since", params.since);
    }
    if (params.until) {
      search.set("until", params.until);
    }
    if (params.entityTypes?.length) {
      search.set("entity_types", params.entityTypes.join(","));
    }
    return apiFetch<{ changes: ChangeRecord[]; total_count: number; since: string; until: string }>(
      `/changes?${search.toString()}`
    );
  },
};

// =============================================================================
// PATTERNS API
// =============================================================================

export interface PatternCandidate {
  id: string;
  organization_id: string;
  candidate_type: string;
  member_count: number;
  member_ids: string[];
  sample_titles: string[];
  top_terms: string[];
  confidence_boost: number;
  updated_at: string;
}

export const patternsAPI = {
  async listCandidates(organizationId: string): Promise<PatternCandidate[]> {
    const raw = await apiFetch<PatternCandidate[]>(
      `/patterns/candidates?organization_id=${organizationId}`
    );
    return raw;
  },

  async discoverCandidates(params: {
    organizationId: string;
    minClusterSize?: number;
    similarityThreshold?: number;
    maxNodes?: number;
  }): Promise<PatternCandidate[]> {
    return apiFetch<PatternCandidate[]>("/patterns/candidates/discover", {
      method: "POST",
      body: JSON.stringify({
        organization_id: params.organizationId,
        min_cluster_size: params.minClusterSize ?? 3,
        similarity_threshold: params.similarityThreshold ?? 0.85,
        max_nodes: params.maxNodes ?? 500,
      }),
    });
  },

  async promoteCandidate(params: {
    organizationId: string;
    candidateId: string;
    name?: string;
    description?: string;
    typicalAction?: string;
    confidenceBoost?: number;
    domain?: string;
  }) {
    return apiFetch<{ pattern_id: string; promoted: boolean }>(
      `/patterns/candidates/${params.candidateId}/promote`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          name: params.name,
          description: params.description,
          typical_action: params.typicalAction,
          confidence_boost: params.confidenceBoost,
          domain: params.domain,
        }),
      }
    );
  },
};

// =============================================================================
// SUPPORT API
// =============================================================================

export interface SupportTicketCreated {
  ticket_id: string;
  status: string;
  created_at: string;
}

export const supportAPI = {
  async createTicket(params: {
    subject: string;
    message: string;
    messageHtml?: string;
    route?: string;
    locale?: string;
    diagnostics?: Record<string, unknown>;
  }): Promise<SupportTicketCreated> {
    return apiFetch<SupportTicketCreated>("/support/tickets", {
      method: "POST",
      body: JSON.stringify({
        subject: params.subject,
        message: params.message,
        message_html: params.messageHtml,
        route: params.route,
        locale: params.locale,
        diagnostics: params.diagnostics ?? {},
      }),
    });
  },
};

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export const api = {
  auth: authAPI,
  connections: connectionsAPI,
  intelligence: intelligenceAPI,
  ask: askAPI,
  search: searchAPI,
  brief: briefAPI,
  sse: sseAPI,
  org: orgAPI,
  orgSSE: orgSSE,
  contacts: contactsAPI,
  customer: customerAPI,
  support: supportAPI,
};

export default api;
