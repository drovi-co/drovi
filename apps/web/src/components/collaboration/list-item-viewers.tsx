"use client";

/**
 * ListItemViewers
 *
 * Shows presence indicators in list views.
 * Displays small avatars of users currently viewing specific items.
 * Uses a single query to get all online users, then filters by resource.
 */

import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOnlineUsers, type ViewingType } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

/** User from the presence API with nested user data */
interface PresenceUser {
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  status: string;
  currentViewingType: string | null;
  currentViewingId: string | null;
}

/** Flattened user for display purposes */
interface OnlineUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  status: string;
  viewingType: string | null;
  viewingId: string | null;
}

// =============================================================================
// Hook: useListViewers
// =============================================================================

/**
 * Hook that returns a map of resource IDs to viewers for a specific resource type.
 * Uses the online users query to efficiently get all viewers at once.
 */
export function useListViewers(params: {
  organizationId: string;
  resourceType: ViewingType;
  currentUserId?: string;
  enabled?: boolean;
}) {
  const {
    organizationId,
    resourceType,
    currentUserId,
    enabled = true,
  } = params;

  const { data: onlineUsersData, isLoading } = useOnlineUsers({
    organizationId,
    enabled,
  });

  // Create a map of resourceId -> viewers
  const viewersMap = useMemo(() => {
    const map = new Map<string, OnlineUser[]>();

    if (!onlineUsersData?.users) {
      return map;
    }

    for (const presenceUser of onlineUsersData.users as PresenceUser[]) {
      // Skip current user
      if (currentUserId && presenceUser.user.id === currentUserId) {
        continue;
      }

      // Only include users viewing the requested resource type
      if (
        presenceUser.currentViewingType !== resourceType ||
        !presenceUser.currentViewingId
      ) {
        continue;
      }

      // Transform to OnlineUser format
      const user: OnlineUser = {
        id: presenceUser.user.id,
        name: presenceUser.user.name,
        email: presenceUser.user.email,
        image: presenceUser.user.image,
        status: presenceUser.status,
        viewingType: presenceUser.currentViewingType,
        viewingId: presenceUser.currentViewingId,
      };

      const existing = map.get(presenceUser.currentViewingId) || [];
      existing.push(user);
      map.set(presenceUser.currentViewingId, existing);
    }

    return map;
  }, [onlineUsersData?.users, resourceType, currentUserId]);

  return { viewersMap, isLoading };
}

// =============================================================================
// Component: ListItemViewers
// =============================================================================

interface ListItemViewersProps {
  /** Viewers for this item (from useListViewers map) */
  viewers: OnlineUser[];
  /** Maximum avatars to show before +N */
  maxVisible?: number;
  /** Size of avatars */
  size?: "xs" | "sm";
  /** Additional className */
  className?: string;
}

/**
 * Displays a stack of viewer avatars for a list item.
 * Shows up to maxVisible avatars with a +N indicator for more.
 */
export function ListItemViewers({
  viewers,
  maxVisible = 3,
  size = "xs",
  className,
}: ListItemViewersProps) {
  if (viewers.length === 0) {
    return null;
  }

  const visibleViewers = viewers.slice(0, maxVisible);
  const remainingCount = viewers.length - maxVisible;

  const sizeClasses = {
    xs: "h-5 w-5 text-[9px]",
    sm: "h-6 w-6 text-[10px]",
  };

  const getInitials = (user: OnlineUser) => {
    if (user.name) {
      return user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email[0]?.toUpperCase() ?? "?";
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("flex items-center -space-x-1", className)}>
            {visibleViewers.map((viewer) => (
              <Avatar
                className={cn(sizeClasses[size], "ring-2 ring-background")}
                key={viewer.id}
              >
                <AvatarImage src={viewer.image ?? undefined} />
                <AvatarFallback className="bg-primary/10 font-medium text-primary">
                  {getInitials(viewer)}
                </AvatarFallback>
              </Avatar>
            ))}
            {remainingCount > 0 && (
              <div
                className={cn(
                  sizeClasses[size],
                  "flex items-center justify-center rounded-full",
                  "bg-muted ring-2 ring-background",
                  "font-medium text-muted-foreground"
                )}
              >
                +{remainingCount}
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent align="center" className="max-w-xs" side="top">
          <p className="text-sm">
            <span className="font-medium">Viewing now: </span>
            {viewers.map((v) => v.name ?? v.email).join(", ")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// Component: ListViewersProvider
// =============================================================================

/**
 * Convenience wrapper that provides viewer data for a list.
 * Use this at the list level, then use the viewersMap to get viewers for each item.
 *
 * @example
 * function TaskList() {
 *   const { viewersMap } = useListViewers({
 *     organizationId,
 *     resourceType: "task",
 *     currentUserId,
 *   });
 *
 *   return tasks.map((task) => (
 *     <TaskRow
 *       key={task.id}
 *       task={task}
 *       viewers={viewersMap.get(task.id) ?? []}
 *     />
 *   ));
 * }
 */
