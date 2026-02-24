/**
 * Web API facade (Drovi Intelligence).
 *
 * Phase 7 goal:
 * - Keep app call sites stable (`@/lib/api` exports) while moving the
 *   implementation to the generated/shared API packages.
 * - Shrink this file to a thin shim under the LOC budget.
 */

import {
  ApiError as APIError,
  ApiClient,
  type ApiErrorPayload,
  apiErrorFromHttp,
  apiErrorUnreachable,
  createSupportApi,
} from "@memorystack/api-client";
import {
  createActuationsApi,
  createAgentsApi,
  createAskApi,
  createAuditApi,
  createAuthApi,
  createBriefApi,
  createChangesApi,
  createConnectionsApi,
  createContactsApi,
  createContentApi,
  createCustomerApi,
  createDocumentsApi,
  createGraphApi,
  createIntelligenceApi,
  createOrgApi,
  createOrgSecurityApi,
  createPatternsApi,
  createSearchApi,
  createSimulationsApi,
  createTrustApi,
  type SyncEvent,
  type SyncStatus,
} from "@memorystack/api-client/web";
import {
  subscribeNamedJsonEvents,
} from "@memorystack/api-react";
import { env } from "@memorystack/env/web";

import { markApiReachable, markApiUnreachable } from "./api-reachability";
import { recordApiTrace } from "./api-trace";
import { getSessionToken } from "./session-token";

export { APIError };

export type {
  ActuationRecordSummary,
  AskResponse,
  ChangeRecord,
  CommitmentFollowUpDraft,
  DecisionSupersessionChain,
  ContactSummary,
  ContentSearchResult,
  DriveDocument,
  DriveDocumentChunk,
  DriveDocumentChunkDetail,
  DriveSearchHit,
  EvidenceArtifact,
  OrgConnection,
  OrgInfo,
  OrgInvite,
  OrgMember,
  OrgSecurityPolicy,
  PatternCandidate,
  SearchResult,
  SimulationOverridePayload,
  SimulationResult,
  SyncEvent,
  TrustIndicator,
  UIO,
  UIOComment,
  UIOListResponse,
  User,
} from "@memorystack/api-client/web";

export interface WorldBrainTapeEvent {
  event_id: string;
  lane: "internal" | "external" | "bridge" | string;
  delta_domain: string;
  severity: "critical" | "high" | "medium" | "low" | string;
  confidence: number;
  uncertainty_score?: number;
  calibration_bucket?: string;
  contradiction_confidence?: number;
  source_reliability?: {
    source_key?: string | null;
    score?: number | null;
    band?: "high" | "medium" | "low" | "unknown" | string;
    corroboration_rate?: number | null;
    false_positive_rate?: number | null;
    last_evaluated_at?: string | null;
  };
  summary: string;
  title?: string | null;
  occurred_at?: string | null;
  entity_refs?: string[];
  impact_bridge?: Record<string, unknown>;
  proof_bundle?: {
    bundle_id?: string;
    citations?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WorldBrainTapeResponse {
  success: boolean;
  count: number;
  items: WorldBrainTapeEvent[];
}

export interface WorldBrainTapeLiveContractResponse {
  success: boolean;
  contract: {
    organization_id: string;
    lanes: {
      internal: WorldBrainTapeEvent[];
      external: WorldBrainTapeEvent[];
      bridge: WorldBrainTapeEvent[];
      world_pressure: Array<{
        entity_id: string;
        pressure_score: number;
        tier: string;
      }>;
    };
    visualization_contract: Record<string, unknown>;
    filters: Record<string, unknown>;
  };
}

export interface WorldBrainProofCitation {
  kind?: string;
  ref_id?: string;
  [key: string]: unknown;
}

export interface WorldBrainTapeProofBundle {
  bundle_id?: string;
  citations?: WorldBrainProofCitation[];
  timeline?: Array<Record<string, unknown>>;
  confidence_reasoning?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorldBrainTapeEventDetailResponse {
  success: boolean;
  event: WorldBrainTapeEvent;
  proof_bundle: WorldBrainTapeProofBundle;
  redaction_applied?: boolean;
}

export interface WorldBrainObligationDashboardResponse {
  success: boolean;
  dashboard: {
    summary: {
      active_constraints: number;
      total_signals: number;
      pre_breach_warnings: number;
      post_breach_open: number;
      severity_counts: Record<string, number>;
    };
    pre_breach: WorldBrainObligationSignal[];
    post_breach: WorldBrainObligationSignal[];
    workflows: {
      pre_breach?: string[];
      post_breach?: string[];
      [key: string]: string[] | undefined;
    };
    generated_at: string;
  };
}

export interface WorldBrainObligationSignal {
  id: string;
  status?: string;
  severity?: string;
  constraint_title?: string;
  constraint_id?: string;
  confidence?: number;
  uncertainty_score?: number;
  source_reliability?: {
    score?: number | null;
    band?: "high" | "medium" | "low" | "unknown" | string;
  };
  occurred_at?: string;
  [key: string]: unknown;
}

export interface WorldBrainObligationTriageResponse {
  success: boolean;
  triage: {
    violation_id: string;
    action: "acknowledge" | "escalate" | "resolve" | "simulate_impact" | string;
    status: string;
    severity: string;
    recommended_steps: string[];
    notes?: string | null;
    counterfactual_preview?: {
      simulation_id: string;
      risk_score: number;
      downside_risk_estimate: number;
      utility_delta: number;
    } | null;
    generated_at: string;
  };
  explainability?: Record<string, unknown>;
}

export interface WorldBrainCounterfactualScenario {
  simulation_id?: string;
  scenario_name?: string;
  simulated?: {
    risk_score?: number;
    [key: string]: unknown;
  };
  utility?: {
    simulated_utility?: number;
    utility_delta?: number;
    [key: string]: unknown;
  };
  downside_risk_estimate?: number;
  [key: string]: unknown;
}

export interface WorldBrainCounterfactualComparison {
  preferred: "a" | "b" | "tie" | string;
  score_a: number;
  score_b: number;
  delta: number;
  scenario_a: WorldBrainCounterfactualScenario;
  scenario_b: WorldBrainCounterfactualScenario;
  intervention_previews: Record<string, Record<string, unknown>>;
  generated_at: string;
}

export interface WorldBrainCounterfactualCompareResponse {
  success: boolean;
  comparison: WorldBrainCounterfactualComparison;
  explainability?: Record<string, unknown>;
}

export interface WorldBrainSourceConnection {
  id: string;
  connector_type: string;
  name: string;
  organization_id: string;
  status: string;
  created_at: string;
  last_sync_at?: string | null;
  sync_enabled: boolean;
  streams: string[];
}

export interface WorldBrainSourceHealthResponse {
  connection_id: string;
  organization_id: string;
  connector_type: string;
  status: string;
  reason_code: string;
  reason: string;
  last_sync_at?: string | null;
  minutes_since_last_sync?: number | null;
  stale_after_minutes: number;
  sync_slo_breached: boolean;
  sync_slo_minutes: number;
  recent_failures: number;
  recovery_action: string;
  last_error?: string | null;
  checked_at: string;
}

export interface WorldBrainIngestRun {
  id: string;
  organization_id: string;
  connection_id: string;
  connector_type: string;
  run_kind: string;
  status: string;
  retry_class?: string | null;
  scheduled_interval_minutes?: number | null;
  freshness_lag_minutes?: number | null;
  quota_headroom_ratio?: number | null;
  voi_priority?: number | null;
  records_synced: number;
  bytes_synced: number;
  cost_units?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  metadata: Record<string, unknown>;
}

export interface WorldBrainIngestRunsResponse {
  connection_id: string;
  runs: WorldBrainIngestRun[];
}

export interface WorldBrainSourceOperationResponse {
  connection_id: string;
  status: string;
  replay_job_id?: string;
  backfill_jobs?: string[];
  [key: string]: unknown;
}

export interface WorldBrainSourceHistoryJob {
  id: string;
  job_type: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
  records_synced: number;
  bytes_synced: number;
  streams: string[];
  streams_completed: string[];
  streams_failed: string[];
  error_message?: string | null;
  extra_data?: Record<string, unknown>;
}

export interface WorldBrainSourceHistoryResponse {
  connection_id: string;
  jobs: WorldBrainSourceHistoryJob[];
}

export interface WorldBrainSignalFeedbackResult {
  realized_outcome_id: string;
  intervention_plan_id?: string | null;
  outcome_type: string;
  outcome_payload: Record<string, unknown>;
  outcome_hash: string;
  measured_at: string;
}

export interface WorldBrainSignalFeedbackResponse {
  success: boolean;
  enqueued: boolean;
  job_id?: string;
  result?: WorldBrainSignalFeedbackResult;
  explainability?: Record<string, unknown>;
}

const APP_BASE_URL = env.VITE_SERVER_URL;

const client = new ApiClient({
  baseUrl: APP_BASE_URL,
  auth: [
    { kind: "cookie" },
    { kind: "bearer", getToken: () => getSessionToken() },
  ],
  onTrace: (event) => {
    recordApiTrace(event);
    if (event.status === 0) {
      markApiUnreachable();
      return;
    }
    markApiReachable();
  },
});

/**
 * API base for diagnostics only.
 *
 * The web app is deployed with an Nginx reverse-proxy that serves the UI and
 * forwards `/api/*` and `/health` to the intelligence API. Using same-origin
 * relative URLs avoids CORS/cookie issues and prevents "failed to fetch" loops.
 */
export function getApiBase(): string {
  return client.diagnosticsBaseUrl;
}

function buildHealthUrl(): string {
  if (typeof window !== "undefined") {
    return "/health";
  }
  return `${APP_BASE_URL}/health`;
}

function normalizeHeaders(
  headers: HeadersInit | undefined
): HeadersInit | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers;
  if (Array.isArray(headers)) return headers;
  return { ...(headers as Record<string, string>) };
}

function coerceApiErrorPayload(raw: unknown): ApiErrorPayload | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const payload: ApiErrorPayload = {};
  if (typeof obj.code === "string") payload.code = obj.code;
  if ("detail" in obj) payload.detail = obj.detail;
  if (typeof obj.request_id === "string") payload.request_id = obj.request_id;
  if ("meta" in obj) payload.meta = obj.meta;
  return payload;
}

/**
 * Legacy-friendly fetch wrapper.
 *
 * Prefer using the typed API modules below (`orgAPI`, `documentsAPI`, etc).
 * This exists for a few call sites that still do ad-hoc requests (Console).
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const body =
    options.body == null
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : (() => {
            throw new Error("apiFetch only supports string JSON bodies");
          })();

  return client.requestJson<T>(path, {
    method: options.method ?? "GET",
    headers: normalizeHeaders(options.headers),
    body,
    allowRetry: false,
  });
}

// =============================================================================
// API modules
// =============================================================================

export const authAPI = createAuthApi(client);
export const agentsAPI = createAgentsApi(client);
export const orgAPI = createOrgApi(client);
export const orgSecurityAPI = createOrgSecurityApi(client);
export const connectionsAPI = createConnectionsApi(client);
export const intelligenceAPI = createIntelligenceApi(client);
export const askAPI = createAskApi(client);
export const searchAPI = createSearchApi(client);
export const contentAPI = createContentApi(client);
export const documentsAPI = createDocumentsApi(client);
export const briefAPI = createBriefApi(client);
export const contactsAPI = createContactsApi(client);
export const customerAPI = createCustomerApi(client);
export const simulationsAPI = createSimulationsApi(client);
export const actuationsAPI = createActuationsApi(client);
export const trustAPI = createTrustApi(client);
export const auditAPI = createAuditApi(client);
export const changesAPI = createChangesApi(client);
export const patternsAPI = createPatternsApi(client);
export const graphAPI = createGraphApi(client);

export const worldBrainAPI = {
  listTape(params: {
    organizationId: string;
    hours?: number;
    limit?: number;
    lane?: string;
    deltaDomain?: string;
    minConfidence?: number;
  }): Promise<WorldBrainTapeResponse> {
    const query = new URLSearchParams();
    query.set("organization_id", params.organizationId);
    if (typeof params.hours === "number") {
      query.set("hours", String(params.hours));
    }
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    if (params.lane) {
      query.set("lane", params.lane);
    }
    if (params.deltaDomain) {
      query.set("delta_domain", params.deltaDomain);
    }
    if (typeof params.minConfidence === "number") {
      query.set("min_confidence", String(params.minConfidence));
    }
    return apiFetch<WorldBrainTapeResponse>(`/brain/tape?${query.toString()}`);
  },

  getTapeLiveContract(params: {
    organizationId: string;
    role?: string;
    limit?: number;
  }): Promise<WorldBrainTapeLiveContractResponse> {
    const query = new URLSearchParams();
    query.set("organization_id", params.organizationId);
    if (params.role) {
      query.set("role", params.role);
    }
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    return apiFetch<WorldBrainTapeLiveContractResponse>(
      `/brain/tape/live-contract?${query.toString()}`
    );
  },

  getTapeEvent(params: {
    organizationId: string;
    eventId: string;
  }): Promise<WorldBrainTapeEventDetailResponse> {
    const query = new URLSearchParams();
    query.set("organization_id", params.organizationId);
    return apiFetch<WorldBrainTapeEventDetailResponse>(
      `/brain/tape/${encodeURIComponent(params.eventId)}?${query.toString()}`
    );
  },

  getObligationDashboard(params: {
    organizationId: string;
    limit?: number;
  }): Promise<WorldBrainObligationDashboardResponse> {
    const query = new URLSearchParams();
    query.set("organization_id", params.organizationId);
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    return apiFetch<WorldBrainObligationDashboardResponse>(
      `/brain/obligation-sentinel/dashboard?${query.toString()}`
    );
  },

  triageObligationSignal(params: {
    organizationId: string;
    violationId: string;
    action: "acknowledge" | "escalate" | "resolve" | "simulate_impact";
    notes?: string;
    includeCounterfactualPreview?: boolean;
  }): Promise<WorldBrainObligationTriageResponse> {
    return apiFetch<WorldBrainObligationTriageResponse>(
      "/brain/obligation-sentinel/triage",
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          violation_id: params.violationId,
          action: params.action,
          notes: params.notes,
          include_counterfactual_preview:
            params.includeCounterfactualPreview ?? false,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  compareCounterfactualLab(params: {
    organizationId: string;
    scenarioA: {
      scenarioName: string;
      horizonDays: number;
    };
    scenarioB: {
      scenarioName: string;
      horizonDays: number;
    };
    targetRef?: string;
    maxConstraintSeverity?: string;
    recommendedActions?: string[];
    generateInterventions?: boolean;
  }): Promise<WorldBrainCounterfactualCompareResponse> {
    return apiFetch<WorldBrainCounterfactualCompareResponse>(
      "/brain/counterfactual-lab/compare",
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          scenario_a: {
            organization_id: params.organizationId,
            scenario_name: params.scenarioA.scenarioName,
            horizon_days: params.scenarioA.horizonDays,
          },
          scenario_b: {
            organization_id: params.organizationId,
            scenario_name: params.scenarioB.scenarioName,
            horizon_days: params.scenarioB.horizonDays,
          },
          target_ref: params.targetRef ?? "portfolio_risk",
          max_constraint_severity: params.maxConstraintSeverity ?? null,
          recommended_actions: params.recommendedActions ?? [],
          generate_interventions: params.generateInterventions ?? true,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  listSourceConnections(params: {
    organizationId: string;
    connectorType?: string;
  }): Promise<WorldBrainSourceConnection[]> {
    const query = new URLSearchParams();
    query.set("organization_id", params.organizationId);
    if (params.connectorType) {
      query.set("connector_type", params.connectorType);
    }
    return apiFetch<WorldBrainSourceConnection[]>(`/connections?${query.toString()}`);
  },

  getSourceHealth(params: {
    connectionId: string;
  }): Promise<WorldBrainSourceHealthResponse> {
    return apiFetch<WorldBrainSourceHealthResponse>(
      `/connections/${encodeURIComponent(params.connectionId)}/health`
    );
  },

  listIngestRuns(params: {
    connectionId: string;
    limit?: number;
  }): Promise<WorldBrainIngestRunsResponse> {
    const query = new URLSearchParams();
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    const path = `/connections/${encodeURIComponent(params.connectionId)}/ingest/runs`;
    return apiFetch<WorldBrainIngestRunsResponse>(
      query.size > 0 ? `${path}?${query.toString()}` : path
    );
  },

  pauseSourceIngest(params: {
    connectionId: string;
    reason?: string;
  }): Promise<WorldBrainSourceOperationResponse> {
    const query = new URLSearchParams();
    if (params.reason) {
      query.set("reason", params.reason);
    }
    const path = `/connections/${encodeURIComponent(params.connectionId)}/ingest/pause`;
    return apiFetch<WorldBrainSourceOperationResponse>(
      query.size > 0 ? `${path}?${query.toString()}` : path,
      {
        method: "POST",
      }
    );
  },

  resumeSourceIngest(params: {
    connectionId: string;
  }): Promise<WorldBrainSourceOperationResponse> {
    return apiFetch<WorldBrainSourceOperationResponse>(
      `/connections/${encodeURIComponent(params.connectionId)}/ingest/resume`,
      {
        method: "POST",
      }
    );
  },

  replaySourceIngest(params: {
    connectionId: string;
    checkpointCursor?: Record<string, unknown> | null;
    streams?: string[];
    fullRefresh?: boolean;
  }): Promise<WorldBrainSourceOperationResponse> {
    return apiFetch<WorldBrainSourceOperationResponse>(
      `/connections/${encodeURIComponent(params.connectionId)}/ingest/replay`,
      {
        method: "POST",
        body: JSON.stringify({
          checkpoint_cursor: params.checkpointCursor ?? null,
          streams: params.streams ?? [],
          full_refresh: params.fullRefresh ?? false,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  triggerSourceBackfill(params: {
    connectionId: string;
    startDate: string;
    endDate?: string;
    windowDays?: number;
    streams?: string[];
    throttleSeconds?: number;
  }): Promise<WorldBrainSourceOperationResponse> {
    return apiFetch<WorldBrainSourceOperationResponse>(
      `/org/connections/${encodeURIComponent(params.connectionId)}/backfill`,
      {
        method: "POST",
        body: JSON.stringify({
          start_date: params.startDate,
          end_date: params.endDate ?? null,
          window_days: params.windowDays ?? 7,
          streams: params.streams ?? [],
          throttle_seconds: params.throttleSeconds ?? 1.0,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
  },

  getSourceHistory(params: {
    connectionId: string;
    limit?: number;
    jobType?: string;
  }): Promise<WorldBrainSourceHistoryResponse> {
    const query = new URLSearchParams();
    if (typeof params.limit === "number") {
      query.set("limit", String(params.limit));
    }
    if (params.jobType) {
      query.set("job_type", params.jobType);
    }
    const path = `/org/connections/${encodeURIComponent(params.connectionId)}/history`;
    return apiFetch<WorldBrainSourceHistoryResponse>(
      query.size > 0 ? `${path}?${query.toString()}` : path
    );
  },

  submitSignalFeedback(params: {
    organizationId: string;
    eventId: string;
    verdict: "false_positive" | "false_negative" | "confirmed";
    correctionLabel?: string;
    notes?: string;
    lane?: string;
    deltaDomain?: string;
    confidence?: number;
    enqueue?: boolean;
  }): Promise<WorldBrainSignalFeedbackResponse> {
    return apiFetch<WorldBrainSignalFeedbackResponse>(
      "/brain/interventions/outcomes",
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organizationId,
          intervention_plan_id: null,
          outcome_type: `signal_feedback.${params.verdict}`,
          outcome_payload: {
            event_id: params.eventId,
            correction_label: params.correctionLabel ?? null,
            notes: params.notes ?? null,
            lane: params.lane ?? null,
            delta_domain: params.deltaDomain ?? null,
            confidence:
              typeof params.confidence === "number" ? params.confidence : null,
            feedback_kind: "world_brain_signal",
          },
          measured_at: new Date().toISOString(),
          persist: true,
          publish_events: true,
          enqueue: params.enqueue ?? false,
        }),
        headers: { "Content-Type": "application/json" },
      }
    );
  },
};

export const supportAPI = createSupportApi(client);

// =============================================================================
// HEALTH
// =============================================================================

export const healthAPI = {
  async ping(): Promise<Record<string, unknown>> {
    const url = buildHealthUrl();
    let res: Response;
    try {
      res = await fetch(url, { credentials: "include" });
    } catch (cause) {
      markApiUnreachable(cause);
      throw apiErrorUnreachable({
        message: "Drovi API unreachable (GET /health).",
        endpoint: "/health",
        method: "GET",
        url,
        cause,
      });
    }

    if (!res.ok) {
      let payload: unknown;
      try {
        payload = await res.json();
      } catch {
        payload = { detail: res.statusText };
      }
      throw apiErrorFromHttp({
        status: res.status,
        payload: coerceApiErrorPayload(payload),
        endpoint: "/health",
        method: "GET",
        url,
        requestId: res.headers.get("X-Request-ID") ?? undefined,
      });
    }

    markApiReachable();
    return (await res.json()) as Record<string, unknown>;
  },
};

// =============================================================================
// SSE
// =============================================================================

export const orgSSE = {
  subscribeSyncEvents(
    onEvent: (event: SyncEvent) => void,
    onError?: (error: Event) => void
  ): () => void {
    const subscription = subscribeNamedJsonEvents<SyncEvent>({
      url: `${getApiBase()}/api/v1/org/connections/events`,
      events: ["started", "progress", "completed", "failed"],
      withCredentials: true,
      onEvent: (_event, data) => onEvent(data),
      onError,
    });

    return () => subscription.close();
  },
};

const SYNC_EVENT_TYPES = ["started", "progress", "completed", "failed"] as const;

const INTELLIGENCE_EVENT_TYPES = [
  "intelligence.commitment",
  "intelligence.decision",
  "intelligence.risk",
  "intelligence.task",
  "intelligence.claim",
  "intelligence.question",
  "intelligence.unknown",
] as const;

function decodeJwtPayload(
  token: string
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    if (typeof window === "undefined" || typeof window.atob !== "function") {
      return null;
    }
    const raw = window.atob(padded);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getSseOrganizationId(): string | null {
  const token = getSessionToken();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  const orgId = payload.org_id;
  if (typeof orgId === "string" && orgId.trim()) return orgId;
  const organizationId = payload.organization_id;
  if (typeof organizationId === "string" && organizationId.trim()) {
    return organizationId;
  }
  return null;
}

function mapSyncEventToStatus(event: SyncEvent): SyncStatus {
  const normalizedEventType = String(event.event_type || "progress");
  const status =
    event.status ??
    (normalizedEventType === "started"
      ? "syncing"
      : normalizedEventType === "completed"
        ? "completed"
        : normalizedEventType === "failed"
          ? "failed"
          : "syncing");
  return {
    connection_id: String(event.connection_id || ""),
    status:
      status === "completed" || status === "failed" || status === "idle"
        ? status
        : "syncing",
    progress:
      typeof event.progress === "number"
        ? event.progress
        : status === "completed"
          ? 100
          : 0,
    records_synced:
      typeof event.records_synced === "number" ? event.records_synced : 0,
    total_records:
      typeof event.total_records === "number" ? event.total_records : null,
    error: typeof event.error === "string" ? event.error : null,
    started_at:
      normalizedEventType === "started"
        ? event.timestamp ?? null
        : null,
    completed_at:
      normalizedEventType === "completed" || normalizedEventType === "failed"
        ? event.timestamp ?? null
        : null,
  };
}

export const sseAPI = {
  subscribeSyncProgress(
    connectionId: string,
    onEvent: (event: SyncStatus) => void,
    onError?: (error: Event) => void
  ): () => void {
    // Compatibility wrapper for the legacy /sse/sync endpoint:
    // subscribe to canonical org sync SSE and filter by connection.
    const subscription = subscribeNamedJsonEvents<SyncEvent>({
      url: `${getApiBase()}/api/v1/org/connections/events`,
      events: [...SYNC_EVENT_TYPES],
      withCredentials: true,
      onEvent: (_event, data) => {
        if (data.connection_id !== connectionId) return;
        onEvent(mapSyncEventToStatus(data));
      },
      onError,
    });

    return () => subscription.close();
  },

  subscribeIntelligence(
    onEvent: (uio: unknown) => void,
    onError?: (error: Event) => void
  ): () => void {
    // Compatibility wrapper for the legacy /sse/intelligence endpoint.
    const organizationId = getSseOrganizationId();
    if (!organizationId) {
      onError?.(new Event("error"));
      return () => {
        // No-op.
      };
    }

    const subscription = subscribeNamedJsonEvents<unknown>({
      url: `${getApiBase()}/api/v1/stream/intelligence?organization_id=${encodeURIComponent(organizationId)}`,
      events: [...INTELLIGENCE_EVENT_TYPES],
      withCredentials: true,
      onEvent: (_event, data) => onEvent(data),
      onError,
    });

    return () => subscription.close();
  },
};
