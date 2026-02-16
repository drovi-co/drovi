import type { ApiClient } from "../http/client";

import type { TrustIndicator } from "./models";

export function createTrustApi(client: ApiClient) {
  return {
    async getIndicators(params: {
      organizationId: string;
      uioIds: string[];
      evidenceLimit?: number;
    }): Promise<TrustIndicator[]> {
      return client.requestJson<TrustIndicator[]>("/trust/uios", {
        method: "POST",
        body: {
          organization_id: params.organizationId,
          uio_ids: params.uioIds,
          evidence_limit: params.evidenceLimit ?? 3,
        },
      });
    },
  };
}
