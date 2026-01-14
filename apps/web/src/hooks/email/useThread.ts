import { trpc } from "@/utils/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface UseThreadOptions {
  threadId: string;
  accountId?: string;
}

// =============================================================================
// HOOK
// =============================================================================

export function useThread({ threadId }: UseThreadOptions) {
  const queryClient = useQueryClient();

  // Fetch thread details
  const {
    data: threadData,
    isLoading: isLoadingThread,
    refetch: refetchThread,
  } = useQuery({
    ...trpc.threads.getById.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch messages
  const {
    data: messagesData,
    isLoading: isLoadingMessages,
    refetch: refetchMessages,
  } = useQuery({
    ...trpc.threads.getMessages.queryOptions({ threadId }),
    enabled: !!threadId,
  });

  // Fetch intelligence
  const {
    data: intelligenceData,
    isLoading: isLoadingIntelligence,
    refetch: refetchIntelligence,
  } = useQuery({
    ...trpc.threads.getIntelligence.queryOptions({ threadId }),
    enabled: !!threadId,
    staleTime: 60000, // 1 minute - intelligence doesn't change often
  });

  // Fetch related context (memory panel data)
  const {
    data: contextData,
    isLoading: isLoadingContext,
    refetch: refetchContext,
  } = useQuery({
    ...trpc.threads.getRelatedContext.queryOptions({ threadId }),
    enabled: !!threadId,
    staleTime: 60000,
  });

  // Mutations
  const archiveMutation = useMutation({
    ...trpc.threads.archive.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  const starMutation = useMutation({
    ...trpc.threads.star.mutationOptions(),
    onMutate: async ({ starred }) => {
      await queryClient.cancelQueries({
        queryKey: ["threads", "getById", threadId],
      });
      const previousThread = queryClient.getQueryData([
        "threads",
        "getById",
        threadId,
      ]);

      queryClient.setQueryData(
        ["threads", "getById", threadId],
        (old: { thread: { isStarred: boolean } } | undefined) => {
          if (!old) return old;
          return {
            ...old,
            thread: { ...old.thread, isStarred: starred },
          };
        }
      );

      return { previousThread };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousThread) {
        queryClient.setQueryData(
          ["threads", "getById", threadId],
          context.previousThread
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

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

  // Feedback mutations
  const commitmentFeedbackMutation = useMutation({
    ...trpc.commitments.feedback.mutationOptions(),
    onSuccess: () => {
      refetchIntelligence();
    },
  });

  const decisionFeedbackMutation = useMutation({
    ...trpc.decisions.feedback.mutationOptions(),
    onSuccess: () => {
      refetchIntelligence();
    },
  });

  const completeCommitmentMutation = useMutation({
    ...trpc.commitments.complete.mutationOptions(),
    onSuccess: () => {
      refetchIntelligence();
    },
  });

  // Actions
  const handleArchive = useCallback(async () => {
    await archiveMutation.mutateAsync({ threadId });
  }, [archiveMutation, threadId]);

  const handleStar = useCallback(
    async (starred: boolean) => {
      await starMutation.mutateAsync({ threadId, starred });
    },
    [starMutation, threadId]
  );

  const handleDelete = useCallback(async () => {
    await deleteMutation.mutateAsync({ threadId });
  }, [deleteMutation, threadId]);

  const handleMarkRead = useCallback(
    async (read: boolean) => {
      await markReadMutation.mutateAsync({ threadId, read });
    },
    [markReadMutation, threadId]
  );

  const handleCommitmentFeedback = useCallback(
    async (commitmentId: string, positive: boolean) => {
      await commitmentFeedbackMutation.mutateAsync({
        commitmentId,
        positive,
      });
    },
    [commitmentFeedbackMutation]
  );

  const handleDecisionFeedback = useCallback(
    async (decisionId: string, positive: boolean) => {
      await decisionFeedbackMutation.mutateAsync({
        decisionId,
        positive,
      });
    },
    [decisionFeedbackMutation]
  );

  const handleCompleteCommitment = useCallback(
    async (commitmentId: string) => {
      await completeCommitmentMutation.mutateAsync({ commitmentId });
    },
    [completeCommitmentMutation]
  );

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchThread(),
      refetchMessages(),
      refetchIntelligence(),
      refetchContext(),
    ]);
  }, [refetchThread, refetchMessages, refetchIntelligence, refetchContext]);

  return {
    // Thread data
    thread: threadData?.thread ?? null,
    messages: messagesData?.messages ?? [],

    // Intelligence data
    commitments: intelligenceData?.commitments ?? [],
    decisions: intelligenceData?.decisions ?? [],
    openQuestions: intelligenceData?.openQuestions ?? [],
    riskWarnings: intelligenceData?.riskWarnings ?? [],

    // Context data
    relatedThreads: contextData?.relatedThreads ?? [],
    relatedDecisions: contextData?.relatedDecisions ?? [],
    relatedCommitments: contextData?.relatedCommitments ?? [],
    contactContexts: contextData?.contactContexts ?? [],
    timeline: contextData?.timeline ?? [],

    // Loading states
    isLoading:
      isLoadingThread ||
      isLoadingMessages ||
      isLoadingIntelligence ||
      isLoadingContext,
    isLoadingThread,
    isLoadingMessages,
    isLoadingIntelligence,
    isLoadingContext,

    // Actions
    handleArchive,
    handleStar,
    handleDelete,
    handleMarkRead,
    handleCommitmentFeedback,
    handleDecisionFeedback,
    handleCompleteCommitment,
    refetchAll,
  };
}
