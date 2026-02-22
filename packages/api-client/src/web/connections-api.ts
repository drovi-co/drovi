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
      // Compatibility wrapper:
      // prefer canonical org-scoped OAuth initiation and adapt to legacy shape.
      const response = await client.requestJson<{
        auth_url: string;
        state: string;
        code_verifier?: string;
      }>(`/org/connections/${encodeURIComponent(connectorType)}/connect`, {
        method: "POST",
        body: {
          // kept for backward-compatible call sites, not used by canonical route
          organization_id: organizationId,
          redirect_uri: defaultRedirectUri(client),
          restricted_labels: options?.restrictedLabels || [],
          restricted_channels: options?.restrictedChannels || [],
        },
        allowRetry: false,
      });

      return {
        auth_url: response.auth_url,
        authorization_url: response.auth_url,
        state: response.state,
        code_verifier: response.code_verifier,
      };
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
