import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type {
  InboxFilter,
  InboxSort,
  IntelligenceFilter,
} from "@/components/email/thread-list";
import { trpc } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

export interface UseInboxOptions {
  accountId?: string;
  initialFilter?: InboxFilter;
  initialSort?: InboxSort;
  initialIntelligenceFilter?: IntelligenceFilter;
}

// =============================================================================
// HOOK
// =============================================================================

export function useInbox(options: UseInboxOptions = {}) {
  const queryClient = useQueryClient();

  // State
  const [filter, setFilter] = useState<InboxFilter>(
    options.initialFilter ?? "all"
  );
  const [sort, setSort] = useState<InboxSort>(options.initialSort ?? "date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [intelligenceFilter, setIntelligenceFilter] =
    useState<IntelligenceFilter>(options.initialIntelligenceFilter ?? "all");
  const [selectedThreads, setSelectedThreads] = useState<Set<string>>(
    new Set()
  );

  // Build query filters
  const queryFilters = {
    accountId: options.accountId,
    filter,
    sort,
    sortDirection,
    intelligenceFilter,
  };

  // Fetch threads
  const {
    data: threadsData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    ...trpc.threads.listInbox.queryOptions(queryFilters),
    staleTime: 30_000, // 30 seconds
  });

  // Fetch unread count
  const { data: unreadData } = useQuery({
    ...trpc.threads.getUnreadCount.queryOptions({
      accountId: options.accountId,
    }),
    staleTime: 60_000, // 1 minute
  });

  // Mutations
  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const starMutation = useMutation(
    trpc.threads.star.mutationOptions({
      onMutate: async ({ threadId, starred }) => {
        // Optimistic update
        await queryClient.cancelQueries({ queryKey: ["threads"] });
        const previousThreads = queryClient.getQueryData([
          "threads",
          queryFilters,
        ]);

        queryClient.setQueryData(
          ["threads", queryFilters],
          (
            old:
              | { threads: Array<{ id: string; isStarred: boolean }> }
              | undefined
          ) => {
            if (!old) {
              return old;
            }
            return {
              ...old,
              threads: old.threads.map((t) =>
                t.id === threadId ? { ...t, isStarred: starred } : t
              ),
            };
          }
        );

        return undefined;
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: ["threads"] });
      },
    })
  );

  const markReadMutation = useMutation({
    ...trpc.threads.markRead.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const deleteMutation = useMutation({
    ...trpc.threads.delete.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const snoozeMutation = useMutation({
    ...trpc.threads.snooze.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  // Actions
  const handleThreadAction = useCallback(
    async (threadId: string, action: string) => {
      switch (action) {
        case "archive":
          await archiveMutation.mutateAsync({ threadId });
          break;
        case "star":
          await starMutation.mutateAsync({ threadId, starred: true });
          break;
        case "unstar":
          await starMutation.mutateAsync({ threadId, starred: false });
          break;
        case "mark_read":
          await markReadMutation.mutateAsync({ threadId, read: true });
          break;
        case "mark_unread":
          await markReadMutation.mutateAsync({ threadId, read: false });
          break;
        case "delete":
          await deleteMutation.mutateAsync({ threadId });
          break;
        case "snooze": {
          // Default snooze to tomorrow 9am
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          await snoozeMutation.mutateAsync({ threadId, until: tomorrow });
          break;
        }
      }
    },
    [
      archiveMutation,
      starMutation,
      markReadMutation,
      deleteMutation,
      snoozeMutation,
    ]
  );

  const handleBatchAction = useCallback(
    async (threadIds: string[], action: string) => {
      await Promise.all(
        threadIds.map((threadId) => handleThreadAction(threadId, action))
      );
      setSelectedThreads(new Set());
    },
    [handleThreadAction]
  );

  return {
    // Data
    threads: threadsData?.threads ?? [],
    totalCount: threadsData?.total ?? 0,
    unreadCount: unreadData?.count ?? 0,

    // Loading states
    isLoading,
    isRefetching,

    // Filters
    filter,
    setFilter,
    sort,
    setSort,
    sortDirection,
    setSortDirection,
    intelligenceFilter,
    setIntelligenceFilter,

    // Selection
    selectedThreads,
    setSelectedThreads,

    // Actions
    handleThreadAction,
    handleBatchAction,
    refetch,
  };
}
