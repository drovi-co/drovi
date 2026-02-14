/**
 * UIO (Unified Intelligence Object) Hooks
 *
 * Provides React Query hooks for working with UIOs across all types:
 * - Commitments, Decisions, Claims, Tasks, Risks
 *
 * Uses the Python backend API directly via the intelligenceAPI client.
 */

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  list: (params: {
    organizationId?: string;
    type?: string;
    status?: string;
    time_range?: string;
  }) =>
    [...uioKeys.lists(), params.organizationId ?? "no-org", params] as const,
  details: () => [...uioKeys.all, "detail"] as const,
  detail: (params: { organizationId?: string; id: string }) =>
    [
      ...uioKeys.details(),
      params.organizationId ?? "no-org",
      params.id,
    ] as const,
};

function patchUpdatedUIOInCache(queryClient: QueryClient, updated: UIO): void {
  queryClient.setQueriesData<UIO>(
    {
      queryKey: uioKeys.details(),
    },
    (current) => {
      if (!current) return current;
      return current.id === updated.id ? updated : current;
    }
  );

  queryClient.setQueriesData<UIOListResponse>(
    {
      queryKey: uioKeys.lists(),
    },
    (current) => {
      if (!current) return current;
      let changed = false;
      const items = current.items.map((item) => {
        if (item.id !== updated.id) return item;
        changed = true;
        return updated;
      });
      if (!changed) return current;
      return { ...current, items };
    }
  );
}

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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
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
    enabled,
  });
}

/**
 * Fetch a single UIO with all its details.
 */
export function useUIO(params: {
  organizationId?: string;
  id: string;
  enabled?: boolean;
}) {
  const enabled =
    params.enabled !== false && !!params.organizationId && !!params.id;

  return useQuery({
    queryKey: uioKeys.detail({
      organizationId: params.organizationId,
      id: params.id,
    }),
    queryFn: async (): Promise<UIO> => {
      return intelligenceAPI.getUIO(params.id);
    },
    enabled,
  });
}

/**
 * Get UIO statistics for dashboard.
 */
export function useUIOStats(params: {
  organizationId?: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false && !!params.organizationId;

  // Stats are computed from listing all UIOs
  const commitmentsQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "commitment",
      }),
      "stats",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "commitment",
        status: "all",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const decisionsQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "decision",
      }),
      "stats",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "decision",
        status: "all",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const tasksQuery = useQuery({
    queryKey: [
      ...uioKeys.list({ organizationId: params.organizationId, type: "task" }),
      "stats",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "task",
        status: "all",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const risksQuery = useQuery({
    queryKey: [
      ...uioKeys.list({ organizationId: params.organizationId, type: "risk" }),
      "stats",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "risk",
        status: "all",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  return {
    data:
      commitmentsQuery.data &&
      decisionsQuery.data &&
      tasksQuery.data &&
      risksQuery.data
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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
      type: "commitment",
      status: params.status,
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      // Map frontend status to backend status
      let backendStatus: string | undefined;
      if (params.status === "overdue") {
        backendStatus = "overdue";
      } else if (
        params.status === "pending" ||
        params.status === "in_progress" ||
        params.status === "waiting"
      ) {
        backendStatus = "open";
      } else if (
        params.status === "completed" ||
        params.status === "cancelled"
      ) {
        backendStatus = "completed";
      }

      return intelligenceAPI.listUIOs({
        type: "commitment",
        status: backendStatus,
        limit: params.limit ?? 50,
      });
    },
    enabled,
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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
      type: "decision",
      status: params.status,
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "decision",
        status: params.status === "pending" ? "open" : undefined,
        limit: params.limit ?? 50,
      });
    },
    enabled,
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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
      type: "task",
      status: params.status,
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      // Map frontend status to backend status
      let backendStatus: string | undefined;
      if (
        params.status === "backlog" ||
        params.status === "todo" ||
        params.status === "in_progress" ||
        params.status === "in_review"
      ) {
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
    enabled,
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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
      type: "risk",
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "risk",
        limit: params.limit ?? 50,
      });
    },
    enabled,
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
  const enabled = params.enabled !== false && !!params.organizationId;

  // Briefs map to high-priority open items
  return useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        status: "open",
      }),
      "briefs",
      params.priorityTier,
    ],
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        status: "open",
        limit: params.limit ?? 50,
      });
    },
    enabled,
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
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: uioKeys.list({
      organizationId: params.organizationId,
      type: "commitment",
      status: "overdue",
    }),
    queryFn: async (): Promise<UIOListResponse> => {
      return intelligenceAPI.listUIOs({
        type: "commitment",
        status: "overdue",
        limit: params.limit ?? 20,
      });
    },
    enabled,
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
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: string;
      organizationId?: string;
    }) => {
      return intelligenceAPI.updateStatus(id, status);
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
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
      updates: {
        canonical_title?: string;
        canonical_description?: string;
        due_date?: string;
      };
    }) => {
      return intelligenceAPI.updateUIO(id, updates, organizationId);
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
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
      return intelligenceAPI.updateStatus(id, "archived");
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
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
      return intelligenceAPI.updateStatus(id, "active");
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
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
      return intelligenceAPI.updateStatus(id, "archived");
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
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
      return intelligenceAPI.updateStatus(id, "completed");
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
    },
  });
}

/**
 * Snooze a commitment until a specified date.
 */
export function useSnoozeUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string;
      organizationId?: string;
      until?: Date;
    }) => {
      // For now, just mark as in_progress (snooze functionality would need backend support)
      return intelligenceAPI.updateStatus(id, "in_progress");
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
    },
  });
}

/**
 * Update task status.
 */
export function useUpdateTaskStatusUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: string;
      organizationId?: string;
    }) => {
      return intelligenceAPI.updateStatus(id, status);
    },
    onSuccess: (updated) => {
      patchUpdatedUIOInCache(queryClient, updated);
    },
  });
}

/**
 * Update task priority.
 */
export function useUpdateTaskPriorityUIO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
    }: {
      id: string;
      priority: string;
      organizationId?: string;
    }) => {
      // Priority updates would need backend support
      // For now, this is a no-op that invalidates cache
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: uioKeys.lists() });
    },
  });
}

// =============================================================================
// Stats Hooks
// =============================================================================

/**
 * Get commitment statistics.
 */
export function useCommitmentStats(params: {
  organizationId?: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false && !!params.organizationId;

  const openQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "commitment",
        status: "open",
      }),
      "count",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "commitment",
        status: "open",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const overdueQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "commitment",
        status: "overdue",
      }),
      "count",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "commitment",
        status: "overdue",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const completedQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "commitment",
        status: "completed",
      }),
      "count",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "commitment",
        status: "completed",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  return {
    data:
      openQuery.data && overdueQuery.data && completedQuery.data
        ? {
            open: openQuery.data.total,
            overdue: overdueQuery.data.total,
            completed: completedQuery.data.total,
            total:
              openQuery.data.total +
              overdueQuery.data.total +
              completedQuery.data.total,
          }
        : null,
    isLoading:
      openQuery.isLoading || overdueQuery.isLoading || completedQuery.isLoading,
    error: openQuery.error || overdueQuery.error || completedQuery.error,
  };
}

/**
 * Get decision statistics.
 */
export function useDecisionStats(params: {
  organizationId?: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false && !!params.organizationId;

  return useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "decision",
        status: "all",
      }),
      "stats",
    ],
    queryFn: async () => {
      const result = await intelligenceAPI.listUIOs({
        type: "decision",
        status: "all",
        limit: 1,
        includeTotal: true,
      });
      return {
        data: {
          total: result.total,
        },
      };
    },
    enabled,
  });
}

/**
 * Get task statistics.
 */
export function useTaskStats(params: {
  organizationId?: string;
  enabled?: boolean;
}) {
  const enabled = params.enabled !== false && !!params.organizationId;

  const openQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "task",
        status: "open",
      }),
      "count",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "task",
        status: "open",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
  });

  const completedQuery = useQuery({
    queryKey: [
      ...uioKeys.list({
        organizationId: params.organizationId,
        type: "task",
        status: "completed",
      }),
      "count",
    ],
    queryFn: () =>
      intelligenceAPI.listUIOs({
        type: "task",
        status: "completed",
        limit: 1,
        includeTotal: true,
      }),
    enabled,
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
