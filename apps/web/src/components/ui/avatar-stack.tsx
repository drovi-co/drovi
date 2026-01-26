// =============================================================================
// AVATAR STACK COMPONENT
// =============================================================================
//
// Displays overlapping avatars for multiple participants.
// Features:
// - Configurable max visible count
// - +N overflow badge
// - Multiple sizes
// - Ring around each avatar for visibility

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface AvatarStackParticipant {
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface AvatarStackProps {
  participants: AvatarStackParticipant[];
  /** Maximum number of avatars to show before +N */
  maxVisible?: number;
  /** Avatar size */
  size?: "xs" | "sm" | "md";
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "?";
}

// =============================================================================
// AVATAR STACK COMPONENT
// =============================================================================

export function AvatarStack({
  participants,
  maxVisible = 3,
  size = "sm",
  className,
}: AvatarStackProps) {
  const visibleParticipants = participants.slice(0, maxVisible);
  const overflowCount = participants.length - maxVisible;

  // Size configuration
  const sizeConfig = {
    xs: {
      avatar: "xs" as const,
      overlap: "-ml-1.5",
      ring: "ring-1",
      badge: "h-4 min-w-4 text-[9px] -ml-1",
    },
    sm: {
      avatar: "sm" as const,
      overlap: "-ml-2",
      ring: "ring-2",
      badge: "h-5 min-w-5 text-[10px] -ml-1.5",
    },
    md: {
      avatar: "md" as const,
      overlap: "-ml-2.5",
      ring: "ring-2",
      badge: "h-6 min-w-6 text-[11px] -ml-2",
    },
  };

  const config = sizeConfig[size];

  return (
    <div className={cn("flex items-center", className)}>
      {visibleParticipants.map((participant, index) => (
        <Avatar
          className={cn(
            config.ring,
            "ring-background",
            index > 0 && config.overlap
          )}
          key={participant.id}
          size={config.avatar}
        >
          {participant.avatarUrl ? (
            <AvatarImage
              alt={participant.name ?? participant.email ?? "Participant"}
              src={participant.avatarUrl}
            />
          ) : null}
          <AvatarFallback>
            {getInitials(participant.name, participant.email)}
          </AvatarFallback>
        </Avatar>
      ))}

      {overflowCount > 0 && (
        <div
          className={cn(
            "flex items-center justify-center rounded-full",
            "bg-muted text-muted-foreground font-medium",
            config.ring,
            "ring-background",
            config.badge
          )}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
}
