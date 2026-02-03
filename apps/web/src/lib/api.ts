/**
 * API Client for Python Backend
 *
 * Handles all communication with the drovi-intelligence FastAPI backend.
 * Uses cookie-based session auth (httpOnly cookies set by /auth/callback).
 */

import { env } from "@memorystack/env/web";

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
  expires_at: string | null;
  created_at: string | null;
  member_count: number;
  connection_count: number;
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

export interface AskResponse {
  answer: string;
  evidence: Evidence[];
  confidence: number;
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

// API Error class
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
    this.name = "APIError";
  }
}

// API Base URL from environment
const API_BASE = env.VITE_SERVER_URL;

/**
 * Core fetch wrapper with error handling
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}/api/v1${path}`;

  const res = await fetch(url, {
    ...options,
    credentials: "include", // Include cookies for session auth
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const errorBody = await res.json();
      detail = errorBody.detail || errorBody.message;
    } catch {
      detail = res.statusText;
    }
    throw new APIError(
      detail || `API Error: ${res.status}`,
      res.status,
      detail
    );
  }

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
   * Initiate OAuth login flow
   * Returns URL to redirect user to for authentication
   */
  async login(provider = "google"): Promise<LoginResponse> {
    return apiFetch<LoginResponse>(`/auth/login?provider=${provider}`);
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
    const redirectUri = `${API_BASE}/api/v1/auth/callback`;
    return apiFetch<OAuthInitResponse>("/connections/oauth/init", {
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
  async ask(query: string): Promise<AskResponse> {
    return apiFetch<AskResponse>("/ask", {
      method: "POST",
      body: JSON.stringify({ query }),
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
      `${API_BASE}/api/v1/sse/sync/${connectionId}`,
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
      `${API_BASE}/api/v1/sse/intelligence`,
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
      restrictedLabels?: string[];
      restrictedChannels?: string[];
    }
  ): Promise<ConnectResponse> {
    const redirectUri = `${API_BASE}/api/v1/auth/callback`;
    return apiFetch<ConnectResponse>(
      `/org/connections/${provider}/connect`,
      {
        method: "POST",
        body: JSON.stringify({
          redirect_uri: redirectUri,
          restricted_labels: options?.restrictedLabels || [],
          restricted_channels: options?.restrictedChannels || [],
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

  /**
   * Delete a connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await apiFetch<void>(`/org/connections/${connectionId}`, {
      method: "DELETE",
    });
  },

  /**
   * Get organization info
   */
  async getOrgInfo(): Promise<OrgInfo> {
    return apiFetch<OrgInfo>("/org/info");
  },
};

// =============================================================================
// SSE for ORG (Cookie Auth)
// =============================================================================

export interface SyncEvent {
  event_type: "started" | "progress" | "completed" | "failed";
  connection_id: string;
  records_synced?: number;
  total_records?: number;
  error?: string;
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
      `${API_BASE}/api/v1/org/connections/events`,
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
};

export default api;
