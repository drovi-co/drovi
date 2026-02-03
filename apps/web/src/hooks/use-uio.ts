/**
 * UIO (Unified Intelligence Object) Hooks
 *
 * Provides React Query hooks for working with UIOs across all types:
 * - Commitments, Decisions, Claims, Tasks, Risks
 *
 * Uses the Python backend API directly via the intelligenceAPI client.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { intelligenceAPI, type UIO, type UIOListResponse } from "@/lib/api";

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
  | "risk";

export type UIOStatus = "open" | "overdue" | "completed" | "all";

// =============================================================================
// Query Keys
// =============================================================================

const uioKeys = {
  all: ["uios"] as const,
  lists: () => [...uioKeys.all, "list"] as const,
  list: (params: { type?: string; status?: string; time_range?: string }) =>
    [...uioKeys.lists(), params] as const,
  details: () => [...uioKeys.all, "detail"] as const,
  detail: (id: string) => [...uioKeys.details(), id] as const,
};

// =============================================================================
// Generic UIO Hooks
// =============================================================================

/**
 * Fetch a list of UIOs with optional filtering.
 */
export function useUIOs(params: {
  organizationId?: string;
  type?: UIOType;
  types?: UIOType[];
  status?: UIOStatus | string;
  time_range?: string;
  limit?: number;
  cursor?: string;
  offset?: number;
  search?: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({
      type: params.type || params.types?.[0],
      status: params.status,
      time_range: params.time_range,
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: params.type || params.types?.[0],
        status: params.status,
        time_range: params.time_range || "30d",
        limit: params.limit ?? 50,
        cursor: params.cursor,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Fetch a single UIO with all its details.
 */
export function useUIO(params: { organizationId?: string; id: string; enabled?: boolean }) {
  return useQuery({
    queryKey: uioKeys.detail(params.id),
    queryFn: async (): Promise<UIO> => {
      return intelligenceAPI.getUIO(params.id);
    },
    enabled: params.enabled !== false && !!params.id,
  });
}

/**
 * Get UIO statistics for dashboard.
 */
export function useUIOStats(params: { organizationId?: string; enabled?: boolean }) {
  // Stats are computed from listing all UIOs
  const commitmentsQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "commitment" }), "stats"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "commitment", status: "all", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const decisionsQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "decision" }), "stats"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "decision", status: "all", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const tasksQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "task" }), "stats"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "task", status: "all", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const risksQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "risk" }), "stats"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "risk", status: "all", limit: 1 }),
    enabled: params.enabled !== false,
  });

  return {
    data:
      commitmentsQuery.data && decisionsQuery.data && tasksQuery.data && risksQuery.data
        ? {
            commitments: commitmentsQuery.data.total,
            decisions: decisionsQuery.data.total,
            tasks: tasksQuery.data.total,
            risks: risksQuery.data.total,
            total:
              commitmentsQuery.data.total +
              decisionsQuery.data.total +
              tasksQuery.data.total +
              risksQuery.data.total,
          }
        : null,
    isLoading:
      commitmentsQuery.isLoading ||
      decisionsQuery.isLoading ||
      tasksQuery.isLoading ||
      risksQuery.isLoading,
    error:
      commitmentsQuery.error ||
      decisionsQuery.error ||
      tasksQuery.error ||
      risksQuery.error,
  };
}

// =============================================================================
// Type-Specific Hooks
// =============================================================================

/**
 * Fetch commitment UIOs with extension details.
 */
export function useCommitmentUIOs(params: {
  organizationId?: string;
  status?:
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "overdue"
    | "waiting"
    | "snoozed";
  direction?: "owed_by_me" | "owed_to_me";
  priority?: "low" | "medium" | "high" | "urgent";
  dueBefore?: Date;
  dueAfter?: Date;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({ type: "commitment", status: params.status }),
    queryFn: async (): Promise<UIOListResponse> => {
      // Map frontend status to backend status
      let backendStatus: string | undefined;
      if (params.status === "overdue") {
        backendStatus = "overdue";
      } else if (params.status === "pending" || params.status === "in_progress" || params.status === "waiting") {
        backendStatus = "open";
      } else if (params.status === "completed" || params.status === "cancelled") {
        backendStatus = "completed";
      }

      return intelligenceAPI.listUIOs({
        type: "commitment",
        status: backendStatus,
        limit: params.limit ?? 50,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Fetch decision UIOs with extension details.
 */
export function useDecisionUIOs(params: {
  organizationId?: string;
  status?: "made" | "pending" | "deferred" | "reversed";
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({ type: "decision", status: params.status }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "decision",
        status: params.status === "pending" ? "open" : undefined,
        limit: params.limit ?? 50,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Fetch task UIOs with extension details.
 */
export function useTaskUIOs(params: {
  organizationId?: string;
  status?:
    | "backlog"
    | "todo"
    | "in_progress"
    | "in_review"
    | "done"
    | "cancelled";
  priority?: "no_priority" | "low" | "medium" | "high" | "urgent";
  assigneeId?: string;
  project?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({ type: "task", status: params.status }),
    queryFn: async (): Promise<UIOListResponse> => {
      // Map frontend status to backend status
      let backendStatus: string | undefined;
      if (params.status === "backlog" || params.status === "todo" || params.status === "in_progress" || params.status === "in_review") {
        backendStatus = "open";
      } else if (params.status === "done" || params.status === "cancelled") {
        backendStatus = "completed";
      }

      return intelligenceAPI.listUIOs({
        type: "task",
        status: backendStatus,
        limit: params.limit ?? 50,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Fetch risk UIOs with extension details.
 */
export function useRiskUIOs(params: {
  organizationId?: string;
  severity?: "low" | "medium" | "high" | "critical";
  riskType?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({ type: "risk" }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "risk",
        limit: params.limit ?? 50,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Fetch brief UIOs - maps to commitments with high priority.
 */
export function useBriefUIOs(params: {
  organizationId?: string;
  priorityTier?: "urgent" | "high" | "medium" | "low";
  suggestedAction?: string;
  conversationId?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  // Briefs map to high-priority open items
  return useQuery({
    queryKey: [...uioKeys.list({ status: "open" }), "briefs", params.priorityTier],
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        status: "open",
        limit: params.limit ?? 50,
      });
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Get overdue commitments.
 */
export function useOverdueCommitments(params: {
  organizationId?: string;
  limit?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: uioKeys.list({ type: "commitment", status: "overdue" }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "commitment",
        status: "overdue",
        limit: params.limit ?? 20,
      });
    },
    enabled: params.enabled !== false,
  });
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Update a UIO.
 */
export function useUpdateUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Apply user corrections to a UIO.
 */
export function useCorrectUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      organizationId,
      updates,
    }: {
      id: string;
      organizationId: string;
      updates: { canonical_title?: string; canonical_description?: string; due_date?: string };
    }) => {
      return intelligenceAPI.updateUIO(id, updates, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Dismiss a UIO (mark as archived).
 */
export function useDismissUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, "archived");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Verify a UIO (mark as active).
 */
export function useVerifyUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, "active");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Archive a UIO.
 */
export function useArchiveUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, "archived");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Mark a commitment as complete.
 */
export function useMarkCompleteUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, "completed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Snooze a commitment until a specified date.
 */
export function useSnoozeUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; organizationId?: string; until?: Date }) => {
      // For now, just mark as in_progress (snooze functionality would need backend support)
      return intelligenceAPI.updateUIOStatus(id, "in_progress");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Update task status.
 */
export function useUpdateTaskStatusUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; organizationId?: string }) => {
      return intelligenceAPI.updateUIOStatus(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

/**
 * Update task priority.
 */
export function useUpdateTaskPriorityUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; priority: string; organizationId?: string }) => {
      // Priority updates would need backend support
      // For now, this is a no-op that invalidates cache
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.all });
    },
  });
}

// =============================================================================
// Stats Hooks
// =============================================================================

/**
 * Get commitment statistics.
 */
export function useCommitmentStats(params: { organizationId?: string; enabled?: boolean }) {
  const openQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "commitment", status: "open" }), "count"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "commitment", status: "open", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const overdueQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "commitment", status: "overdue" }), "count"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "commitment", status: "overdue", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const completedQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "commitment", status: "completed" }), "count"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "commitment", status: "completed", limit: 1 }),
    enabled: params.enabled !== false,
  });

  return {
    data:
      openQuery.data && overdueQuery.data && completedQuery.data
        ? {
            open: openQuery.data.total,
            overdue: overdueQuery.data.total,
            completed: completedQuery.data.total,
            total: openQuery.data.total + overdueQuery.data.total + completedQuery.data.total,
          }
        : null,
    isLoading: openQuery.isLoading || overdueQuery.isLoading || completedQuery.isLoading,
    error: openQuery.error || overdueQuery.error || completedQuery.error,
  };
}

/**
 * Get decision statistics.
 */
export function useDecisionStats(params: { organizationId?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: [...uioKeys.list({ type: "decision", status: "all" }), "stats"],
    queryFn: async () => {
      const result = await intelligenceAPI.listUIOs({ type: "decision", status: "all", limit: 1 });
      return {
        data: {
          total: result.total,
        },
      };
    },
    enabled: params.enabled !== false,
  });
}

/**
 * Get task statistics.
 */
export function useTaskStats(params: { organizationId?: string; enabled?: boolean }) {
  const openQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "task", status: "open" }), "count"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "task", status: "open", limit: 1 }),
    enabled: params.enabled !== false,
  });

  const completedQuery = useQuery({
    queryKey: [...uioKeys.list({ type: "task", status: "completed" }), "count"],
    queryFn: () => intelligenceAPI.listUIOs({ type: "task", status: "completed", limit: 1 }),
    enabled: params.enabled !== false,
  });

  return {
    data:
      openQuery.data && completedQuery.data
        ? {
            open: openQuery.data.total,
            completed: completedQuery.data.total,
            total: openQuery.data.total + completedQuery.data.total,
          }
        : null,
    isLoading: openQuery.isLoading || completedQuery.isLoading,
    error: openQuery.error || completedQuery.error,
  };
}
