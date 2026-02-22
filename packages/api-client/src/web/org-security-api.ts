import type { ApiClient } from "../http/client";

import type { OrgSecurityPolicy, OrgSecurityPolicyUpdate } from "./models";

export function createOrgSecurityApi(client: ApiClient) {
  return {
    async getPolicy(): Promise<OrgSecurityPolicy> {
      return client.requestJson<OrgSecurityPolicy>("/org/security/policy");
    },

    async updatePolicy(
      updates: OrgSecurityPolicyUpdate
    ): Promise<OrgSecurityPolicy> {
      return client.requestJson<OrgSecurityPolicy>("/org/security/policy", {
        method: "PATCH",
        body: updates,
      });
    },
  };
}
