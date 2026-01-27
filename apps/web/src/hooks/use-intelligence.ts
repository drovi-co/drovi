/**
 * Intelligence Analytics Hooks
 *
 * Provides React Query hooks for working with the Intelligence backend:
 * - Organizational Profile & Health
 * - Blindspot Detection (Deming's System)
 * - Calibration Metrics (DiBello's Strategic Rehearsal)
 * - Signal/Noise Analysis (Wheeler's SPC)
 * - Pattern Management (Klein's RPD)
 * - Customer Context (MCP-style aggregation)
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export type BlindspotType =
  | "decision_vacuum"
  | "responsibility_gap"
  | "recurring_question"
  | "ignored_risk"
  | "communication_silo";

export type BlindspotSeverity = "low" | "medium" | "high";

export interface BlindspotIndicator {
  id: string;
  blindspot_type: string; // API returns string, may be one of BlindspotType values
  title: string;
  description: string;
  evidence_ids: string[];
  severity: BlindspotSeverity;
  suggested_action: string;
  detected_at: string;
}

export interface CalibrationMetrics {
  organization_id: string;
  total_predictions: number;
  evaluated_predictions: number;
  brier_score: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
  calibration_by_type: Record<string, { count: number; accuracy: number }>;
}

export interface SignalNoiseStats {
  organization_id: string;
  period_days: number;
  total_intelligence: number;
  signals: number;
  noise: number;
  uncertain: number;
  signal_ratio: number;
  by_zone: Record<string, number>;
  by_type: Record<string, { signal: number; noise: number }>;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  domain: string;
  times_matched: number;
  times_confirmed: number;
  times_rejected: number;
  accuracy_rate: number;
  is_active: boolean;
  created_at: string;
}

export interface CustomerContext {
  contact_id: string;
  organization_id: string;
  contact_name: string;
  contact_email: string;
  relationship_summary: string | null;
  interaction_count: number;
  last_interaction: string | null;
  open_commitments: Array<{
    id: string;
    title: string;
    status: string;
    due_date: string | null;
  }>;
  related_decisions: Array<{
    id: string;
    title: string;
    decided_at: string;
  }>;
  top_topics: string[];
  related_contacts: Array<{
    id: string;
    name: string;
    relationship_type: string;
  }>;
  source_presence: string[];
  relationship_health: number;
}

export interface TimelineEvent {
  id: string;
  event_type: string;
  title: string;
  timestamp: string;
  source_type: string;
  details: Record<string, unknown>;
}

export interface RelationshipHealth {
  contact_id: string;
  health_score: number;
  components: {
    fulfillment_rate: number;
    interaction_trend: number;
    response_quality: number;
  };
  risk_indicators: string[];
  last_updated: string;
}

// =============================================================================
// ORGANIZATIONAL PROFILE & HEALTH HOOKS
// =============================================================================

/**
 * Fetch organizational intelligence profile.
 * Computes metrics about decision patterns, commitment fulfillment, etc.
 */
export function useOrgProfile(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getOrgProfile.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

/**
 * Fetch quick organizational health metrics.
 */
export function useOrgHealth(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getOrgHealth.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

// =============================================================================
// BLINDSPOT DETECTION HOOKS (Deming's System of Profound Knowledge)
// =============================================================================

/**
 * Fetch detected blindspots for organization.
 * Identifies decision vacuums, responsibility gaps, recurring questions, etc.
 */
export function useBlindspots(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getBlindspots.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

/**
 * Dismiss a blindspot with optional feedback.
 */
export function useDismissBlindspot() {
  const trpc = useTRPC();

  return useMutation(trpc.intelligence.dismissBlindspot.mutationOptions());
}

// =============================================================================
// CALIBRATION HOOKS (DiBello's Strategic Rehearsal)
// =============================================================================

/**
 * Fetch calibration metrics for organization.
 * Brier score decomposition: reliability, resolution, uncertainty.
 */
export function useCalibrationMetrics(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getCalibrationMetrics.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

// =============================================================================
// SIGNAL/NOISE ANALYSIS HOOKS (Wheeler's SPC)
// =============================================================================

/**
 * Fetch signal vs noise statistics.
 * Shows ratio of special cause signals to common cause noise.
 */
export function useSignalNoiseStats(params: {
  organizationId: string;
  days?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getSignalNoiseStats.queryOptions(
      {
        organizationId: params.organizationId,
        days: params.days ?? 30,
      },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

// =============================================================================
// PATTERN MANAGEMENT HOOKS (Klein's RPD)
// =============================================================================

/**
 * Fetch patterns for organization.
 * Recognition patterns that boost confidence on matching intelligence.
 */
export function usePatterns(params: {
  organizationId: string;
  domain?: string;
  activeOnly?: boolean;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.listPatterns.queryOptions(
      {
        organizationId: params.organizationId,
        domain: params.domain,
        activeOnly: params.activeOnly ?? true,
      },
      { enabled: params.enabled !== false && !!params.organizationId }
    )
  );
}

// =============================================================================
// CUSTOMER CONTEXT HOOKS (MCP-style aggregation)
// =============================================================================

/**
 * Fetch complete customer context.
 * Aggregates all intelligence about a contact from the graph.
 */
export function useCustomerContext(params: {
  organizationId: string;
  contactId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getCustomerContext.queryOptions(
      {
        organizationId: params.organizationId,
        contactId: params.contactId,
      },
      {
        enabled:
          params.enabled !== false &&
          !!params.organizationId &&
          !!params.contactId,
      }
    )
  );
}

/**
 * Fetch customer interaction timeline.
 * Chronological history of all interactions with contact.
 */
export function useCustomerTimeline(params: {
  organizationId: string;
  contactId: string;
  limit?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getCustomerTimeline.queryOptions(
      {
        organizationId: params.organizationId,
        contactId: params.contactId,
        limit: params.limit ?? 50,
      },
      {
        enabled:
          params.enabled !== false &&
          !!params.organizationId &&
          !!params.contactId,
      }
    )
  );
}

/**
 * Fetch relationship health score.
 * Computed from interaction patterns, commitment fulfillment, etc.
 */
export function useRelationshipHealth(params: {
  organizationId: string;
  contactId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getRelationshipHealth.queryOptions(
      {
        organizationId: params.organizationId,
        contactId: params.contactId,
      },
      {
        enabled:
          params.enabled !== false &&
          !!params.organizationId &&
          !!params.contactId,
      }
    )
  );
}

/**
 * Search customer communication history.
 * Vector + fulltext search on episodes involving contact.
 */
export function useCustomerSearch(params: {
  organizationId: string;
  contactId: string;
  query: string;
  limit?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.searchCustomerHistory.queryOptions(
      {
        organizationId: params.organizationId,
        contactId: params.contactId,
        query: params.query,
        limit: params.limit ?? 20,
      },
      {
        enabled:
          params.enabled !== false &&
          !!params.organizationId &&
          !!params.contactId &&
          params.query.length >= 2,
      }
    )
  );
}

/**
 * Fetch customer's open commitments.
 */
export function useCustomerCommitments(params: {
  organizationId: string;
  contactId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.intelligence.getCustomerCommitments.queryOptions(
      {
        organizationId: params.organizationId,
        contactId: params.contactId,
      },
      {
        enabled:
          params.enabled !== false &&
          !!params.organizationId &&
          !!params.contactId,
      }
    )
  );
}
