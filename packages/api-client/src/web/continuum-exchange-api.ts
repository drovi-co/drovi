import type { ApiClient } from "../http/client";

import type { ContinuumBundle } from "./models";
import { transformBundle } from "./models";

export function createContinuumExchangeApi(client: ApiClient) {
  return {
    async list(params: {
      organizationId: string;
      visibility?: string;
      governanceStatus?: string;
    }): Promise<ContinuumBundle[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        "/continuum-exchange/bundles",
        {
          query: {
            organization_id: params.organizationId,
            visibility: params.visibility,
            governance_status: params.governanceStatus,
          },
        }
      );
      return raw.map(transformBundle);
    },

    async publish(params: {
      organizationId: string;
      manifest: Record<string, unknown>;
      signature?: string | null;
      createdBy?: string | null;
      visibility?: "private" | "public" | "curated";
      governanceStatus?: "pending" | "approved" | "rejected";
      priceCents?: number | null;
      currency?: string | null;
      billingModel?: "one_time" | "subscription" | "usage" | null;
    }) {
      return client.requestJson<{
        bundle_id: string;
        version: string;
        signature: string;
      }>("/continuum-exchange/bundles/publish", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          manifest: params.manifest,
          signature: params.signature ?? null,
          created_by: params.createdBy ?? null,
          visibility: params.visibility ?? "private",
          governance_status: params.governanceStatus ?? "pending",
          price_cents: params.priceCents ?? null,
          currency: params.currency ?? null,
          billing_model: params.billingModel ?? null,
        },
        allowRetry: false,
      });
    },

    async install(params: {
      organizationId: string;
      bundleId: string;
      version?: string | null;
      installedBy?: string | null;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuum-exchange/bundles/${params.bundleId}/install`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            version: params.version ?? null,
            installed_by: params.installedBy ?? null,
          },
          allowRetry: false,
        }
      );
    },

    async updateGovernance(params: {
      organizationId: string;
      bundleId: string;
      governanceStatus: "pending" | "approved" | "rejected";
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuum-exchange/bundles/${params.bundleId}/governance`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            governance_status: params.governanceStatus,
          },
          allowRetry: false,
        }
      );
    },
  };
}
