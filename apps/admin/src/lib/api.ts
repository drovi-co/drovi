/**
 * Admin API Client (Drovi Intelligence)
 *
 * Admin app talks directly to drovi-intelligence via Nginx reverse proxy:
 * - UI served from `admin.drovi.co`
 * - `/api/*` and `/health` proxied to the intelligence API
 *
 * Auth:
 * - Admin JWT returned by `/api/v1/admin/login`
 * - Sent via `Authorization: Bearer <token>` (primary)
 * - Cookies are included as a secondary mechanism
 */

import { env } from "@memorystack/env/web";
import { getAdminSessionToken } from "./admin-session-token";

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

const APP_BASE_URL = env.VITE_SERVER_URL;

function buildApiV1Url(path: string): string {
  if (typeof window !== "undefined") {
    return `/api/v1${path}`;
  }
  return `${APP_BASE_URL}/api/v1${path}`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const token = getAdminSessionToken();
  const normalizedHeaders: Record<string, string> = (() => {
    if (!options.headers) return {};
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
    // Marker for future server-side routing decisions (safe if ignored).
    "X-Drovi-Client": "admin",
    ...normalizedHeaders,
  };

  const hasAuthHeader = Object.keys(baseHeaders).some(
    (key) => key.toLowerCase() === "authorization"
  );
  if (token && !hasAuthHeader) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }

  const url = buildApiV1Url(path);
  const endpoint = `/api/v1${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: "include",
      headers: baseHeaders,
    });
  } catch (error) {
    throw new APIError(
      `Drovi API unreachable (${method} ${endpoint}). Check that the stack is running.`,
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
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail)) {
        detail = body.detail
          .map((item: unknown) => {
            if (item && typeof item === "object" && "msg" in item) {
              return String((item as { msg?: unknown }).msg ?? "");
            }
            return String(item);
          })
          .filter(Boolean)
          .slice(0, 3)
          .join("; ");
      } else if (typeof body?.message === "string") detail = body.message;
      else if (typeof body === "string") detail = body;
      else detail = res.statusText;
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
        return `Not authenticated (${method} ${endpoint}).`;
      }
      if (code === "FORBIDDEN") {
        return `Forbidden (${method} ${endpoint}).`;
      }
      if (code === "VALIDATION_ERROR") {
        return `${detail ? `Invalid request: ${detail}` : "Invalid request"} (${method} ${endpoint}).`;
      }
      if (code === "RATE_LIMITED") {
        return `Rate limited (${method} ${endpoint}).`;
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

  if (res.status === 204) {
    return undefined as T;
  }

  const json = (await res.json()) as T;
  return json;
}

// =============================================================================
// Admin Auth
// =============================================================================

export interface AdminMe {
  email: string;
  subject: string;
  scopes: string[];
  expires_at: string | null;
}

export interface AdminLoginResponse {
  admin: { email: string };
  session_token: string;
  expires_at: string;
}

export const adminAuthAPI = {
  loginWithEmail: async (params: { email: string; password: string }) => {
    return apiFetch<AdminLoginResponse>("/admin/login", {
      method: "POST",
      body: JSON.stringify(params),
    });
  },
  logout: async () => {
    return apiFetch<{ status: string }>("/admin/logout", { method: "POST" });
  },
  me: async () => {
    return apiFetch<AdminMe>("/admin/me");
  },
};

// =============================================================================
// KPIs
// =============================================================================

export interface KPIBlock {
  key: string;
  label: string;
  value: number;
  unit?: string | null;
  delta_5m?: number | null;
}

export interface KPIsResponse {
  generated_at: string;
  blocks: KPIBlock[];
  breakdowns: Record<string, unknown>;
}

export const adminAPI = {
  getKpis: async () => apiFetch<KPIsResponse>("/admin/kpis"),
  getOrg: async (orgId: string) =>
    apiFetch<Record<string, unknown>>(
      `/admin/orgs/${encodeURIComponent(orgId)}`
    ),
  listOrgs: async (params?: { q?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.limit) sp.set("limit", String(params.limit));
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    return apiFetch<{ organizations: Array<Record<string, unknown>> }>(
      `/admin/orgs${suffix}`
    );
  },
  listUsers: async (params?: { q?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.limit) sp.set("limit", String(params.limit));
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    return apiFetch<{ users: Array<Record<string, unknown>> }>(
      `/admin/users${suffix}`
    );
  },
  getUser: async (userId: string) =>
    apiFetch<Record<string, unknown>>(
      `/admin/users/${encodeURIComponent(userId)}`
    ),
  listConnectors: async () =>
    apiFetch<{ connectors: Array<Record<string, unknown>> }>(
      "/connections/connectors"
    ),
  listJobs: async (params?: {
    organization_id?: string;
    job_type?: string;
    status?: string;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.organization_id)
      sp.set("organization_id", params.organization_id);
    if (params?.job_type) sp.set("job_type", params.job_type);
    if (params?.status) sp.set("status", params.status);
    if (params?.limit) sp.set("limit", String(params.limit));
    const suffix = sp.toString() ? `?${sp.toString()}` : "";
    return apiFetch<{ jobs: Array<Record<string, unknown>> }>(`/jobs${suffix}`);
  },
  cancelJob: async (jobId: string) =>
    apiFetch<{ status: string }>(`/jobs/${jobId}/cancel`, { method: "POST" }),
  retryJob: async (jobId: string) =>
    apiFetch<{ job_id: string }>(`/jobs/${jobId}/retry`, { method: "POST" }),
  listExchangeBundles: async (params: {
    organization_id: string;
    visibility?: string;
    governance_status?: string;
  }) => {
    const sp = new URLSearchParams();
    sp.set("organization_id", params.organization_id);
    if (params.visibility) sp.set("visibility", params.visibility);
    if (params.governance_status)
      sp.set("governance_status", params.governance_status);
    return apiFetch<Array<Record<string, unknown>>>(
      `/continuum-exchange/bundles?${sp.toString()}`
    );
  },
  updateBundleGovernance: async (params: {
    organization_id: string;
    bundle_id: string;
    governance_status: "pending" | "approved" | "rejected";
  }) => {
    return apiFetch<{ status: string }>(
      `/continuum-exchange/bundles/${encodeURIComponent(params.bundle_id)}/governance`,
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: params.organization_id,
          governance_status: params.governance_status,
        }),
      }
    );
  },
};

// =============================================================================
// SUPPORT (Tickets)
// =============================================================================

export interface SupportTicketListItem {
  id: string;
  organization_id: string;
  subject: string;
  status: "open" | "pending" | "closed" | string;
  priority: "low" | "normal" | "high" | string;
  created_by_email: string;
  assignee_email: string | null;
  created_via: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  message_count: number;
  last_message_preview: string | null;
}

export interface SupportTicketMessageItem {
  id: string;
  direction: "inbound" | "outbound" | string;
  visibility: "external" | "internal" | string;
  author_type: "requester" | "admin" | string;
  author_email: string | null;
  body_text: string;
  body_html: string | null;
  created_at: string;
}

export interface SupportTicketDetailResponse {
  ticket: SupportTicketListItem;
  messages: SupportTicketMessageItem[];
}

export const supportAPI = {
  listTickets: async () =>
    apiFetch<{ tickets: SupportTicketListItem[] }>("/support/tickets"),

  getTicket: async (ticketId: string) =>
    apiFetch<SupportTicketDetailResponse>(
      `/support/tickets/${encodeURIComponent(ticketId)}`
    ),

  updateTicket: async (params: {
    ticketId: string;
    status?: "open" | "pending" | "closed";
    priority?: "low" | "normal" | "high";
    assignee_email?: string | null;
  }) =>
    apiFetch<{ status: string }>(
      `/support/tickets/${encodeURIComponent(params.ticketId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: params.status,
          priority: params.priority,
          assignee_email: params.assignee_email,
        }),
      }
    ),

  addMessage: async (params: {
    ticketId: string;
    message: string;
    message_html?: string | null;
    visibility?: "external" | "internal";
    locale?: string;
  }) =>
    apiFetch<{ status: string; message_id: string }>(
      `/support/tickets/${encodeURIComponent(params.ticketId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          message: params.message,
          message_html: params.message_html,
          visibility: params.visibility ?? "external",
          locale: params.locale,
        }),
      }
    ),
};
