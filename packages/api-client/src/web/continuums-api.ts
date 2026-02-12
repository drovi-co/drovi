import type { ApiClient } from "../http/client";

import type {
  ContinuumCreateResponse,
  ContinuumPreview,
  ContinuumRun,
  ContinuumSummary,
} from "./models";
import { transformContinuumRun, transformContinuumSummary } from "./models";

export function createContinuumsApi(client: ApiClient) {
  return {
    async list(organizationId: string): Promise<ContinuumSummary[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        "/continuums",
        {
          query: { organization_id: organizationId },
        }
      );
      return raw.map(transformContinuumSummary);
    },

    async create(params: {
      organizationId: string;
      definition: Record<string, unknown>;
      activate?: boolean;
      createdBy?: string;
    }): Promise<ContinuumCreateResponse> {
      return client.requestJson<ContinuumCreateResponse>("/continuums", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          definition: params.definition,
          activate: params.activate ?? false,
          created_by: params.createdBy ?? null,
        },
        allowRetry: false,
      });
    },

    async addVersion(params: {
      continuumId: string;
      organizationId: string;
      definition: Record<string, unknown>;
      activate?: boolean;
      createdBy?: string;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuums/${params.continuumId}/versions`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            definition: params.definition,
            activate: params.activate ?? false,
            created_by: params.createdBy ?? null,
          },
          allowRetry: false,
        }
      );
    },

    async activate(params: { continuumId: string; organizationId: string }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuums/${params.continuumId}/activate`,
        {
          method: "POST",
          body: { organization_id: params.organizationId },
        }
      );
    },

    async pause(params: { continuumId: string; organizationId: string }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuums/${params.continuumId}/pause`,
        {
          method: "POST",
          body: { organization_id: params.organizationId },
        }
      );
    },

    async run(params: {
      continuumId: string;
      organizationId: string;
      triggeredBy?: string;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuums/${params.continuumId}/run`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            triggered_by: params.triggeredBy ?? "manual",
          },
        }
      );
    },

    async rollback(params: {
      continuumId: string;
      organizationId: string;
      targetVersion?: number;
      triggeredBy?: string;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/continuums/${params.continuumId}/rollback`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            target_version: params.targetVersion ?? null,
            triggered_by: params.triggeredBy ?? null,
          },
        }
      );
    },

    async preview(params: {
      continuumId: string;
      organizationId: string;
      horizonDays?: number;
    }): Promise<ContinuumPreview> {
      return client.requestJson<ContinuumPreview>(
        `/continuums/${params.continuumId}/preview`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            horizon_days: params.horizonDays ?? 30,
          },
        }
      );
    },

    async getRuns(params: {
      continuumId: string;
      organizationId: string;
    }): Promise<ContinuumRun[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        `/continuums/${params.continuumId}/runs`,
        { query: { organization_id: params.organizationId } }
      );
      return raw.map(transformContinuumRun);
    },
  };
}
