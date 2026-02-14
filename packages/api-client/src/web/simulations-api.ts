import type { ApiClient } from "../http/client";

import type { SimulationOverridePayload, SimulationResult } from "./models";

export function createSimulationsApi(client: ApiClient) {
  return {
    async run(params: {
      organizationId: string;
      scenarioName?: string;
      horizonDays?: number;
      overrides?: SimulationOverridePayload;
    }): Promise<SimulationResult> {
      return client.requestJson<SimulationResult>("/simulations/run", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          scenario_name: params.scenarioName ?? "what_if",
          horizon_days: params.horizonDays ?? 30,
          overrides: params.overrides ?? {},
        },
      });
    },

    async history(params: { organizationId: string; limit?: number }) {
      return client.requestJson<Record<string, unknown>[]>(
        "/simulations/history",
        {
          query: {
            organization_id: params.organizationId,
            limit: params.limit ?? 50,
          },
        }
      );
    },
  };
}
