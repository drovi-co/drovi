"use client";

/**
 * ActivityFeed
 *
 * Displays a real-time stream of activity events.
 * Supports filtering by activity type and resource.
 */

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle,
  CheckSquare,
  Clock,
  FileText,
  MessageSquare,
  Share2,
  UserPlus,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ActivityType,
  useActivityFeed,
  useMarkActivitySeen,
  useUnreadActivityCount,
} from "@/hooks/use-collaboration";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface Activity {
  id: string;
  activityType: ActivityType;
  targetType: string;
  targetId: string;
  targetTitle: string | null;
  metadata: Record<string, unknown> | null;
  visibility: "private" | "team" | "organization";
  createdAt: string; // Serialized as string from API
  visibleToTeamIds: string[] | null;
  visibleToUserIds: string[] | null;
  aggregationKey: string | null;
  isAggregated: boolean;
  aggregatedCount: number;
  organizationId: string;
  userId: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
}

interface ActivityFeedProps {
  organizationId: string;
  activityTypes?: ActivityType[];
  targetType?: string;
  targetId?: string;
  limit?: number;
  compact?: boolean;
  showHeader?: boolean;
  className?: string;
}

// =============================================================================
// Activity Icons & Config
// =============================================================================

const activityConfig: Record<
  ActivityType,
  { icon: React.ReactNode; color: string; label: string }
> = {
  commitment_created: {
    icon: <FileText className="h-4 w-4" />,
    color: "text-blue-500",
    label: "created a commitment",
  },
  commitment_updated: {
    icon: <FileText className="h-4 w-4" />,
    color: "text-blue-500",
    label: "updated a commitment",
  },
  commitment_completed: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-500",
    label: "completed a commitment",
  },
  commitment_overdue: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "text-red-500",
    label: "has an overdue commitment",
  },
  decision_made: {
    icon: <Zap className="h-4 w-4" />,
    color: "text-purple-500",
    label: "made a decision",
  },
  decision_updated: {
    icon: <Zap className="h-4 w-4" />,
    color: "text-purple-500",
    label: "updated a decision",
  },
  decision_reversed: {
    icon: <XCircle className="h-4 w-4" />,
    color: "text-orange-500",
    label: "reversed a decision",
  },
  task_created: {
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-blue-500",
    label: "created a task",
  },
  task_assigned: {
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-blue-500",
    label: "assigned a task",
  },
  task_completed: {
    icon: <CheckSquare className="h-4 w-4" />,
    color: "text-green-500",
    label: "completed a task",
  },
  comment_added: {
    icon: <MessageSquare className="h-4 w-4" />,
    color: "text-gray-500",
    label: "added a comment",
  },
  comment_resolved: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-500",
    label: "resolved a comment thread",
  },
  mention: {
    icon: <Bell className="h-4 w-4" />,
    color: "text-yellow-500",
    label: "mentioned you",
  },
  share: {
    icon: <Share2 className="h-4 w-4" />,
    color: "text-blue-500",
    label: "shared an item with you",
  },
  share_request: {
    icon: <Share2 className="h-4 w-4" />,
    color: "text-orange-500",
    label: "requested access",
  },
  conversation_assigned: {
    icon: <ArrowRight className="h-4 w-4" />,
    color: "text-blue-500",
    label: "was assigned a conversation",
  },
  conversation_claimed: {
    icon: <UserPlus className="h-4 w-4" />,
    color: "text-blue-500",
    label: "claimed a conversation",
  },
  conversation_resolved: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-500",
    label: "resolved a conversation",
  },
  conversation_escalated: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "text-orange-500",
    label: "escalated a conversation",
  },
  deadline_approaching: {
    icon: <Clock className="h-4 w-4" />,
    color: "text-yellow-500",
    label: "has a deadline approaching",
  },
  deadline_missed: {
    icon: <XCircle className="h-4 w-4" />,
    color: "text-red-500",
    label: "missed a deadline",
  },
  risk_detected: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: "text-red-500",
    label: "risk detected",
  },
  risk_resolved: {
    icon: <CheckCircle className="h-4 w-4" />,
    color: "text-green-500",
    label: "risk resolved",
  },
  member_joined: {
    icon: <UserPlus className="h-4 w-4" />,
    color: "text-green-500",
    label: "joined the team",
  },
  member_left: {
    icon: <XCircle className="h-4 w-4" />,
    color: "text-gray-500",
    label: "left the team",
  },
  settings_changed: {
    icon: <Zap className="h-4 w-4" />,
    color: "text-gray-500",
    label: "changed settings",
  },
};

// =============================================================================
// Main Component
// =============================================================================

export function ActivityFeed({
  organizationId,
  activityTypes,
  targetType,
  targetId,
  limit = 50,
  compact = false,
  showHeader = true,
  className,
}: ActivityFeedProps) {
  const { data, isLoading, refetch } = useActivityFeed({
    organizationId,
    activityTypes,
    targetType,
    targetId,
    limit,
  });

  const { data: unreadData } = useUnreadActivityCount({ organizationId });
  const markSeen = useMarkActivitySeen({ organizationId });

  const activities = data?.activities ?? [];
  const unreadCount = unreadData?.unreadCount ?? 0;

  // Mark as seen when viewing
  const handleMarkSeen = useCallback(async () => {
    if (activities.length > 0) {
      const lastActivityId = activities[0]?.id;
      if (lastActivityId) {
        await markSeen.mutateAsync({
          organizationId,
          lastSeenActivityId: lastActivityId,
        });
      }
    }
  }, [activities, organizationId, markSeen]);

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="flex animate-pulse items-start gap-3" key={i}>
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/4 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {showHeader && (
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <span className="font-medium">Activity</span>
            {unreadCount > 0 && (
              <Badge className="h-5 px-1.5 text-xs" variant="secondary">
                {unreadCount}
              </Badge>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              className="text-xs"
              onClick={handleMarkSeen}
              size="sm"
              variant="ghost"
            >
              Mark all as read
            </Button>
          )}
        </div>
      )}

      <ScrollArea className={cn("flex-1", showHeader && "pt-3")}>
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <Bell className="mb-2 h-8 w-8" />
            <p>No activity yet</p>
            <p className="text-sm">Activity will appear here as it happens</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activities.map((activity) => (
              <ActivityItem
                activity={activity}
                compact={compact}
                key={activity.id}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// Activity Item Component
// =============================================================================

interface ActivityItemProps {
  activity: Activity;
  compact?: boolean;
}

function ActivityItem({ activity, compact = false }: ActivityItemProps) {
  const config = activityConfig[activity.activityType] ?? {
    icon: <Bell className="h-4 w-4" />,
    color: "text-gray-500",
    label: activity.activityType,
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
        <span className={cn(config.color)}>{config.icon}</span>
        <span className="flex-1 truncate text-sm">
          <span className="font-medium">
            {activity.user?.name ?? "Someone"}
          </span>{" "}
          {config.label}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatDistanceToNow(new Date(activity.createdAt), {
            addSuffix: true,
          })}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg p-3 hover:bg-accent/50">
      {/* User avatar */}
      <Avatar className="h-8 w-8">
        <AvatarImage src={activity.user?.image ?? undefined} />
        <AvatarFallback className="text-xs">
          {activity.user?.name
            ?.split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) ?? "?"}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(config.color)}>{config.icon}</span>
          <span className="text-sm">
            <span className="font-medium">
              {activity.user?.name ?? "Someone"}
            </span>{" "}
            {config.label}
          </span>
        </div>

        {/* Target title */}
        {activity.targetTitle && (
          <p className="mt-1 truncate text-muted-foreground text-sm">
            {activity.targetTitle}
          </p>
        )}

        {/* Timestamp */}
        <p className="mt-1 text-muted-foreground text-xs">
          {formatDistanceToNow(new Date(activity.createdAt), {
            addSuffix: true,
          })}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Activity Sidebar Component
// =============================================================================

interface ActivitySidebarProps {
  organizationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ActivitySidebar({
  organizationId,
  isOpen,
  onClose,
}: ActivitySidebarProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 border-l bg-background shadow-lg">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-semibold text-lg">Activity</h2>
          <Button onClick={onClose} size="sm" variant="ghost">
            Close
          </Button>
        </div>
        <ActivityFeed
          className="flex-1 overflow-hidden p-4"
          organizationId={organizationId}
          showHeader={false}
        />
      </div>
    </div>
  );
}
