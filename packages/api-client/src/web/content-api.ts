import type { ApiClient } from "../http/client";

import type { ContentSearchResponse } from "./models";

export function createContentApi(client: ApiClient) {
  return {
    async search(params: {
      query: string;
      organizationId?: string;
      kinds?: Array<"message" | "document" | "meeting" | "note">;
      limit?: number;
    }): Promise<ContentSearchResponse> {
      return client.requestJson<ContentSearchResponse>("/content/search", {
        method: "POST",
        body: {
          query: params.query,
          organization_id: params.organizationId ?? null,
          kinds: params.kinds ?? null,
          limit: params.limit ?? 20,
        },
      });
    },
  };
}
