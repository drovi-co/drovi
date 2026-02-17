import { useEffect } from "react";

export interface AgentRunStreamEvent {
  id: string;
  organization_id: string;
  deployment_id: string;
  status: string;
  updated_at: unknown;
}

interface StreamIdentity {
  organizationId: string;
  deploymentId?: string | null;
}

export interface UseAgentRunStreamArgs extends StreamIdentity {
  apiBaseUrl: string;
  enabled: boolean;
  onRunUpdate: (event: AgentRunStreamEvent) => void;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  if (!apiBaseUrl) {
    return "";
  }
  return apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
}

export function buildAgentRunStreamUrl(
  apiBaseUrl: string,
  identity: StreamIdentity
): string {
  const normalizedBase = normalizeApiBaseUrl(apiBaseUrl);
  if (!normalizedBase || !identity.organizationId) {
    return "";
  }

  const url = new URL("api/v1/agents/runs/stream", normalizedBase);
  url.searchParams.set("organization_id", identity.organizationId);
  if (identity.deploymentId) {
    url.searchParams.set("deployment_id", identity.deploymentId);
  }
  return url.toString();
}

export function parseAgentRunStreamPayload(
  payload: string
): AgentRunStreamEvent | null {
  try {
    const parsed = JSON.parse(payload) as Partial<AgentRunStreamEvent>;
    if (!parsed || typeof parsed.id !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      organization_id:
        typeof parsed.organization_id === "string"
          ? parsed.organization_id
          : "",
      deployment_id:
        typeof parsed.deployment_id === "string" ? parsed.deployment_id : "",
      status: typeof parsed.status === "string" ? parsed.status : "unknown",
      updated_at: parsed.updated_at ?? null,
    };
  } catch {
    return null;
  }
}

export function useAgentRunStream({
  apiBaseUrl,
  organizationId,
  deploymentId,
  enabled,
  onRunUpdate,
}: UseAgentRunStreamArgs) {
  useEffect(() => {
    if (!enabled || !organizationId) {
      return;
    }

    const streamUrl = buildAgentRunStreamUrl(apiBaseUrl, {
      organizationId,
      deploymentId,
    });
    if (!streamUrl) {
      return;
    }

    const eventSource = new EventSource(streamUrl, {
      withCredentials: true,
    });
    const handler = (event: MessageEvent<string>) => {
      const payload = parseAgentRunStreamPayload(event.data);
      if (payload) {
        onRunUpdate(payload);
      }
    };

    eventSource.addEventListener("run_update", handler);

    return () => {
      eventSource.removeEventListener("run_update", handler);
      eventSource.close();
    };
  }, [apiBaseUrl, deploymentId, enabled, onRunUpdate, organizationId]);
}
