/**
 * UIO (Unified Intelligence Object) Hooks
 *
 * Provides React Query hooks for working with UIOs across all types:
 * - Commitments, Decisions, Claims, Tasks, Risks, Briefs
 *
 * Uses the unified UIO router which queries extension tables for rich details.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTRPC } from "~/trpc/react";

// =============================================================================
// Types
// =============================================================================

export type UIOType =
  | "commitment"
  | "decision"
  | "topic"
  | "project"
  | "claim"
  | "task"
  | "risk"
  | "brief";

export type UIOStatus = "active" | "merged" | "archived" | "dismissed";

// =============================================================================
// Generic UIO Hooks
// =============================================================================

/**
 * Fetch a list of UIOs with optional filtering.
 */
export function useUIOs(params: {
  organizationId: string;
  type?: UIOType;
  types?: UIOType[];
  status?: UIOStatus;
  limit?: number;
  offset?: number;
  search?: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.list.queryOptions(
      {
        organizationId: params.organizationId,
        type: params.type,
        types: params.types,
        status: params.status,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
        search: params.search,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Fetch a single UIO with all its details.
 */
export function useUIO(params: {
  organizationId: string;
  id: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.getWithDetails.queryOptions(
      {
        organizationId: params.organizationId,
        id: params.id,
      },
      { enabled: params.enabled !== false && !!params.id }
    )
  );
}

/**
 * Get UIO statistics for dashboard.
 */
export function useUIOStats(params: { organizationId: string }) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.getStats.queryOptions({
      organizationId: params.organizationId,
    })
  );
}

// =============================================================================
// Type-Specific Hooks
// =============================================================================

/**
 * Fetch commitment UIOs with extension details.
 */
export function useCommitmentUIOs(params: {
  organizationId: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled" | "overdue" | "waiting" | "snoozed";
  direction?: "owed_by_me" | "owed_to_me";
  priority?: "low" | "medium" | "high" | "urgent";
  dueBefore?: Date;
  dueAfter?: Date;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.listCommitments.queryOptions(
      {
        organizationId: params.organizationId,
        status: params.status,
        direction: params.direction,
        priority: params.priority,
        dueBefore: params.dueBefore,
        dueAfter: params.dueAfter,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Fetch decision UIOs with extension details.
 */
export function useDecisionUIOs(params: {
  organizationId: string;
  status?: "made" | "pending" | "deferred" | "reversed";
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.listDecisions.queryOptions(
      {
        organizationId: params.organizationId,
        status: params.status,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Fetch task UIOs with extension details.
 */
export function useTaskUIOs(params: {
  organizationId: string;
  status?: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
  priority?: "no_priority" | "low" | "medium" | "high" | "urgent";
  assigneeId?: string;
  project?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.listTasks.queryOptions(
      {
        organizationId: params.organizationId,
        status: params.status,
        priority: params.priority,
        assigneeId: params.assigneeId,
        project: params.project,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Fetch risk UIOs with extension details.
 */
export function useRiskUIOs(params: {
  organizationId: string;
  severity?: "low" | "medium" | "high" | "critical";
  riskType?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.listRisks.queryOptions(
      {
        organizationId: params.organizationId,
        severity: params.severity,
        riskType: params.riskType,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Fetch brief UIOs with extension details.
 */
export function useBriefUIOs(params: {
  organizationId: string;
  priorityTier?: "urgent" | "high" | "medium" | "low";
  suggestedAction?: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.listBriefs.queryOptions(
      {
        organizationId: params.organizationId,
        priorityTier: params.priorityTier,
        suggestedAction: params.suggestedAction,
        conversationId: params.conversationId,
        limit: params.limit ?? 50,
        offset: params.offset ?? 0,
      },
      { enabled: params.enabled !== false }
    )
  );
}

/**
 * Get overdue commitments.
 */
export function useOverdueCommitments(params: {
  organizationId: string;
  limit?: number;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.uio.getOverdue.queryOptions({
      organizationId: params.organizationId,
      limit: params.limit ?? 20,
    })
  );
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Update a UIO.
 */
export function useUpdateUIO() {
  const trpc = useTRPC();

  return useMutation(trpc.uio.update.mutationOptions());
}

/**
 * Dismiss a UIO (mark as incorrect extraction).
 */
export function useDismissUIO() {
  const trpc = useTRPC();

  return useMutation(trpc.uio.dismiss.mutationOptions());
}

/**
 * Verify a UIO (mark as correct extraction).
 */
export function useVerifyUIO() {
  const trpc = useTRPC();

  return useMutation(trpc.uio.verify.mutationOptions());
}

/**
 * Archive a UIO.
 */
export function useArchiveUIO() {
  const trpc = useTRPC();

  return useMutation(trpc.uio.archive.mutationOptions());
}
