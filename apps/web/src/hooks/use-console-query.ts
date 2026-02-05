/**
 * Console Query Hook
 *
 * React Query hook for the Console API. Handles:
 * - Filtered queries with pagination
 * - Metrics and aggregations
 * - Entity autocomplete
 */

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { type ParsedQuery, toApiRequest } from "@/lib/console-parser";

// =============================================================================
// TYPES
// =============================================================================

export interface ConsoleMetrics {
  total_count: number;
  active_count: number;
  at_risk_count: number;
  overdue_count: number;
  avg_confidence: number;
  signal_quality: number;
  ai_calibration: number;
  blindspot_count: number;
}

export interface AggregationItem {
  key: string;
  count: number;
  percentage?: number;
}

export interface ConsoleAggregations {
  [key: string]: AggregationItem[];
}

export interface ContactInfo {
  id: string;
  display_name: string | null;
  email: string;
  avatar_url: string | null;
  company: string | null;
}

export interface ConsoleItem {
  id: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  confidence: number | null;
  confidence_tier: string | null;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  is_user_verified: boolean;
  is_at_risk: boolean;
  is_overdue: boolean;
  // Contact fields from API
  owner: ContactInfo | null;
  debtor: ContactInfo | null;
  creditor: ContactInfo | null;
  assignee: ContactInfo | null;
  decision_maker: ContactInfo | null;
  // Type-specific fields
  direction: string | null;
  severity: string | null;
  decided_at: string | null;
  // Source
  source_type: string | null;
  source_id: string | null;
  // Fallback sender from source message (when no contact linked)
  source_sender_name: string | null;
  source_sender_email: string | null;
}

export interface ConsoleQueryResponse {
  items: ConsoleItem[];
  aggregations: ConsoleAggregations;
  metrics: ConsoleMetrics;
  timeseries: Array<{
    timestamp: string;
    count: number;
  }>;
  next_cursor: string | null;
  has_more: boolean;
}

export interface EntitySuggestion {
  value: string;
  label: string;
  description?: string;
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchConsoleQuery(
  organizationId: string,
  parsed: ParsedQuery,
  options: {
    groupBy?: string | null;
    visualization?: string;
    limit?: number;
    cursor?: string | null;
  }
): Promise<ConsoleQueryResponse> {
  const request = toApiRequest(parsed, options);

  return apiFetch<ConsoleQueryResponse>("/console/query", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

async function fetchEntitySuggestions(
  organizationId: string,
  entity: string,
  query: string,
  limit: number
): Promise<EntitySuggestion[]> {
  const params = new URLSearchParams({
    entity,
    limit: String(limit),
  });
  if (query) {
    params.set("query", query);
  }

  return apiFetch<EntitySuggestion[]>(`/console/entities?${params}`);
}

// =============================================================================
// HOOKS
// =============================================================================

export function useConsoleQuery(
  organizationId: string,
  parsed: ParsedQuery,
  options: {
    groupBy?: string | null;
    visualization?: string;
    limit?: number;
    cursor?: string | null;
    enabled?: boolean;
  } = {}
) {
  const { enabled = true, ...queryOptions } = options;

  return useQuery({
    queryKey: [
      "console",
      "query",
      organizationId,
      parsed,
      queryOptions.groupBy,
      queryOptions.visualization,
      queryOptions.limit,
      queryOptions.cursor,
    ],
    queryFn: () => fetchConsoleQuery(organizationId, parsed, queryOptions),
    enabled: Boolean(organizationId) && enabled,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

export function useEntitySuggestions(
  organizationId: string,
  entity: string,
  query: string,
  limit = 10
) {
  return useQuery({
    queryKey: ["console", "entities", organizationId, entity, query, limit],
    queryFn: () => fetchEntitySuggestions(organizationId, entity, query, limit),
    enabled: Boolean(organizationId && entity),
    staleTime: 5 * 60_000, // 5 minutes
  });
}

// =============================================================================
// SOURCE TYPES
// =============================================================================

export interface SourceItem {
  id: string;
  source_type: string;
  message_id: string | null;
  conversation_id: string | null;
  quoted_text: string | null;
  source_timestamp: string | null;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  deep_link: string | null;
}

export interface RelatedItem {
  id: string;
  type: string;
  title: string;
  status: string;
  confidence: number | null;
  relationship: string;
  created_at: string;
}

// =============================================================================
// SOURCES API
// =============================================================================

async function fetchUioSources(
  organizationId: string,
  uioId: string
): Promise<SourceItem[]> {
  return apiFetch<SourceItem[]>(`/console/sources/${uioId}`);
}

async function fetchRelatedUios(
  organizationId: string,
  uioId: string,
  limit = 10
): Promise<RelatedItem[]> {
  return apiFetch<RelatedItem[]>(`/console/related/${uioId}?limit=${limit}`);
}

// =============================================================================
// SOURCES HOOKS
// =============================================================================

export function useUioSources(organizationId: string, uioId: string | null) {
  return useQuery({
    queryKey: ["console", "sources", organizationId, uioId],
    queryFn: () => fetchUioSources(organizationId, uioId!),
    enabled: Boolean(organizationId && uioId),
    staleTime: 60_000, // 1 minute
  });
}

export function useRelatedUios(
  organizationId: string,
  uioId: string | null,
  limit = 10
) {
  return useQuery({
    queryKey: ["console", "related", organizationId, uioId, limit],
    queryFn: () => fetchRelatedUios(organizationId, uioId!, limit),
    enabled: Boolean(organizationId && uioId),
    staleTime: 60_000, // 1 minute
  });
}

// =============================================================================
// SOURCE DETAIL TYPES
// =============================================================================

export interface MessageDetail {
  id: string;
  source_id: string;
  source_type: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_avatar_url: string | null;
  recipients: Array<{ email?: string; name?: string }>;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  quoted_text: string | null;
  sent_at: string | null;
  received_at: string | null;
  conversation_id: string | null;
  conversation_title: string | null;
  message_count: number;
  has_attachments: boolean;
  attachments: Array<{
    id: string;
    filename: string;
    mime_type: string | null;
    size_bytes: number | null;
  }>;
  deep_link: string | null;
  related_uios: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    confidence: number | null;
  }>;
}

// =============================================================================
// SOURCE DETAIL API
// =============================================================================

async function fetchSourceDetail(
  organizationId: string,
  sourceId: string
): Promise<MessageDetail> {
  return apiFetch<MessageDetail>(`/console/source/${sourceId}`);
}

// =============================================================================
// SOURCE DETAIL HOOK
// =============================================================================

export function useSourceDetail(
  organizationId: string,
  sourceId: string | null
) {
  return useQuery({
    queryKey: ["console", "source-detail", organizationId, sourceId],
    queryFn: () => fetchSourceDetail(organizationId, sourceId!),
    enabled: Boolean(organizationId && sourceId),
    staleTime: 60_000, // 1 minute
  });
}
