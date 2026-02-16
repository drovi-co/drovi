import type { ApiClient } from "../http/client";

import type {
  BackfillResponse,
  ConnectResponse,
  OrgConnection,
  OrgExportResponse,
  OrgInfo,
  OrgInvite,
  OrgMember,
  SyncTriggerResponse,
} from "./models";

function defaultRedirectUri(client: ApiClient): string {
  // This matches the deployed Nginx proxy contract:
  // UI served from same origin, `/api/*` proxied to intelligence.
  const base =
    typeof window !== "undefined"
      ? window.location.origin
      : client.diagnosticsBaseUrl;
  return `${base}/api/v1/auth/callback`;
}

export function createOrgApi(client: ApiClient) {
  return {
    async listConnections(): Promise<OrgConnection[]> {
      const response = await client.requestJson<{
        connections: OrgConnection[];
      }>("/org/connections");
      return response.connections || [];
    },

    async initiateConnect(
      provider: string,
      options?: {
        visibility?: "org_shared" | "private";
        restrictedLabels?: string[];
        restrictedChannels?: string[];
        returnTo?: string;
      }
    ): Promise<ConnectResponse> {
      return client.requestJson<ConnectResponse>(
        `/org/connections/${provider}/connect`,
        {
          method: "POST",
          body: {
            redirect_uri: defaultRedirectUri(client),
            visibility: options?.visibility ?? null,
            restricted_labels: options?.restrictedLabels || [],
            restricted_channels: options?.restrictedChannels || [],
            return_to: options?.returnTo || null,
          },
        }
      );
    },

    async triggerSync(
      connectionId: string,
      options?: { fullRefresh?: boolean; streams?: string[] }
    ): Promise<SyncTriggerResponse> {
      return client.requestJson<SyncTriggerResponse>(
        `/org/connections/${connectionId}/sync`,
        {
          method: "POST",
          body: {
            full_refresh: options?.fullRefresh,
            streams: options?.streams || [],
          },
        }
      );
    },

    async triggerBackfill(params: {
      connectionId: string;
      startDate: string;
      endDate?: string;
      windowDays?: number;
      streams?: string[];
      throttleSeconds?: number;
    }): Promise<BackfillResponse> {
      return client.requestJson<BackfillResponse>(
        `/org/connections/${params.connectionId}/backfill`,
        {
          method: "POST",
          body: {
            start_date: params.startDate,
            end_date: params.endDate ?? null,
            window_days: params.windowDays ?? 7,
            streams: params.streams ?? [],
            throttle_seconds: params.throttleSeconds ?? 1.0,
          },
        }
      );
    },

    async deleteConnection(connectionId: string): Promise<void> {
      await client.requestJson<void>(`/org/connections/${connectionId}`, {
        method: "DELETE",
      });
    },

    async updateConnectionVisibility(params: {
      connectionId: string;
      visibility: "org_shared" | "private";
    }): Promise<{
      updated: boolean;
      connection_id: string;
      visibility: string;
    }> {
      return client.requestJson<{
        updated: boolean;
        connection_id: string;
        visibility: string;
      }>(`/org/connections/${params.connectionId}/visibility`, {
        method: "PATCH",
        body: { visibility: params.visibility },
      });
    },

    async getOrgInfo(): Promise<OrgInfo> {
      return client.requestJson<OrgInfo>("/org/info");
    },

    async updateOrgInfo(params: {
      name?: string;
      allowedDomains?: string[];
      notificationEmails?: string[];
      region?: string;
      allowedConnectors?: string[] | null;
      defaultConnectionVisibility?: "org_shared" | "private" | null;
      defaultLocale?: string | null;
    }): Promise<OrgInfo> {
      return client.requestJson<OrgInfo>("/org/info", {
        method: "PATCH",
        body: {
          name: params.name ?? null,
          allowed_domains: params.allowedDomains ?? null,
          notification_emails: params.notificationEmails ?? null,
          region: params.region ?? null,
          allowed_connectors: params.allowedConnectors ?? null,
          default_connection_visibility:
            params.defaultConnectionVisibility ?? null,
          default_locale: params.defaultLocale ?? null,
        },
      });
    },

    async listMembers(): Promise<OrgMember[]> {
      const response = await client.requestJson<{ members: OrgMember[] }>(
        "/org/members"
      );
      return response.members || [];
    },

    async updateMemberRole(params: { userId: string; role: string }) {
      return client.requestJson<{ updated: boolean }>(
        `/org/members/${params.userId}`,
        {
          method: "PATCH",
          body: { role: params.role },
        }
      );
    },

    async removeMember(userId: string) {
      return client.requestJson<{ removed: boolean }>(
        `/org/members/${userId}`,
        {
          method: "DELETE",
        }
      );
    },

    async listInvites(): Promise<OrgInvite[]> {
      const response = await client.requestJson<{ invites: OrgInvite[] }>(
        "/org/invites"
      );
      return response.invites || [];
    },

    async createInvite(params: {
      role?: "pilot_admin" | "pilot_member" | "pilot_viewer";
      expiresInDays?: number;
      email?: string;
    }): Promise<OrgInvite> {
      return client.requestJson<OrgInvite>("/org/invites", {
        method: "POST",
        body: {
          role: params.role ?? "pilot_member",
          expires_in_days: params.expiresInDays ?? 7,
          email: params.email ?? null,
        },
      });
    },

    async revokeInvite(token: string) {
      return client.requestJson<{ revoked: boolean }>(`/org/invites/${token}`, {
        method: "DELETE",
      });
    },

    async exportData(params: {
      format?: "json" | "csv" | "neo4j";
      include?: string[];
    }): Promise<OrgExportResponse> {
      return client.requestJson<OrgExportResponse>("/org/export", {
        method: "POST",
        body: {
          format: params.format ?? "json",
          include: params.include ?? [
            "uios",
            "evidence",
            "graph",
            "connections",
          ],
        },
      });
    },

    async getExportStatus(jobId: string): Promise<OrgExportResponse> {
      return client.requestJson<OrgExportResponse>(`/org/export/${jobId}`);
    },
  };
}
