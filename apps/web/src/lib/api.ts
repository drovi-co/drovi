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
