import type { ApiClient } from "../http/client";

import type { ChangeRecord } from "./models";

export function createChangesApi(client: ApiClient) {
  return {
    async list(params: {
      organizationId: string;
      since?: string;
      until?: string;
      entityTypes?: string[];
      limit?: number;
    }) {
      return client.requestJson<{
        changes: ChangeRecord[];
        total_count: number;
        since: string;
        until: string;
      }>("/changes", {
        query: {
          organization_id: params.organizationId,
          limit: params.limit ?? 100,
          since: params.since,
          until: params.until,
          entity_types: params.entityTypes?.length
            ? params.entityTypes.join(",")
            : undefined,
        },
      });
    },
  };
}
