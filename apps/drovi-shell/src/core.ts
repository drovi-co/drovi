import { invoke } from "@tauri-apps/api/core";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export async function coreRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  if (isTauri) {
    return (await invoke("core_request", {
      method: options.method ?? "GET",
      path,
      body: options.body ?? null,
    })) as T;
  }

  const baseUrl = "http://localhost:8000";
  const response = await fetch(`${baseUrl}/${path.replace(/^\//, "")}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Core request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

export async function listContinuums(organizationId: string) {
  return coreRequest(`/api/v1/continuums?organization_id=${organizationId}`);
}

export async function runContinuum(continuumId: string, organizationId: string) {
  return coreRequest(`/api/v1/continuums/${continuumId}/run`, {
    method: "POST",
    body: { organization_id: organizationId, triggered_by: "shell" },
  });
}

export async function pauseContinuum(continuumId: string, organizationId: string) {
  return coreRequest(`/api/v1/continuums/${continuumId}/pause`, {
    method: "POST",
    body: { organization_id: organizationId },
  });
}

export async function activateContinuum(continuumId: string, organizationId: string) {
  return coreRequest(`/api/v1/continuums/${continuumId}/activate`, {
    method: "POST",
    body: { organization_id: organizationId },
  });
}

export async function analyzeIntent(payload: {
  content: string;
  organization_id: string;
  context_budget?: Record<string, unknown>;
}) {
  return coreRequest("/api/v1/analyze", {
    method: "POST",
    body: {
      content: payload.content,
      organization_id: payload.organization_id,
      source_type: "manual",
      candidate_only: false,
      context_budget: payload.context_budget ?? null,
    },
  });
}
