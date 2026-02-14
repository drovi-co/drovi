import type { ApiClient } from "../http/client";

import type { AskResponse } from "./models";

export function createAskApi(client: ApiClient) {
  return {
    async ask(params: {
      question: string;
      organizationId: string;
      sessionId?: string;
      includeEvidence?: boolean;
      userId?: string;
    }): Promise<AskResponse> {
      return client.requestJson<AskResponse>("/ask", {
        method: "POST",
        body: {
          question: params.question,
          organization_id: params.organizationId,
          session_id: params.sessionId ?? null,
          include_evidence: params.includeEvidence ?? true,
          user_id: params.userId ?? null,
        },
      });
    },
  };
}
