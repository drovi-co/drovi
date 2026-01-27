"use client";

/**
 * WhoIsViewing
 *
 * Shows a list of users currently viewing a resource.
 * Uses presence hooks to track real-time viewers.
 */

import { Eye } from "lucide-react";
import { useResourceViewers, type ViewingType } from "@/hooks/use-presence";
import { cn } from "@/lib/utils";
import { AvatarStack } from "./presence-indicator";

interface WhoIsViewingProps {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
  compact?: boolean;
  className?: string;
}

export function WhoIsViewing({
  organizationId,
  resourceType,
  resourceId,
  compact = false,
  className,
}: WhoIsViewingProps) {
  const { data, isLoading } = useResourceViewers({
    organizationId,
    resourceType,
    resourceId,
  });

  const viewers = data?.viewers ?? [];

  if (isLoading || viewers.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <AvatarStack
          maxVisible={3}
          showPresence={false}
          size="sm"
          users={viewers.map((v) => ({
            id: v.userId,
            name: v.user?.name ?? "Unknown",
            image: v.user?.image,
            status: "online",
          }))}
        />
        <span className="text-muted-foreground text-xs">viewing</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1",
        className
      )}
    >
      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <AvatarStack
          maxVisible={4}
          showPresence={false}
          size="sm"
          users={viewers.map((v) => ({
            id: v.userId,
            name: v.user?.name ?? "Unknown",
            image: v.user?.image,
            status: "online",
          }))}
        />
        <span className="text-muted-foreground text-xs">
          {viewers.length === 1
            ? `${viewers[0]?.user?.name ?? "Someone"} is viewing`
            : `${viewers.length} people viewing`}
        </span>
      </div>
    </div>
  );
}

/**
 * WhoIsViewingBadge
 *
 * A minimal badge showing viewer count.
 */
interface WhoIsViewingBadgeProps {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
  className?: string;
}

export function WhoIsViewingBadge({
  organizationId,
  resourceType,
  resourceId,
  className,
}: WhoIsViewingBadgeProps) {
  const { data } = useResourceViewers({
    organizationId,
    resourceType,
    resourceId,
  });

  const count = data?.viewers?.length ?? 0;

  if (count === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs",
        className
      )}
      title={`${count} ${count === 1 ? "person" : "people"} viewing`}
    >
      <Eye className="h-3 w-3" />
      <span>{count}</span>
    </div>
  );
}

/**
 * TypingIndicator
 *
 * Shows who is currently typing in a resource.
 */
interface TypingIndicatorProps {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
  className?: string;
}

export function TypingIndicator({
  organizationId,
  resourceType,
  resourceId,
  className,
}: TypingIndicatorProps) {
  const { data } = useResourceViewers({
    organizationId,
    resourceType,
    resourceId,
  });

  const typingUsers = data?.viewers?.filter((v) => v.isTyping) ?? [];

  if (typingUsers.length === 0) {
    return null;
  }

  const names = typingUsers
    .slice(0, 2)
    .map((v) => v.user?.name?.split(" ")[0] ?? "Someone");

  let text = "";
  if (typingUsers.length === 1) {
    text = `${names[0]} is typing...`;
  } else if (typingUsers.length === 2) {
    text = `${names[0]} and ${names[1]} are typing...`;
  } else {
    text = `${names[0]} and ${typingUsers.length - 1} others are typing...`;
  }

  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <div className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
      </div>
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}
