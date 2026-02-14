import type { ApiClient } from "../http/client";

import type { ActuationRecordSummary } from "./models";
import { transformActuationSummary } from "./models";

export function createActuationsApi(client: ApiClient) {
  return {
    async listDrivers(): Promise<string[]> {
      const raw = await client.requestJson<{ drivers: string[] }>(
        "/actuations/drivers"
      );
      return raw.drivers;
    },

    async list(organizationId: string): Promise<ActuationRecordSummary[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        "/actuations",
        {
          query: { organization_id: organizationId },
        }
      );
      return raw.map(transformActuationSummary);
    },

    async run(params: {
      organizationId: string;
      driver: string;
      action: string;
      payload?: Record<string, unknown>;
      tier?: string;
      policyContext?: Record<string, unknown>;
      actorId?: string | null;
      approvalBy?: string | null;
      approvalReason?: string | null;
      mode?: "draft" | "stage" | "execute";
      actionId?: string | null;
      forceExecute?: boolean;
    }) {
      return client.requestJson<Record<string, unknown>>("/actuations", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          driver: params.driver,
          action: params.action,
          payload: params.payload ?? {},
          tier: params.tier ?? null,
          policy_context: params.policyContext ?? null,
          actor_id: params.actorId ?? null,
          approval_by: params.approvalBy ?? null,
          approval_reason: params.approvalReason ?? null,
          force_execute: params.forceExecute ?? false,
          mode: params.mode ?? "execute",
          action_id: params.actionId ?? null,
        },
        allowRetry: false,
      });
    },

    async approve(params: {
      organizationId: string;
      actionId: string;
      actorId?: string | null;
      approvalBy?: string | null;
      approvalReason?: string | null;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/actuations/${params.actionId}/approve`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            actor_id: params.actorId ?? null,
            approval_by: params.approvalBy ?? null,
            approval_reason: params.approvalReason ?? null,
          },
          allowRetry: false,
        }
      );
    },

    async rollback(params: {
      organizationId: string;
      actionId: string;
      actorId?: string | null;
    }) {
      return client.requestJson<Record<string, unknown>>(
        `/actuations/${params.actionId}/rollback`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            actor_id: params.actorId ?? null,
          },
          allowRetry: false,
        }
      );
    },
  };
}
