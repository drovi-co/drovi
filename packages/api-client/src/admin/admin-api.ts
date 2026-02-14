import type { ApiClient } from "../http/client";

import type { GovernanceOverviewResponse, KPIsResponse } from "./models";

export function createAdminApi(client: ApiClient) {
  return {
    getKpis: async (): Promise<KPIsResponse> => {
      return client.requestJson<KPIsResponse>("/admin/kpis", {
        headers: { "X-Drovi-Client": "admin" },
      });
    },

    getGovernanceOverview: async (): Promise<GovernanceOverviewResponse> => {
      return client.requestJson<GovernanceOverviewResponse>(
        "/admin/governance/overview",
        {
          headers: { "X-Drovi-Client": "admin" },
        }
      );
    },

    getOrg: async (orgId: string): Promise<Record<string, unknown>> => {
      return client.requestJson<Record<string, unknown>>(
        `/admin/orgs/${encodeURIComponent(orgId)}`,
        { headers: { "X-Drovi-Client": "admin" } }
      );
    },

    listOrgs: async (params?: {
      q?: string;
      limit?: number;
    }): Promise<{ organizations: Array<Record<string, unknown>> }> => {
      return client.requestJson<{
        organizations: Array<Record<string, unknown>>;
      }>("/admin/orgs", {
        headers: { "X-Drovi-Client": "admin" },
        query: { q: params?.q, limit: params?.limit },
      });
    },

    listUsers: async (params?: {
      q?: string;
      limit?: number;
    }): Promise<{ users: Array<Record<string, unknown>> }> => {
      return client.requestJson<{ users: Array<Record<string, unknown>> }>(
        "/admin/users",
        {
          headers: { "X-Drovi-Client": "admin" },
          query: { q: params?.q, limit: params?.limit },
        }
      );
    },

    getUser: async (userId: string): Promise<Record<string, unknown>> => {
      return client.requestJson<Record<string, unknown>>(
        `/admin/users/${encodeURIComponent(userId)}`,
        { headers: { "X-Drovi-Client": "admin" } }
      );
    },

    listConnectors: async (): Promise<{
      connectors: Array<Record<string, unknown>>;
    }> => {
      // Same endpoint as web. Keep the admin client marker header for future routing.
      return client.requestJson<{ connectors: Array<Record<string, unknown>> }>(
        "/connections/connectors",
        { headers: { "X-Drovi-Client": "admin" } }
      );
    },

    listJobs: async (params?: {
      organization_id?: string;
      job_type?: string;
      status?: string;
      limit?: number;
    }): Promise<{ jobs: Array<Record<string, unknown>> }> => {
      return client.requestJson<{ jobs: Array<Record<string, unknown>> }>(
        "/jobs",
        {
          headers: { "X-Drovi-Client": "admin" },
          query: {
            organization_id: params?.organization_id,
            job_type: params?.job_type,
            status: params?.status,
            limit: params?.limit,
          },
        }
      );
    },

    cancelJob: async (jobId: string): Promise<{ status: string }> => {
      return client.requestJson<{ status: string }>(`/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "X-Drovi-Client": "admin" },
        allowRetry: false,
      });
    },

    retryJob: async (jobId: string): Promise<{ job_id: string }> => {
      return client.requestJson<{ job_id: string }>(`/jobs/${jobId}/retry`, {
        method: "POST",
        headers: { "X-Drovi-Client": "admin" },
        allowRetry: false,
      });
    },

    listExchangeBundles: async (params: {
      organization_id: string;
      visibility?: string;
      governance_status?: string;
    }): Promise<Array<Record<string, unknown>>> => {
      return client.requestJson<Array<Record<string, unknown>>>(
        "/continuum-exchange/bundles",
        {
          headers: { "X-Drovi-Client": "admin" },
          query: {
            organization_id: params.organization_id,
            visibility: params.visibility,
            governance_status: params.governance_status,
          },
        }
      );
    },

    updateBundleGovernance: async (params: {
      organization_id: string;
      bundle_id: string;
      governance_status: "pending" | "approved" | "rejected";
    }): Promise<{ status: string }> => {
      return client.requestJson<{ status: string }>(
        `/continuum-exchange/bundles/${encodeURIComponent(params.bundle_id)}/governance`,
        {
          method: "POST",
          headers: { "X-Drovi-Client": "admin" },
          body: {
            organization_id: params.organization_id,
            governance_status: params.governance_status,
          },
          allowRetry: false,
        }
      );
    },
  };
}
