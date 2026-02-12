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
  createAskApi,
  createAuditApi,
  createAuthApi,
  createBriefApi,
  createChangesApi,
  createConnectionsApi,
  createContactsApi,
  createContentApi,
  createContinuumExchangeApi,
  createContinuumsApi,
  createCustomerApi,
  createDocumentsApi,
  createGraphApi,
  createIntelligenceApi,
  createOrgApi,
  createPatternsApi,
  createSearchApi,
  createSimulationsApi,
  createTrustApi,
  type SyncEvent,
  type SyncStatus,
} from "@memorystack/api-client/web";
import {
  subscribeJsonEvents,
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
  ContactSummary,
  ContentSearchResult,
  ContinuumBundle,
  ContinuumPreview,
  ContinuumRun,
  ContinuumSummary,
  DriveDocument,
  DriveDocumentChunk,
  DriveDocumentChunkDetail,
  DriveSearchHit,
  EvidenceArtifact,
  OrgConnection,
  OrgInfo,
  OrgInvite,
  OrgMember,
  PatternCandidate,
  SearchResult,
  SimulationOverridePayload,
  SimulationResult,
  SyncEvent,
  TrustIndicator,
  UIO,
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
export const orgAPI = createOrgApi(client);
export const connectionsAPI = createConnectionsApi(client);
export const intelligenceAPI = createIntelligenceApi(client);
export const askAPI = createAskApi(client);
export const searchAPI = createSearchApi(client);
export const contentAPI = createContentApi(client);
export const documentsAPI = createDocumentsApi(client);
export const briefAPI = createBriefApi(client);
export const contactsAPI = createContactsApi(client);
export const customerAPI = createCustomerApi(client);
export const continuumsAPI = createContinuumsApi(client);
export const continuumExchangeAPI = createContinuumExchangeApi(client);
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

export const sseAPI = {
  subscribeSyncProgress(
    connectionId: string,
    onEvent: (event: SyncStatus) => void,
    onError?: (error: Event) => void
  ): () => void {
    const subscription = subscribeJsonEvents<SyncStatus>({
      url: `${getApiBase()}/api/v1/sse/sync/${encodeURIComponent(connectionId)}`,
      withCredentials: true,
      onMessage: onEvent,
      onError,
    });

    return () => subscription.close();
  },

  subscribeIntelligence(
    onEvent: (uio: unknown) => void,
    onError?: (error: Event) => void
  ): () => void {
    const subscription = subscribeNamedJsonEvents<unknown>({
      url: `${getApiBase()}/api/v1/sse/intelligence`,
      events: ["new_uio"],
      withCredentials: true,
      onEvent: (_event, data) => onEvent(data),
      onError,
    });

    return () => subscription.close();
  },
};
