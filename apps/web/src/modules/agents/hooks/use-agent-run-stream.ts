import { useEffect } from "react";
import { getApiBase } from "@/lib/api";

export interface AgentRunStreamEvent {
  id: string;
  organization_id: string;
  deployment_id: string;
  status: string;
  updated_at: unknown;
}

interface UseAgentRunStreamArgs {
  organizationId: string;
  deploymentId?: string | null;
  enabled: boolean;
  onRunUpdate: (event: AgentRunStreamEvent) => void;
}

export function useAgentRunStream({
  organizationId,
  deploymentId,
  enabled,
  onRunUpdate,
}: UseAgentRunStreamArgs) {
  useEffect(() => {
    if (!(enabled && organizationId)) {
      return;
    }
    const url = new URL(`${getApiBase()}/api/v1/agents/runs/stream`);
    url.searchParams.set("organization_id", organizationId);
    if (deploymentId) {
      url.searchParams.set("deployment_id", deploymentId);
    }
    const eventSource = new EventSource(url.toString(), {
      withCredentials: true,
    });

    const handler = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as AgentRunStreamEvent;
        if (data && typeof data.id === "string") {
          onRunUpdate(data);
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    eventSource.addEventListener("run_update", handler);

    return () => {
      eventSource.removeEventListener("run_update", handler);
      eventSource.close();
    };
  }, [deploymentId, enabled, onRunUpdate, organizationId]);
}
