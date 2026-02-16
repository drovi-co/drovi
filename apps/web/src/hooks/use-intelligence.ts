import { useQuery } from "@tanstack/react-query";
import { customerAPI } from "@/lib/api";

export function useCustomerContext(params: {
  organizationId: string;
  contactId: string;
}) {
  return useQuery({
    queryKey: ["customer-context", params.organizationId, params.contactId],
    queryFn: () =>
      customerAPI.getContext({
        organizationId: params.organizationId,
        contactId: params.contactId,
        includeTimeline: false,
      }),
    enabled: Boolean(params.organizationId && params.contactId),
  });
}

export function useCustomerTimeline(params: {
  organizationId: string;
  contactId: string;
  limit?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [
      "customer-timeline",
      params.organizationId,
      params.contactId,
      params.limit,
    ],
    queryFn: () =>
      customerAPI.getTimeline({
        organizationId: params.organizationId,
        contactId: params.contactId,
        limit: params.limit ?? 20,
      }),
    enabled: Boolean(
      params.enabled !== false && params.organizationId && params.contactId
    ),
  });
}

export function useRelationshipHealth(params: {
  organizationId: string;
  contactId: string;
}) {
  return useQuery({
    queryKey: ["relationship-health", params.organizationId, params.contactId],
    queryFn: () =>
      customerAPI.getRelationshipHealth({
        organizationId: params.organizationId,
        contactId: params.contactId,
      }),
    enabled: Boolean(params.organizationId && params.contactId),
  });
}
