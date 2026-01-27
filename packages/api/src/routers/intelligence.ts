// =============================================================================
// INTELLIGENCE ROUTER
// =============================================================================
//
// Bridge to the Python intelligence backend (drovi-intelligence).
// Provides tRPC bindings for:
// - Analytics & Blindspot Detection (Deming's System)
// - Calibration Metrics (DiBello's Strategic Rehearsal)
// - Signal/Noise Analysis (Wheeler's SPC)
// - Pattern Management (Klein's RPD)
// - Customer Context (MCP-style aggregation)
//

import { env } from "@memorystack/env/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

// =============================================================================
// CONFIGURATION
// =============================================================================

const INTELLIGENCE_URL =
  env.INTELLIGENCE_BACKEND_URL ?? "http://localhost:8000";

// =============================================================================
// HELPERS
// =============================================================================

async function fetchIntelligence<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${INTELLIGENCE_URL}${path}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Intelligence backend error: ${response.status} - ${errorText}`,
      });
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to connect to intelligence backend: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const organizationIdSchema = z.object({
  organizationId: z.string().min(1),
});

const contactContextSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
});

const signalNoiseSchema = z.object({
  organizationId: z.string().min(1),
  days: z.number().int().min(1).max(365).default(30),
});

const patternsSchema = z.object({
  organizationId: z.string().min(1),
  domain: z.string().optional(),
  activeOnly: z.boolean().default(true),
});

const timelineSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
});

const dismissBlindspotSchema = z.object({
  organizationId: z.string().min(1),
  blindspotId: z.string().min(1),
  reason: z.string().optional(),
});

const customerSearchSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});

// =============================================================================
// RESPONSE TYPES
// =============================================================================

interface OrganizationProfile {
  organization_id: string;
  total_contacts: number;
  total_commitments: number;
  open_commitments: number;
  total_decisions: number;
  total_risks_detected: number;
  risks_mitigated: number;
  decision_velocity: number;
  commitment_fulfillment_rate: number;
  avg_response_time_hours: number;
  communication_health_score: number;
  organizational_health_score: number;
  generated_at: string;
}

interface BlindspotIndicator {
  id: string;
  blindspot_type: string;
  title: string;
  description: string;
  evidence_ids: string[];
  severity: "low" | "medium" | "high";
  suggested_action: string;
  detected_at: string;
}

interface CalibrationMetrics {
  organization_id: string;
  total_predictions: number;
  evaluated_predictions: number;
  brier_score: number;
  reliability: number;
  resolution: number;
  uncertainty: number;
  calibration_by_type: Record<string, { count: number; accuracy: number }>;
}

interface SignalNoiseStats {
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

interface Pattern {
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

interface CustomerContext {
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

interface TimelineEvent {
  id: string;
  event_type: string;
  title: string;
  timestamp: string;
  source_type: string;
  details: Record<string, unknown>;
}

interface RelationshipHealth {
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
// ROUTER
// =============================================================================

export const intelligenceRouter = router({
  // ===========================================================================
  // ANALYTICS & PROFILE
  // ===========================================================================

  /**
   * Get organizational intelligence profile
   * Computes metrics about decision patterns, commitment fulfillment, etc.
   */
  getOrgProfile: protectedProcedure
    .input(organizationIdSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<OrganizationProfile>(
        `/api/v1/analytics/profile/${input.organizationId}`
      );
    }),

  /**
   * Get organizational health metrics
   * Quick health check without full profile computation
   */
  getOrgHealth: protectedProcedure
    .input(organizationIdSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<{ health_score: number; status: string }>(
        `/api/v1/analytics/health/${input.organizationId}`
      );
    }),

  // ===========================================================================
  // BLINDSPOT DETECTION (Deming's System of Profound Knowledge)
  // ===========================================================================

  /**
   * Get detected blindspots for organization
   * Identifies decision vacuums, responsibility gaps, recurring questions, etc.
   */
  getBlindspots: protectedProcedure
    .input(organizationIdSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<{ blindspots: BlindspotIndicator[] }>(
        `/api/v1/analytics/blindspots/${input.organizationId}`
      );
    }),

  /**
   * Dismiss a blindspot with optional feedback
   */
  dismissBlindspot: protectedProcedure
    .input(dismissBlindspotSchema)
    .mutation(async ({ input }) => {
      return fetchIntelligence<{ success: boolean }>(
        `/api/v1/analytics/blindspots/${input.organizationId}/${input.blindspotId}/dismiss`,
        {
          method: "POST",
          body: JSON.stringify({ reason: input.reason }),
        }
      );
    }),

  // ===========================================================================
  // CALIBRATION (DiBello's Strategic Rehearsal)
  // ===========================================================================

  /**
   * Get calibration metrics for organization
   * Brier score decomposition: reliability, resolution, uncertainty
   */
  getCalibrationMetrics: protectedProcedure
    .input(organizationIdSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<CalibrationMetrics>(
        `/api/v1/analytics/calibration/${input.organizationId}`
      );
    }),

  // ===========================================================================
  // SIGNAL/NOISE ANALYSIS (Wheeler's Statistical Process Control)
  // ===========================================================================

  /**
   * Get signal vs noise statistics
   * Shows ratio of special cause signals to common cause noise
   */
  getSignalNoiseStats: protectedProcedure
    .input(signalNoiseSchema)
    .query(async ({ input }) => {
      const params = new URLSearchParams({ days: input.days.toString() });
      return fetchIntelligence<SignalNoiseStats>(
        `/api/v1/analytics/signal-noise/${input.organizationId}?${params}`
      );
    }),

  // ===========================================================================
  // PATTERN MANAGEMENT (Klein's Recognition-Primed Decisions)
  // ===========================================================================

  /**
   * List patterns for organization
   * Recognition patterns that boost confidence on matching intelligence
   */
  listPatterns: protectedProcedure
    .input(patternsSchema)
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.domain) {
        params.set("domain", input.domain);
      }
      if (!input.activeOnly) {
        params.set("active_only", "false");
      }

      const queryString = params.toString();
      const path = `/api/v1/analytics/patterns/${input.organizationId}${queryString ? `?${queryString}` : ""}`;

      return fetchIntelligence<{ patterns: Pattern[] }>(path);
    }),

  // ===========================================================================
  // CUSTOMER CONTEXT (MCP-style aggregation)
  // ===========================================================================

  /**
   * Get complete customer context
   * Aggregates all intelligence about a contact from the graph
   */
  getCustomerContext: protectedProcedure
    .input(contactContextSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<CustomerContext>(
        `/api/v1/customer/context/${input.organizationId}/${input.contactId}`
      );
    }),

  /**
   * Get customer interaction timeline
   * Chronological history of all interactions with contact
   */
  getCustomerTimeline: protectedProcedure
    .input(timelineSchema)
    .query(async ({ input }) => {
      const params = new URLSearchParams({ limit: input.limit.toString() });
      return fetchIntelligence<{ events: TimelineEvent[] }>(
        `/api/v1/customer/timeline/${input.organizationId}/${input.contactId}?${params}`
      );
    }),

  /**
   * Get relationship health score
   * Computed from interaction patterns, commitment fulfillment, etc.
   */
  getRelationshipHealth: protectedProcedure
    .input(contactContextSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<RelationshipHealth>(
        `/api/v1/customer/health/${input.organizationId}/${input.contactId}`
      );
    }),

  /**
   * Search customer communication history
   * Vector + fulltext search on episodes involving contact
   */
  searchCustomerHistory: protectedProcedure
    .input(customerSearchSchema)
    .query(async ({ input }) => {
      const params = new URLSearchParams({
        query: input.query,
        limit: input.limit.toString(),
      });
      return fetchIntelligence<{
        results: Array<{
          id: string;
          content: string;
          timestamp: string;
          source_type: string;
          relevance_score: number;
        }>;
      }>(
        `/api/v1/customer/search/${input.organizationId}/${input.contactId}?${params}`
      );
    }),

  /**
   * Get customer's open commitments
   */
  getCustomerCommitments: protectedProcedure
    .input(contactContextSchema)
    .query(async ({ input }) => {
      return fetchIntelligence<{
        commitments: Array<{
          id: string;
          title: string;
          status: string;
          direction: string;
          due_date: string | null;
          confidence: number;
        }>;
      }>(
        `/api/v1/customer/commitments/${input.organizationId}/${input.contactId}`
      );
    }),
});
