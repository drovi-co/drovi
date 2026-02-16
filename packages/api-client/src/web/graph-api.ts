import type { ApiClient } from "../http/client";

import type { GraphQueryResponse } from "./models";

export function createGraphApi(client: ApiClient) {
  return {
    async query(params: {
      organizationId: string;
      cypher: string;
      params?: Record<string, unknown>;
    }): Promise<GraphQueryResponse> {
      return client.requestJson<GraphQueryResponse>("/graph/query", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          cypher: params.cypher,
          params: params.params ?? {},
        },
      });
    },

    async stats(organizationId: string): Promise<Record<string, unknown>> {
      return client.requestJson<Record<string, unknown>>("/graph/stats", {
        query: { organization_id: organizationId },
      });
    },
  };
}
