"use client";

/**
 * TeamPresencePanel
 *
 * Shows online team members in a compact sidebar panel.
 * Features:
 * - Real-time online status
 * - Expandable to show all members
 * - Status indicators (online, away, busy, dnd)
 * - What they're currently viewing
 */

import { useState } from "react";
import { ChevronDown, ChevronUp, Circle, Eye, Users } from "lucide-react";
import { useOnlineUsers } from "@/hooks/use-presence";
import { useActiveOrganization } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PresenceStatus } from "./presence-indicator";

// =============================================================================
// Types
// =============================================================================

interface OnlineUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  status: PresenceStatus;
  viewingType?: string | null;
  viewingId?: string | null;
  lastActiveAt: string;
}

// =============================================================================
// Status Color Mapping
// =============================================================================

const statusColors: Record<PresenceStatus, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  busy: "bg-orange-500",
  do_not_disturb: "bg-red-500",
  offline: "bg-gray-400",
};

const statusLabels: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  busy: "Busy",
  do_not_disturb: "Do Not Disturb",
  offline: "Offline",
};

// =============================================================================
// View Type Labels
// =============================================================================

function getViewingLabel(viewingType: string | null | undefined): string {
  if (!viewingType) return "";
  const labels: Record<string, string> = {
    inbox: "Inbox",
    conversation: "Conversation",
    commitment: "Commitment",
    decision: "Decision",
    task: "Task",
    contact: "Contact",
    uio: "Intelligence",
    settings: "Settings",
    shared_inbox: "Shared Inbox",
    search: "Search",
    dashboard: "Dashboard",
  };
  return labels[viewingType] || viewingType;
}

// =============================================================================
// Compact Online Badge (for collapsed sidebar)
// =============================================================================

export function OnlineUsersBadge() {
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const { data } = useOnlineUsers({
    organizationId,
    enabled: Boolean(organizationId),
  });

  const onlineCount = data?.users?.length ?? 0;

  if (onlineCount === 0) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 rounded-md bg-green-500/10 px-2 py-1">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              {onlineCount}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {onlineCount} team member{onlineCount !== 1 ? "s" : ""} online
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// Full Panel Component
// =============================================================================

interface TeamPresencePanelProps {
  className?: string;
  compact?: boolean;
}

export function TeamPresencePanel({ className, compact }: TeamPresencePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: activeOrg } = useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const { data, isLoading } = useOnlineUsers({
    organizationId,
    enabled: Boolean(organizationId),
  });

  const onlineUsers = (data?.users ?? []) as OnlineUser[];
  const displayUsers = isExpanded ? onlineUsers : onlineUsers.slice(0, 3);

  if (isLoading) {
    return (
      <div className={cn("animate-pulse", className)}>
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="h-4 w-4 rounded-full bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
        </div>
      </div>
    );
  }

  if (onlineUsers.length === 0) {
    return (
      <div className={cn("px-3 py-2", className)}>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>No one else online</span>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("px-2", className)}>
        <TooltipProvider>
          <div className="flex -space-x-2">
            {onlineUsers.slice(0, 5).map((user) => (
              <Tooltip key={user.id}>
                <TooltipTrigger asChild>
                  <div className="relative">
                    <Avatar className="h-6 w-6 border-2 border-background">
                      <AvatarImage src={user.image ?? undefined} alt={user.name ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {user.name
                          ?.split(" ")
                          .map((n) => n[0])
                          .join("")
                          .toUpperCase()
                          .slice(0, 2) ?? "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background",
                        statusColors[user.status || "online"]
                      )}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="text-xs">
                    <div className="font-medium">{user.name ?? user.email}</div>
                    <div className="text-muted-foreground">
                      {statusLabels[user.status || "online"]}
                      {user.viewingType && ` · ${getViewingLabel(user.viewingType)}`}
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
            {onlineUsers.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
                +{onlineUsers.length - 5}
              </div>
            )}
          </div>
        </TooltipProvider>
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between px-3 py-2 h-auto"
        >
          <div className="flex items-center gap-2">
            <Circle className="h-2 w-2 fill-green-500 text-green-500" />
            <span className="text-xs font-medium">
              {onlineUsers.length} online
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-1 px-2 pb-2">
        {displayUsers.map((user) => (
          <div
            key={user.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
          >
            <div className="relative">
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.image ?? undefined} alt={user.name ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {user.name
                    ?.split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2) ?? "?"}
                </AvatarFallback>
              </Avatar>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background",
                  statusColors[user.status || "online"]
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">
                {user.name ?? user.email.split("@")[0]}
              </div>
              {user.viewingType && (
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Eye className="h-2.5 w-2.5" />
                  <span className="truncate">{getViewingLabel(user.viewingType)}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {onlineUsers.length > 3 && !isExpanded && (
          <div className="px-2 text-[10px] text-muted-foreground">
            +{onlineUsers.length - 3} more
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
