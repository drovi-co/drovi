import type { ApiClient } from "../http/client";

export function createAuditApi(client: ApiClient) {
  return {
    async verifyLedger(organizationId: string) {
      return client.requestJson<Record<string, unknown>>("/audit/verify", {
        query: { organization_id: organizationId },
      });
    },
  };
}
