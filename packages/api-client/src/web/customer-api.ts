import type { ApiClient } from "../http/client";

import type {
  CustomerContext,
  CustomerTimeline,
  RelationshipHealth,
} from "./models";
import {
  transformCustomerContext,
  transformCustomerTimelineEvent,
} from "./models";

export function createCustomerApi(client: ApiClient) {
  return {
    async getContext(params: {
      organizationId: string;
      contactId?: string;
      email?: string;
      includeTimeline?: boolean;
      maxTimelineItems?: number;
    }): Promise<CustomerContext> {
      const raw = await client.requestJson<Record<string, unknown>>(
        "/customer/context",
        {
          method: "POST",
          body: {
            organization_id: params.organizationId,
            contact_id: params.contactId ?? null,
            email: params.email ?? null,
            include_timeline: params.includeTimeline ?? true,
            max_timeline_items: params.maxTimelineItems ?? 50,
          },
        }
      );
      return transformCustomerContext(raw);
    },

    async getTimeline(params: {
      organizationId: string;
      contactId: string;
      limit?: number;
    }): Promise<CustomerTimeline> {
      const raw = await client.requestJson<{
        contact_id: string;
        events: Record<string, unknown>[];
        total: number;
      }>(`/customer/timeline/${params.contactId}`, {
        query: {
          organization_id: params.organizationId,
          limit: params.limit ?? 50,
        },
      });
      return {
        contactId: raw.contact_id,
        events: raw.events.map(transformCustomerTimelineEvent),
        total: raw.total,
      };
    },

    async getRelationshipHealth(params: {
      organizationId: string;
      contactId: string;
    }): Promise<RelationshipHealth> {
      const raw = await client.requestJson<Record<string, unknown>>(
        `/customer/health/${params.contactId}`,
        { query: { organization_id: params.organizationId } }
      );
      return {
        contactId: raw.contact_id as string,
        healthScore: (raw.health_score as number) ?? 0,
        factors: (raw.factors as Record<string, unknown> | null) ?? {},
      };
    },
  };
}
