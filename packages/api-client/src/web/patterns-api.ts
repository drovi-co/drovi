import type { ApiClient } from "../http/client";

import type { PatternCandidate } from "./models";

export function createPatternsApi(client: ApiClient) {
  return {
    async listCandidates(organizationId: string): Promise<PatternCandidate[]> {
      return client.requestJson<PatternCandidate[]>("/patterns/candidates", {
        query: { organization_id: organizationId },
      });
    },

    async discoverCandidates(params: {
      organizationId: string;
      minClusterSize?: number;
      similarityThreshold?: number;
      maxNodes?: number;
    }): Promise<PatternCandidate[]> {
      return client.requestJson<PatternCandidate[]>(
        "/patterns/candidates/discover",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            min_cluster_size: params.minClusterSize ?? 3,
            similarity_threshold: params.similarityThreshold ?? 0.85,
            max_nodes: params.maxNodes ?? 500,
          },
        }
      );
    },

    async promoteCandidate(params: {
      organizationId: string;
      candidateId: string;
      name?: string;
      description?: string;
      typicalAction?: string;
      confidenceBoost?: number;
      domain?: string;
    }) {
      return client.requestJson<{ pattern_id: string; promoted: boolean }>(
        `/patterns/candidates/${params.candidateId}/promote`,
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            name: params.name,
            description: params.description,
            typical_action: params.typicalAction,
            confidence_boost: params.confidenceBoost,
            domain: params.domain,
          },
          allowRetry: false,
        }
      );
    },
  };
}
