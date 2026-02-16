import type { ApiClient } from "../http/client";

import type {
  AvailableConnector,
  Connection,
  OAuthInitResponse,
  SyncStatus,
} from "./models";

function defaultRedirectUri(client: ApiClient): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : client.diagnosticsBaseUrl;
  return `${base}/api/v1/auth/callback`;
}

export function createConnectionsApi(client: ApiClient) {
  return {
    async listConnectors(): Promise<AvailableConnector[]> {
      const response = await client.requestJson<{
        connectors: AvailableConnector[];
      }>("/connections/connectors");
      return response.connectors || [];
    },

    async list(): Promise<Connection[]> {
      const response = await client.requestJson<{ connections: Connection[] }>(
        "/connections"
      );
      return response.connections || [];
    },

    async get(connectionId: string): Promise<Connection> {
      return client.requestJson<Connection>(`/connections/${connectionId}`);
    },

    async initiateOAuth(
      connectorType: string,
      organizationId: string,
      options?: { restrictedLabels?: string[]; restrictedChannels?: string[] }
    ): Promise<OAuthInitResponse> {
      return client.requestJson<OAuthInitResponse>(
        "/connections/oauth/initiate",
        {
          method: "POST",
          body: {
            connector_type: connectorType,
            organization_id: organizationId,
            redirect_uri: defaultRedirectUri(client),
            ...options,
          },
          allowRetry: false,
        }
      );
    },

    async triggerSync(
      connectionId: string,
      fullRefresh = false
    ): Promise<{ job_id: string }> {
      return client.requestJson<{ job_id: string }>(
        `/connections/${connectionId}/sync`,
        {
          method: "POST",
          body: { full_refresh: fullRefresh },
        }
      );
    },

    async getSyncStatus(connectionId: string): Promise<SyncStatus> {
      return client.requestJson<SyncStatus>(
        `/connections/${connectionId}/sync/status`
      );
    },

    async delete(connectionId: string): Promise<void> {
      await client.requestJson<void>(`/connections/${connectionId}`, {
        method: "DELETE",
      });
    },

    async update(
      connectionId: string,
      updates: { name?: string; sync_enabled?: boolean }
    ): Promise<Connection> {
      return client.requestJson<Connection>(`/connections/${connectionId}`, {
        method: "PATCH",
        body: updates,
      });
    },
  };
}
