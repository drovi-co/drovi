import type { ApiClient } from "../http/client";

import type {
  ContactDetail,
  ContactIdentityRecord,
  ContactListResponse,
  ContactMergeSuggestion,
  ContactStats,
  MeetingBrief,
} from "./models";
import {
  transformContactDetail,
  transformContactStats,
  transformContactSummary,
  transformMeetingBrief,
} from "./models";

export function createContactsApi(client: ApiClient) {
  return {
    async list(params: {
      organizationId: string;
      limit?: number;
      offset?: number;
      isVip?: boolean;
      isAtRisk?: boolean;
      sortBy?:
        | "importance_score"
        | "health_score"
        | "last_interaction_at"
        | "display_name";
      sortOrder?: "asc" | "desc";
    }): Promise<ContactListResponse> {
      const raw = await client.requestJson<{
        items: Record<string, unknown>[];
        total: number;
        limit: number;
        offset: number;
      }>("/contacts", {
        query: {
          organization_id: params.organizationId,
          limit: params.limit ?? 50,
          offset: params.offset ?? 0,
          sort_by: params.sortBy ?? "importance_score",
          sort_order: params.sortOrder ?? "desc",
          is_vip: params.isVip === undefined ? undefined : String(params.isVip),
          is_at_risk:
            params.isAtRisk === undefined ? undefined : String(params.isAtRisk),
        },
      });

      return {
        items: raw.items.map(transformContactSummary),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
      };
    },

    async getStats(organizationId: string): Promise<ContactStats> {
      const raw = await client.requestJson<Record<string, unknown>>(
        "/contacts/stats",
        {
          query: { organization_id: organizationId },
        }
      );
      return transformContactStats(raw);
    },

    async getVips(params: {
      organizationId: string;
      limit?: number;
    }): Promise<ContactListResponse> {
      const raw = await client.requestJson<{
        items: Record<string, unknown>[];
        total: number;
        limit: number;
        offset: number;
      }>("/contacts/vips", {
        query: {
          organization_id: params.organizationId,
          limit: params.limit ?? 50,
        },
      });
      return {
        items: raw.items.map(transformContactSummary),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
      };
    },

    async getAtRisk(params: {
      organizationId: string;
      limit?: number;
    }): Promise<ContactListResponse> {
      const raw = await client.requestJson<{
        items: Record<string, unknown>[];
        total: number;
        limit: number;
        offset: number;
      }>("/contacts/at-risk", {
        query: {
          organization_id: params.organizationId,
          limit: params.limit ?? 50,
        },
      });
      return {
        items: raw.items.map(transformContactSummary),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
      };
    },

    async search(params: {
      organizationId: string;
      query: string;
      limit?: number;
    }): Promise<ContactListResponse> {
      const raw = await client.requestJson<{
        items: Record<string, unknown>[];
        total: number;
        limit: number;
        offset: number;
      }>("/contacts/search", {
        query: {
          organization_id: params.organizationId,
          query: params.query,
          limit: params.limit ?? 20,
        },
      });
      return {
        items: raw.items.map(transformContactSummary),
        total: raw.total,
        limit: raw.limit,
        offset: raw.offset,
      };
    },

    async get(
      contactId: string,
      organizationId: string
    ): Promise<ContactDetail> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/contacts/${contactId}`,
        {
          query: { organization_id: organizationId },
        }
      );
      return transformContactDetail(raw);
    },

    async toggleVip(
      contactId: string,
      organizationId: string,
      isVip: boolean
    ): Promise<{ success: boolean; isVip: boolean }> {
      const raw = await client.requestJson<{
        success: boolean;
        is_vip: boolean;
      }>(`/contacts/${contactId}/toggle-vip`, {
        method: "POST",
        query: { organization_id: organizationId },
        body: { is_vip: isVip },
      });
      return { success: raw.success, isVip: raw.is_vip };
    },

    async analyze(
      contactId: string,
      organizationId: string
    ): Promise<{ success: boolean; analysisId: string }> {
      const raw = await client.requestJson<{
        success: boolean;
        analysis_id: string;
      }>(`/contacts/${contactId}/analyze`, {
        method: "POST",
        query: { organization_id: organizationId },
      });
      return { success: raw.success, analysisId: raw.analysis_id };
    },

    async generateMeetingBrief(
      contactId: string,
      organizationId: string
    ): Promise<MeetingBrief> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/contacts/${contactId}/meeting-brief`,
        { method: "POST", query: { organization_id: organizationId } }
      );
      return transformMeetingBrief(raw);
    },

    async listMergeSuggestions(params: {
      organizationId: string;
      minConfidence?: number;
      limit?: number;
    }): Promise<ContactMergeSuggestion[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        "/contacts/merge-suggestions",
        {
          query: {
            organization_id: params.organizationId,
            min_confidence: params.minConfidence ?? 0.7,
            limit: params.limit ?? 50,
          },
        }
      );
      return raw.map((item) => ({
        contactAId: item.contact_a_id as string,
        contactAName: (item.contact_a_name as string) ?? null,
        contactAEmail: (item.contact_a_email as string) ?? null,
        contactBId: item.contact_b_id as string,
        contactBName: (item.contact_b_name as string) ?? null,
        contactBEmail: (item.contact_b_email as string) ?? null,
        confidence: item.confidence as number,
        matchReasons: (item.match_reasons as string[]) ?? [],
      }));
    },

    async mergeContacts(params: {
      organizationId: string;
      sourceContactId: string;
      targetContactId: string;
      reason?: string;
    }): Promise<{ success: boolean }> {
      return client.requestJson<{ success: boolean }>("/contacts/merge", {
        method: "POST",
        query: { organization_id: params.organizationId },
        body: {
          source_contact_id: params.sourceContactId,
          target_contact_id: params.targetContactId,
          reason: params.reason,
        },
        allowRetry: false,
      });
    },

    async exportIdentityAudit(params: {
      organizationId: string;
      contactId?: string;
    }): Promise<ContactIdentityRecord[]> {
      const raw = await client.requestJson<Record<string, unknown>[]>(
        "/contacts/identities/audit",
        {
          query: {
            organization_id: params.organizationId,
            contact_id: params.contactId,
          },
        }
      );
      return raw.map((item) => ({
        id: item.id as string,
        identityType: item.identity_type as string,
        identityValue: item.identity_value as string,
        confidence: item.confidence as number,
        isVerified: (item.is_verified as boolean) ?? false,
        source: (item.source as string) ?? null,
        sourceAccountId: (item.source_account_id as string) ?? null,
        lastSeenAt: (item.last_seen_at as string) ?? null,
        createdAt: (item.created_at as string) ?? null,
        updatedAt: (item.updated_at as string) ?? null,
      }));
    },
  };
}
