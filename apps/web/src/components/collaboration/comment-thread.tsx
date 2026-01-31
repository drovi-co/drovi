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

import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle,
  Edit2,
  MessageSquare,
  MoreHorizontal,
  Reply,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type CommentTargetType,
  useAddReaction,
  useComments,
  useCreateComment,
  useDeleteComment,
  useRemoveReaction,
  useResolveThread,
} from "@/hooks/use-collaboration";
import { cn } from "@/lib/utils";
import { MentionInput } from "./mention-input";

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
    if (!newComment.trim()) {
      return;
    }

    await createComment.mutateAsync({
      organizationId,
      targetType,
      targetId,
      content: newComment,
    });

    setNewComment("");
    refetch();
  }, [
    newComment,
    organizationId,
    targetType,
    targetId,
    createComment,
    refetch,
  ]);

  // Handle reply submission
  const handleSubmitReply = useCallback(
    async (parentId: string) => {
      if (!replyContent.trim()) {
        return;
      }

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
              comment={comment}
              currentUserId={currentUserId}
              key={comment.id}
              onDelete={handleDelete}
              onRefetch={refetch}
              onReplyChange={setReplyContent}
              onReplyClick={(id) =>
                setReplyingTo(id === replyingTo ? null : id)
              }
              onReplySubmit={handleSubmitReply}
              onResolve={handleResolve}
              organizationId={organizationId}
              replies={replyMap.get(comment.id) ?? []}
              replyContent={replyContent}
              replyingTo={replyingTo}
              replyMap={replyMap}
            />
          ))
        )}
      </div>

      {/* New comment input */}
      <div className="space-y-2 border-t pt-4">
        <MentionInput
          maxRows={6}
          minRows={2}
          onChange={setNewComment}
          organizationId={organizationId}
          placeholder="Write a comment... Use @ to mention someone"
          value={newComment}
        />
        <div className="flex justify-end">
          <Button
            disabled={!newComment.trim() || createComment.isPending}
            onClick={handleSubmitComment}
            size="sm"
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
            <p className="font-medium text-sm">
              {comment.user?.name ?? "Unknown"}
            </p>
            <p className="text-muted-foreground text-xs">
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
            <Button className="h-8 w-8" size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onReplyClick(comment.id)}>
              <Reply className="mr-2 h-4 w-4" />
              Reply
            </DropdownMenuItem>
            {!(comment.parentCommentId || comment.isResolved) && (
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
                  className="text-destructive"
                  onClick={() => onDelete(comment.id)}
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
        <div className="mt-2 flex items-center gap-1 text-green-600 text-xs dark:text-green-400">
          <CheckCircle className="h-3 w-3" />
          Resolved by {comment.resolvedByUser?.name ?? "someone"}
        </div>
      )}

      {/* Content */}
      <div className="mt-3 text-sm">
        {comment.isDeleted ? (
          <span className="text-muted-foreground italic">[deleted]</span>
        ) : (
          (comment.contentPlainText ?? comment.content)
        )}
      </div>

      {/* Reactions */}
      {comment.reactions && comment.reactions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {comment.reactions.map((reaction) => (
            <button
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors hover:bg-accent",
                reaction.userIds.includes(currentUserId) &&
                  "border-primary bg-primary/10"
              )}
              key={reaction.emoji}
              onClick={() => handleReaction(reaction.emoji)}
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
            <Button className="h-6 px-2" size="sm" variant="ghost">
              <SmilePlus className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <div className="grid grid-cols-4 gap-1 p-2">
              {COMMON_REACTIONS.map((emoji) => (
                <button
                  className="rounded p-1 text-lg hover:bg-accent"
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          className="h-6 px-2"
          onClick={() => onReplyClick(comment.id)}
          size="sm"
          variant="ghost"
        >
          <Reply className="mr-1 h-3.5 w-3.5" />
          Reply
        </Button>
      </div>

      {/* Reply input */}
      {replyingTo === comment.id && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <MentionInput
            maxRows={4}
            minRows={1}
            onChange={onReplyChange}
            organizationId={organizationId}
            placeholder="Write a reply..."
            value={replyContent}
          />
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => onReplyClick(comment.id)}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={!replyContent.trim()}
              onClick={() => onReplySubmit(comment.id)}
              size="sm"
            >
              Reply
            </Button>
          </div>
        </div>
      )}

      {/* Nested replies */}
      {replies.length > 0 && (
        <div className="mt-4 ml-6 space-y-3 border-l-2 pl-4">
          {replies.map((reply) => (
            <CommentItem
              comment={reply}
              currentUserId={currentUserId}
              key={reply.id}
              onDelete={onDelete}
              onRefetch={onRefetch}
              onReplyChange={onReplyChange}
              onReplyClick={onReplyClick}
              onReplySubmit={onReplySubmit}
              onResolve={onResolve}
              organizationId={organizationId}
              replies={replyMap.get(reply.id) ?? []}
              replyContent={replyContent}
              replyingTo={replyingTo}
              replyMap={replyMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
