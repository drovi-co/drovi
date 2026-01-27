"use client";

/**
 * PresenceIndicator
 *
 * Shows user's online status with a colored dot.
 * Can be combined with Avatar for rich presence display.
 */

import { cn } from "@/lib/utils";

export type PresenceStatus =
  | "online"
  | "away"
  | "busy"
  | "do_not_disturb"
  | "offline";

interface PresenceIndicatorProps {
  status: PresenceStatus;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

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
  do_not_disturb: "Do not disturb",
  offline: "Offline",
};

const sizeClasses = {
  sm: "h-2 w-2",
  md: "h-2.5 w-2.5",
  lg: "h-3 w-3",
};

export function PresenceIndicator({
  status,
  size = "md",
  showLabel = false,
  className,
}: PresenceIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "rounded-full ring-2 ring-background",
          statusColors[status],
          sizeClasses[size],
          status === "online" && "animate-pulse"
        )}
        title={statusLabels[status]}
      />
      {showLabel && (
        <span className="text-muted-foreground text-xs">
          {statusLabels[status]}
        </span>
      )}
    </div>
  );
}

/**
 * PresenceAvatar
 *
 * Combines an avatar with a presence indicator.
 */
interface PresenceAvatarProps {
  name: string;
  image?: string | null;
  status: PresenceStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const avatarSizes = {
  sm: "h-6 w-6 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
};

const indicatorPositions = {
  sm: "bottom-0 right-0",
  md: "-bottom-0.5 -right-0.5",
  lg: "-bottom-0.5 -right-0.5",
};

export function PresenceAvatar({
  name,
  image,
  status,
  size = "md",
  className,
}: PresenceAvatarProps) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={cn("relative inline-block", className)}>
      {image ? (
        <img
          alt={name}
          className={cn("rounded-full object-cover", avatarSizes[size])}
          src={image}
        />
      ) : (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted font-medium",
            avatarSizes[size]
          )}
        >
          {initials}
        </div>
      )}
      <span
        className={cn(
          "absolute rounded-full border-2 border-background",
          sizeClasses[size === "sm" ? "sm" : size === "md" ? "sm" : "md"],
          statusColors[status],
          indicatorPositions[size]
        )}
      />
    </div>
  );
}

/**
 * AvatarStack
 *
 * Shows multiple avatars stacked together with overflow count.
 */
interface AvatarStackProps {
  users: Array<{
    id: string;
    name: string;
    image?: string | null;
    status?: PresenceStatus;
  }>;
  maxVisible?: number;
  size?: "sm" | "md" | "lg";
  showPresence?: boolean;
  className?: string;
}

export function AvatarStack({
  users,
  maxVisible = 3,
  size = "md",
  showPresence = false,
  className,
}: AvatarStackProps) {
  const visibleUsers = users.slice(0, maxVisible);
  const overflowCount = users.length - maxVisible;

  return (
    <div className={cn("flex -space-x-2", className)}>
      {visibleUsers.map((user) =>
        showPresence && user.status ? (
          <PresenceAvatar
            className="ring-2 ring-background"
            image={user.image}
            key={user.id}
            name={user.name}
            size={size}
            status={user.status}
          />
        ) : (
          <div
            className={cn(
              "relative inline-block rounded-full ring-2 ring-background",
              avatarSizes[size]
            )}
            key={user.id}
          >
            {user.image ? (
              <img
                alt={user.name}
                className={cn("rounded-full object-cover", avatarSizes[size])}
                src={user.image}
              />
            ) : (
              <div
                className={cn(
                  "flex items-center justify-center rounded-full bg-muted font-medium",
                  avatarSizes[size]
                )}
              >
                {user.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </div>
            )}
          </div>
        )
      )}
      {overflowCount > 0 && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-muted font-medium ring-2 ring-background",
            avatarSizes[size]
          )}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
}
