// =============================================================================
// TASK ACTIVITY FEED
// =============================================================================
//
// Displays a chronological log of all activities on a task including:
// - Status changes
// - Priority changes
// - Assignments
// - Comments
// - Label changes
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  MessageSquare,
  Plus,
  Send,
  Tag,
  User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

import {
  getActivityDescription,
  STATUS_CONFIG,
  type TaskActivity,
  type TaskStatus,
} from "./task-types";

// =============================================================================
// PROPS
// =============================================================================

interface TaskActivityFeedProps {
  taskId: string;
  organizationId: string;
  className?: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskActivityFeed({
  taskId,
  organizationId,
  className,
}: TaskActivityFeedProps) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");

  // Fetch activity
  const { data: activityData, isLoading } = useQuery({
    ...trpc.tasks.getActivity.queryOptions({
      organizationId,
      taskId,
    }),
    enabled: !!organizationId && !!taskId,
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    ...trpc.tasks.addComment.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "activity"] });
      setComment("");
      toast.success("Comment added");
    },
    onError: () => {
      toast.error("Failed to add comment");
    },
  });

  const handleSubmitComment = () => {
    if (!comment.trim()) return;
    addCommentMutation.mutate({
      organizationId,
      taskId,
      comment: comment.trim(),
    });
  };

  const activities = activityData?.activities ?? [];

  if (isLoading) {
    return <ActivityFeedSkeleton />;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Comment Input */}
      <div className="space-y-2">
        <Textarea
          placeholder="Add a comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmitComment();
            }
          }}
          rows={2}
          className="resize-none"
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            Press ⌘+Enter to submit
          </span>
          <Button
            size="sm"
            onClick={handleSubmitComment}
            disabled={!comment.trim() || addCommentMutation.isPending}
          >
            <Send className="h-4 w-4 mr-2" />
            Comment
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium mb-3">Activity</h4>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No activity yet
          </p>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => (
              <ActivityItem key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ACTIVITY ITEM
// =============================================================================

interface ActivityItemProps {
  activity: TaskActivity;
}

function ActivityItem({ activity }: ActivityItemProps) {
  const description = getActivityDescription(
    activity.activityType,
    activity.previousValue,
    activity.newValue
  );

  const isComment = activity.activityType === "comment_added";
  const isStatusChange = activity.activityType === "status_changed";

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <Avatar className="h-7 w-7 shrink-0">
        {activity.userImage ? (
          <AvatarImage src={activity.userImage} alt={activity.userName ?? ""} />
        ) : null}
        <AvatarFallback className="text-[10px]">
          {(activity.userName ?? "U").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">
            {activity.userName ?? "Unknown"}
          </span>
          <span className="text-sm text-muted-foreground">{description}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
          </span>
        </div>

        {/* Status change visualization */}
        {isStatusChange && activity.previousValue && activity.newValue && (
          <StatusChangeVisualization
            from={activity.previousValue as TaskStatus}
            to={activity.newValue as TaskStatus}
          />
        )}

        {/* Comment content */}
        {isComment && activity.comment && (
          <div className="mt-2 p-3 rounded-md bg-muted/50 text-sm">
            {activity.comment}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// STATUS CHANGE VISUALIZATION
// =============================================================================

interface StatusChangeVisualizationProps {
  from: TaskStatus;
  to: TaskStatus;
}

function StatusChangeVisualization({ from, to }: StatusChangeVisualizationProps) {
  const fromConfig = STATUS_CONFIG[from];
  const toConfig = STATUS_CONFIG[to];
  const FromIcon = fromConfig?.icon;
  const ToIcon = toConfig?.icon;

  if (!fromConfig || !toConfig) return null;

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        {FromIcon && <FromIcon className={cn("h-3.5 w-3.5", fromConfig.color)} />}
        <span className={fromConfig.color}>{fromConfig.label}</span>
      </div>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <div className="flex items-center gap-1.5 text-xs">
        {ToIcon && <ToIcon className={cn("h-3.5 w-3.5", toConfig.color)} />}
        <span className={toConfig.color}>{toConfig.label}</span>
      </div>
    </div>
  );
}

// =============================================================================
// ACTIVITY ICON
// =============================================================================

function getActivityIcon(activityType: string) {
  switch (activityType) {
    case "comment_added":
      return MessageSquare;
    case "assigned":
    case "unassigned":
      return User;
    case "label_added":
    case "label_removed":
      return Tag;
    default:
      return Plus;
  }
}

// =============================================================================
// SKELETON
// =============================================================================

function ActivityFeedSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <div className="flex justify-end">
          <Skeleton className="h-8 w-20" />
        </div>
      </div>
      <div className="border-t pt-4">
        <Skeleton className="h-4 w-16 mb-3" />
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPACT ACTIVITY FEED (For inline display)
// =============================================================================

interface CompactActivityFeedProps {
  taskId: string;
  organizationId: string;
  maxItems?: number;
  className?: string;
}

export function CompactActivityFeed({
  taskId,
  organizationId,
  maxItems = 3,
  className,
}: CompactActivityFeedProps) {
  const { data: activityData, isLoading } = useQuery({
    ...trpc.tasks.getActivity.queryOptions({
      organizationId,
      taskId,
      limit: maxItems,
    }),
    enabled: !!organizationId && !!taskId,
  });

  const activities = activityData?.activities ?? [];

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)}>
        {[...Array(maxItems)].map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Avatar className="h-4 w-4">
            {activity.userImage ? (
              <AvatarImage src={activity.userImage} alt={activity.userName ?? ""} />
            ) : null}
            <AvatarFallback className="text-[8px]">
              {(activity.userName ?? "U").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">
            {activity.userName ?? "Unknown"}{" "}
            {getActivityDescription(
              activity.activityType,
              activity.previousValue,
              activity.newValue
            )}
          </span>
          <span className="shrink-0">
            {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: false })}
          </span>
        </div>
      ))}
    </div>
  );
}
