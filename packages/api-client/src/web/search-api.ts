import type { ApiClient } from "../http/client";

import type { SearchResponse } from "./models";

export function createSearchApi(client: ApiClient) {
  return {
    async search(params: {
      query: string;
      types?: string[];
      source_types?: string[];
      include_graph_context?: boolean;
      limit?: number;
    }): Promise<SearchResponse> {
      const response = await client.requestJson<SearchResponse>("/search", {
        method: "POST",
        body: {
          query: params.query,
          types: params.types,
          source_types: params.source_types,
          include_graph_context: params.include_graph_context ?? false,
          limit: params.limit ?? 20,
        },
      });
      return { ...response, total: response.count };
    },
  };
}
