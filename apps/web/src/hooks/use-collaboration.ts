/**
 * Collaboration Hooks
 *
 * Provides React Query hooks for team collaboration features:
 * - @mentions
 * - Comments & discussions
 * - Activity feed
 * - Delegations
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// Types
// =============================================================================

export type MentionType = "user" | "team" | "all" | "channel";

export type MentionContextType =
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "uio"
  | "contact"
  | "comment"
  | "note";

export type CommentTargetType =
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "uio"
  | "contact";

export type ActivityType =
  | "commitment_created"
  | "commitment_updated"
  | "commitment_completed"
  | "commitment_overdue"
  | "decision_made"
  | "decision_updated"
  | "decision_reversed"
  | "task_created"
  | "task_assigned"
  | "task_completed"
  | "comment_added"
  | "comment_resolved"
  | "mention"
  | "share"
  | "share_request"
  | "conversation_assigned"
  | "conversation_claimed"
  | "conversation_resolved"
  | "conversation_escalated"
  | "deadline_approaching"
  | "deadline_missed"
  | "risk_detected"
  | "risk_resolved"
  | "member_joined"
  | "member_left"
  | "settings_changed";

// =============================================================================
// MENTION HOOKS
// =============================================================================

/**
 * Get unread mentions for the current user.
 */
export function useUnreadMentions(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getUnreadMentions.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled ?? true, refetchInterval: 30000 }
    )
  );
}

/**
 * Get mentions for a specific resource.
 */
export function useMentionsForResource(params: {
  organizationId: string;
  contextType: MentionContextType;
  contextId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getMentionsForResource.queryOptions(
      {
        organizationId: params.organizationId,
        contextType: params.contextType,
        contextId: params.contextId,
      },
      { enabled: params.enabled ?? true }
    )
  );
}

/**
 * Create a new mention.
 */
export function useCreateMention(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.createMention.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getMentionsForResource"],
        });
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getActivityFeed"],
        });
      },
    })
  );
}

/**
 * Mark mentions as read.
 */
export function useMarkMentionsRead(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.markMentionsRead.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getUnreadMentions"],
        });
      },
    })
  );
}

// =============================================================================
// COMMENT HOOKS
// =============================================================================

/**
 * Get comments for a specific resource.
 */
export function useComments(params: {
  organizationId: string;
  targetType: CommentTargetType;
  targetId: string;
  includeDeleted?: boolean;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getCommentsForResource.queryOptions(
      {
        organizationId: params.organizationId,
        targetType: params.targetType,
        targetId: params.targetId,
        includeDeleted: params.includeDeleted,
      },
      { enabled: params.enabled ?? true }
    )
  );
}

/**
 * Create a new comment.
 */
export function useCreateComment(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.createComment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getActivityFeed"],
        });
      },
    })
  );
}

/**
 * Update a comment.
 */
export function useUpdateComment(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.updateComment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
      },
    })
  );
}

/**
 * Delete a comment.
 */
export function useDeleteComment(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.deleteComment.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
      },
    })
  );
}

/**
 * Add reaction to a comment.
 */
export function useAddReaction(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.addReaction.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
      },
    })
  );
}

/**
 * Remove reaction from a comment.
 */
export function useRemoveReaction(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.removeReaction.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
      },
    })
  );
}

/**
 * Resolve a comment thread.
 */
export function useResolveThread(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.resolveThread.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getCommentsForResource"],
        });
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getActivityFeed"],
        });
      },
    })
  );
}

// =============================================================================
// ACTIVITY FEED HOOKS
// =============================================================================

/**
 * Get activity feed.
 */
export function useActivityFeed(params: {
  organizationId: string;
  activityTypes?: ActivityType[];
  targetType?: string;
  targetId?: string;
  limit?: number;
  cursor?: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getActivityFeed.queryOptions(
      {
        organizationId: params.organizationId,
        activityTypes: params.activityTypes,
        targetType: params.targetType,
        targetId: params.targetId,
        limit: params.limit,
        cursor: params.cursor,
      },
      { enabled: params.enabled ?? true, refetchInterval: 30000 }
    )
  );
}

/**
 * Get activity for a specific resource.
 */
export function useResourceActivity(params: {
  organizationId: string;
  targetType: string;
  targetId: string;
  limit?: number;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getActivityForResource.queryOptions(
      {
        organizationId: params.organizationId,
        targetType: params.targetType,
        targetId: params.targetId,
        limit: params.limit,
      },
      { enabled: params.enabled ?? true }
    )
  );
}

/**
 * Mark activity as seen.
 */
export function useMarkActivitySeen(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.markActivitySeen.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getUnreadActivityCount"],
        });
      },
    })
  );
}

/**
 * Get unread activity count.
 */
export function useUnreadActivityCount(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getUnreadActivityCount.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled ?? true, refetchInterval: 30000 }
    )
  );
}

// =============================================================================
// DELEGATION HOOKS
// =============================================================================

/**
 * Create a delegation.
 */
export function useCreateDelegation(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.createDelegation.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getMyDelegations"],
        });
      },
    })
  );
}

/**
 * Revoke a delegation.
 */
export function useRevokeDelegation(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.collaboration.revokeDelegation.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getMyDelegations"],
        });
        queryClient.invalidateQueries({
          queryKey: ["collaboration", "getDelegatedToMe"],
        });
      },
    })
  );
}

/**
 * Get delegations I've created.
 */
export function useMyDelegations(params: {
  organizationId: string;
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getMyDelegations.queryOptions(
      {
        organizationId: params.organizationId,
        includeInactive: params.includeInactive,
      },
      { enabled: params.enabled ?? true }
    )
  );
}

/**
 * Get delegations assigned to me.
 */
export function useDelegatedToMe(params: {
  organizationId: string;
  includeInactive?: boolean;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.collaboration.getDelegatedToMe.queryOptions(
      {
        organizationId: params.organizationId,
        includeInactive: params.includeInactive,
      },
      { enabled: params.enabled ?? true }
    )
  );
}
