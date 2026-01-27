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
import { ArrowRight, MessageSquare, Plus, Send, Tag, User } from "lucide-react";
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
      queryClient.invalidateQueries({ queryKey: [["uio"]] });
      setComment("");
      toast.success("Comment added");
    },
    onError: () => {
      toast.error("Failed to add comment");
    },
  });

  const handleSubmitComment = () => {
    if (!comment.trim()) {
      return;
    }
    addCommentMutation.mutate({
      organizationId,
      taskId,
      comment: comment.trim(),
    });
  };

  // Transform activities to ensure dates are Date objects
  const activities: TaskActivity[] = (activityData?.activities ?? []).map(
    (activity) => ({
      ...activity,
      createdAt: new Date(activity.createdAt),
    })
  );

  if (isLoading) {
    return <ActivityFeedSkeleton />;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Comment Input */}
      <div className="space-y-2">
        <Textarea
          className="resize-none"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              handleSubmitComment();
            }
          }}
          placeholder="Add a comment..."
          rows={2}
          value={comment}
        />
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            Press ⌘+Enter to submit
          </span>
          <Button
            disabled={!comment.trim() || addCommentMutation.isPending}
            onClick={handleSubmitComment}
            size="sm"
          >
            <Send className="mr-2 h-4 w-4" />
            Comment
          </Button>
        </div>
      </div>

      {/* Activity List */}
      <div className="border-t pt-4">
        <h4 className="mb-3 font-medium text-sm">Activity</h4>
        {activities.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            No activity yet
          </p>
        ) : (
          <div className="space-y-4">
            {activities.map((activity) => (
              <ActivityItem activity={activity} key={activity.id} />
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
          <AvatarImage alt={activity.userName ?? ""} src={activity.userImage} />
        ) : null}
        <AvatarFallback className="text-[10px]">
          {(activity.userName ?? "U").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">
            {activity.userName ?? "Unknown"}
          </span>
          <span className="text-muted-foreground text-sm">{description}</span>
          <span className="text-muted-foreground text-xs">
            {formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: true,
            })}
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
          <div className="mt-2 rounded-md bg-muted/50 p-3 text-sm">
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

function StatusChangeVisualization({
  from,
  to,
}: StatusChangeVisualizationProps) {
  const fromConfig = STATUS_CONFIG[from];
  const toConfig = STATUS_CONFIG[to];
  const FromIcon = fromConfig?.icon;
  const ToIcon = toConfig?.icon;

  if (!(fromConfig && toConfig)) {
    return null;
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs">
        {FromIcon && (
          <FromIcon className={cn("h-3.5 w-3.5", fromConfig.color)} />
        )}
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
        <Skeleton className="mb-3 h-4 w-16" />
        <div className="space-y-4">
          {[...new Array(3)].map((_, i) => (
            <div className="flex gap-3" key={i}>
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
        {[...new Array(maxItems)].map((_, i) => (
          <Skeleton className="h-4 w-full" key={i} />
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
        <div
          className="flex items-center gap-2 text-muted-foreground text-xs"
          key={activity.id}
        >
          <Avatar className="h-4 w-4">
            {activity.userImage ? (
              <AvatarImage
                alt={activity.userName ?? ""}
                src={activity.userImage}
              />
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
            {formatDistanceToNow(new Date(activity.createdAt), {
              addSuffix: false,
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
