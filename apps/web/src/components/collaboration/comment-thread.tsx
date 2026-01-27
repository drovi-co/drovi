"use client";

/**
 * CommentThread
 *
 * Displays a threaded comment discussion with:
 * - Nested replies
 * - Emoji reactions
 * - Thread resolution
 * - Edit/delete capabilities
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  useComments,
  useCreateComment,
  useAddReaction,
  useRemoveReaction,
  useResolveThread,
  useDeleteComment,
  type CommentTargetType,
} from "@/hooks/use-collaboration";
import { useTypingIndicator, useResourceViewers } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  MoreHorizontal,
  CheckCircle,
  Trash2,
  Edit2,
  Reply,
  SmilePlus,
} from "lucide-react";
import { MentionInput, type MentionData } from "./mention-input";
import { TypingIndicator } from "./who-is-viewing";
import { formatDistanceToNow } from "date-fns";

// =============================================================================
// Types
// =============================================================================

interface Comment {
  id: string;
  organizationId: string;
  userId: string;
  targetType: string;
  targetId: string;
  content: string;
  contentPlainText: string | null;
  parentCommentId: string | null;
  rootCommentId: string | null;
  depth: number;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
  }> | null;
  isResolved: boolean;
  resolvedByUserId: string | null;
  resolvedAt: string | null; // Serialized as string from API
  isEdited: boolean;
  editedAt: string | null; // Serialized as string from API
  isDeleted: boolean;
  deletedAt: string | null; // Serialized as string from API
  deletedByUserId: string | null;
  reactions: Array<{
    emoji: string;
    userIds: string[];
    count: number;
  }> | null;
  createdAt: string; // Serialized as string from API
  updatedAt: string; // Serialized as string from API
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
  resolvedByUser?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

interface CommentThreadProps {
  organizationId: string;
  targetType: CommentTargetType;
  targetId: string;
  currentUserId: string;
  className?: string;
}

// =============================================================================
// Common Reactions
// =============================================================================

const COMMON_REACTIONS = ["👍", "👎", "❤️", "🎉", "😄", "😢", "🤔", "👀"];

// =============================================================================
// Main Component
// =============================================================================

export function CommentThread({
  organizationId,
  targetType,
  targetId,
  currentUserId,
  className,
}: CommentThreadProps) {
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");

  const { data, isLoading, refetch } = useComments({
    organizationId,
    targetType,
    targetId,
  });

  const createComment = useCreateComment({ organizationId });
  const resolveThread = useResolveThread({ organizationId });
  const deleteComment = useDeleteComment({ organizationId });

  // Typing indicator for comment thread
  const resourceType = targetType === "conversation" ? "conversation" : targetType === "uio" ? "uio" : "other";
  const { setTyping } = useTypingIndicator({
    organizationId,
    resourceType: resourceType as "conversation" | "uio" | "other",
    resourceId: targetId,
  });

  // Track typing when user is writing - debounced to prevent rapid calls
  const typingDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingStateRef = useRef(false);

  useEffect(() => {
    const isTyping = newComment.length > 0;

    // Skip if state hasn't changed
    if (isTyping === lastTypingStateRef.current) {
      return;
    }

    // Clear previous debounce
    if (typingDebounceRef.current) {
      clearTimeout(typingDebounceRef.current);
    }

    // Debounce the typing state change
    typingDebounceRef.current = setTimeout(() => {
      lastTypingStateRef.current = isTyping;
      setTyping(isTyping);
    }, 300);

    return () => {
      if (typingDebounceRef.current) {
        clearTimeout(typingDebounceRef.current);
      }
    };
  }, [newComment.length, setTyping]);

  const comments = data?.comments ?? [];

  // Build thread structure
  const rootComments = comments.filter((c) => !c.parentCommentId);
  const replyMap = new Map<string, Comment[]>();
  for (const comment of comments) {
    if (comment.parentCommentId) {
      const existing = replyMap.get(comment.parentCommentId) ?? [];
      existing.push(comment);
      replyMap.set(comment.parentCommentId, existing);
    }
  }

  // Handle new comment submission
  const handleSubmitComment = useCallback(async () => {
    if (!newComment.trim()) return;

    await createComment.mutateAsync({
      organizationId,
      targetType,
      targetId,
      content: newComment,
    });

    setNewComment("");
    refetch();
  }, [newComment, organizationId, targetType, targetId, createComment, refetch]);

  // Handle reply submission
  const handleSubmitReply = useCallback(
    async (parentId: string) => {
      if (!replyContent.trim()) return;

      await createComment.mutateAsync({
        organizationId,
        targetType,
        targetId,
        content: replyContent,
        parentCommentId: parentId,
      });

      setReplyContent("");
      setReplyingTo(null);
      refetch();
    },
    [replyContent, organizationId, targetType, targetId, createComment, refetch]
  );

  // Handle resolve
  const handleResolve = useCallback(
    async (commentId: string) => {
      await resolveThread.mutateAsync({
        organizationId,
        commentId,
      });
      refetch();
    },
    [organizationId, resolveThread, refetch]
  );

  // Handle delete
  const handleDelete = useCallback(
    async (commentId: string) => {
      await deleteComment.mutateAsync({
        organizationId,
        commentId,
      });
      refetch();
    },
    [organizationId, deleteComment, refetch]
  );

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Comment list */}
      <div className="space-y-4">
        {rootComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <MessageSquare className="mb-2 h-8 w-8" />
            <p>No comments yet</p>
            <p className="text-sm">Be the first to comment!</p>
          </div>
        ) : (
          rootComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={replyMap.get(comment.id) ?? []}
              replyMap={replyMap}
              currentUserId={currentUserId}
              organizationId={organizationId}
              replyingTo={replyingTo}
              replyContent={replyContent}
              onReplyClick={(id) => setReplyingTo(id === replyingTo ? null : id)}
              onReplyChange={setReplyContent}
              onReplySubmit={handleSubmitReply}
              onResolve={handleResolve}
              onDelete={handleDelete}
              onRefetch={refetch}
            />
          ))
        )}
      </div>

      {/* New comment input */}
      <div className="space-y-2 border-t pt-4">
        {/* Typing indicator */}
        <TypingIndicator
          organizationId={organizationId}
          resourceType={resourceType as "conversation" | "uio" | "other"}
          resourceId={targetId}
        />
        <MentionInput
          organizationId={organizationId}
          value={newComment}
          onChange={setNewComment}
          placeholder="Write a comment... Use @ to mention someone"
          minRows={2}
          maxRows={6}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleSubmitComment}
            disabled={!newComment.trim() || createComment.isPending}
          >
            {createComment.isPending ? "Posting..." : "Post Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Comment Item Component
// =============================================================================

interface CommentItemProps {
  comment: Comment;
  replies: Comment[];
  replyMap: Map<string, Comment[]>;
  currentUserId: string;
  organizationId: string;
  replyingTo: string | null;
  replyContent: string;
  onReplyClick: (id: string) => void;
  onReplyChange: (content: string) => void;
  onReplySubmit: (parentId: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onRefetch: () => void;
}

function CommentItem({
  comment,
  replies,
  replyMap,
  currentUserId,
  organizationId,
  replyingTo,
  replyContent,
  onReplyClick,
  onReplyChange,
  onReplySubmit,
  onResolve,
  onDelete,
  onRefetch,
}: CommentItemProps) {
  const isOwner = comment.userId === currentUserId;
  const addReaction = useAddReaction({ organizationId });
  const removeReaction = useRemoveReaction({ organizationId });

  const handleReaction = async (emoji: string) => {
    const existing = comment.reactions?.find((r) => r.emoji === emoji);
    const hasReacted = existing?.userIds.includes(currentUserId);

    if (hasReacted) {
      await removeReaction.mutateAsync({
        organizationId,
        commentId: comment.id,
        emoji,
      });
    } else {
      await addReaction.mutateAsync({
        organizationId,
        commentId: comment.id,
        emoji,
      });
    }
    onRefetch();
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        comment.isResolved && "bg-muted/50",
        comment.isDeleted && "opacity-50"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={comment.user?.image ?? undefined} />
            <AvatarFallback>
              {comment.user?.name
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2) ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">
              {comment.user?.name ?? "Unknown"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.createdAt), {
                addSuffix: true,
              })}
              {comment.isEdited && " (edited)"}
            </p>
          </div>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onReplyClick(comment.id)}>
              <Reply className="mr-2 h-4 w-4" />
              Reply
            </DropdownMenuItem>
            {!comment.parentCommentId && !comment.isResolved && (
              <DropdownMenuItem onClick={() => onResolve(comment.id)}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Resolve Thread
              </DropdownMenuItem>
            )}
            {isOwner && !comment.isDeleted && (
              <>
                <DropdownMenuItem>
                  <Edit2 className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(comment.id)}
                  className="text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Resolved badge */}
      {comment.isResolved && (
        <div className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Resolved by {comment.resolvedByUser?.name ?? "someone"}
        </div>
      )}

      {/* Content */}
      <div className="mt-3 text-sm">
        {comment.isDeleted ? (
          <span className="italic text-muted-foreground">[deleted]</span>
        ) : (
          comment.contentPlainText ?? comment.content
        )}
      </div>

      {/* Reactions */}
      {comment.reactions && comment.reactions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {comment.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              onClick={() => handleReaction(reaction.emoji)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                reaction.userIds.includes(currentUserId) &&
                  "border-primary bg-primary/10"
              )}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Add reaction button */}
      <div className="mt-2 flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2">
              <SmilePlus className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <div className="grid grid-cols-4 gap-1 p-2">
              {COMMON_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className="rounded p-1 text-lg hover:bg-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={() => onReplyClick(comment.id)}
        >
          <Reply className="mr-1 h-3.5 w-3.5" />
          Reply
        </Button>
      </div>

      {/* Reply input */}
      {replyingTo === comment.id && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <MentionInput
            organizationId={organizationId}
            value={replyContent}
            onChange={onReplyChange}
            placeholder="Write a reply..."
            minRows={1}
            maxRows={4}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReplyClick(comment.id)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => onReplySubmit(comment.id)}
              disabled={!replyContent.trim()}
            >
              Reply
            </Button>
          </div>
        </div>
      )}

      {/* Nested replies */}
      {replies.length > 0 && (
        <div className="ml-6 mt-4 space-y-3 border-l-2 pl-4">
          {replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              replies={replyMap.get(reply.id) ?? []}
              replyMap={replyMap}
              currentUserId={currentUserId}
              organizationId={organizationId}
              replyingTo={replyingTo}
              replyContent={replyContent}
              onReplyClick={onReplyClick}
              onReplyChange={onReplyChange}
              onReplySubmit={onReplySubmit}
              onResolve={onResolve}
              onDelete={onDelete}
              onRefetch={onRefetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
