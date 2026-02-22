import type { ApiClient } from "../http/client";

import type {
  CommitmentFollowUpDraft,
  DecisionSupersessionChain,
  Evidence,
  UIO,
  UIOComment,
  UIOListResponse,
} from "./models";
import {
  transformCommitmentFollowUpDraft,
  transformDecisionSupersessionChain,
  transformUIO,
  transformUIOComment,
} from "./models";

export function createIntelligenceApi(client: ApiClient) {
  return {
    async listUIOs(params?: {
      type?: string;
      status?: string;
      time_range?: string;
      cursor?: string;
      limit?: number;
      includeTotal?: boolean;
    }): Promise<UIOListResponse> {
      const raw = await client.requestJson<{
        items: Record<string, unknown>[];
        total?: number | null;
        cursor: string | null;
        has_more: boolean;
      }>("/uios/v2", {
        query: {
          type: params?.type,
          status: params?.status,
          time_range: params?.time_range,
          cursor: params?.cursor,
          limit: params?.limit,
          include_total: params?.includeTotal,
        },
      });

      return {
        items: raw.items.map(transformUIO),
        total: raw.total ?? raw.items.length,
        cursor: raw.cursor,
        hasMore: raw.has_more,
      };
    },

    async getUIO(uioId: string): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}`
      );
      return transformUIO(raw);
    },

    async listComments(uioId: string): Promise<UIOComment[]> {
      const raw = await client.requestJson<Array<Record<string, unknown>>>(
        `/uios/${uioId}/comments`
      );
      return raw.map(transformUIOComment);
    },

    async addComment(uioId: string, body: string): Promise<UIOComment> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/comments`,
        {
          method: "POST",
          body: { body },
        }
      );
      return transformUIOComment(raw);
    },

    async updateStatus(uioId: string, status: string): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/status`,
        {
          method: "PATCH",
          body: { status },
        }
      );
      return transformUIO(raw);
    },

    async updateUIO(
      uioId: string,
      updates: {
        canonical_title?: string;
        canonical_description?: string;
        due_date?: string;
      },
      organizationId: string
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}`,
        {
          method: "PATCH",
          query: { organization_id: organizationId },
          body: updates,
        }
      );
      return transformUIO(raw);
    },

    async verify(uioId: string): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/verify`,
        {
          method: "POST",
        }
      );
      return transformUIO(raw);
    },

    async snooze(uioId: string, snoozeUntil: string): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/snooze`,
        {
          method: "POST",
          body: { snooze_until: snoozeUntil },
        }
      );
      return transformUIO(raw);
    },

    async updateTaskStatus(
      uioId: string,
      status:
        | "backlog"
        | "todo"
        | "in_progress"
        | "in_review"
        | "done"
        | "cancelled"
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/task-status`,
        {
          method: "PATCH",
          body: { status },
        }
      );
      return transformUIO(raw);
    },

    async updateTaskPriority(
      uioId: string,
      priority: "no_priority" | "low" | "medium" | "high" | "urgent"
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/task-priority`,
        {
          method: "PATCH",
          body: { priority },
        }
      );
      return transformUIO(raw);
    },

    async updateCommitmentPriority(
      uioId: string,
      priority: "low" | "medium" | "high" | "urgent"
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/commitment-priority`,
        {
          method: "PATCH",
          body: { priority },
        }
      );
      return transformUIO(raw);
    },

    async updateCommitmentDirection(
      uioId: string,
      direction: "owed_by_me" | "owed_to_me"
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/commitment-direction`,
        {
          method: "PATCH",
          body: { direction },
        }
      );
      return transformUIO(raw);
    },

    async supersedeDecision(
      uioId: string,
      supersededById: string
    ): Promise<UIO> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/supersede`,
        {
          method: "POST",
          body: { superseded_by_id: supersededById },
        }
      );
      return transformUIO(raw);
    },

    async getDecisionSupersessionChain(
      uioId: string
    ): Promise<DecisionSupersessionChain> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/decision-supersession-chain`
      );
      return transformDecisionSupersessionChain(raw);
    },

    async generateCommitmentFollowUp(
      uioId: string,
      tone: "friendly" | "neutral" | "firm" = "neutral"
    ): Promise<CommitmentFollowUpDraft> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/uios/${uioId}/commitment-follow-up`,
        {
          method: "POST",
          body: { tone },
        }
      );
      return transformCommitmentFollowUpDraft(raw);
    },

    async archive(uioId: string): Promise<UIO> {
      return this.updateStatus(uioId, "archived");
    },

    async markComplete(uioId: string): Promise<UIO> {
      return this.updateStatus(uioId, "completed");
    },

    async getEvidence(evidenceId: string): Promise<Evidence> {
      return client.requestJson<Evidence>(`/evidence/${evidenceId}`);
    },
  };
}
