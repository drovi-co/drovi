// =============================================================================
// ENTITY BADGE COMPONENT
// =============================================================================
//
// Displays a compact badge for linked entities (contacts, companies) with:
// - Avatar/logo
// - Name
// - Clickable link to entity detail
//
// Used in UIO list items and descriptions for intelligent entity linking.

import { Building2, User } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface EntityBadgeProps {
  /** Entity type */
  type: "contact" | "company";
  /** Display name */
  name: string;
  /** Avatar/logo URL */
  avatarUrl?: string | null;
  /** Entity ID for linking */
  id?: string;
  /** Click handler */
  onClick?: () => void;
  /** Additional class names */
  className?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether to show as inline (for use in text) */
  inline?: boolean;
}

// =============================================================================
// HELPER: GET INITIALS
// =============================================================================

function getInitials(name: string, type: "contact" | "company"): string {
  if (!name) {
    return type === "contact" ? "?" : "C";
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }
  return name.slice(0, 2).toUpperCase();
}

// =============================================================================
// ENTITY BADGE COMPONENT
// =============================================================================

export function EntityBadge({
  type,
  name,
  avatarUrl,
  id,
  onClick,
  className,
  size = "sm",
  inline = false,
}: EntityBadgeProps) {
  const isClickable = Boolean(onClick || id);
  const Icon = type === "company" ? Building2 : User;

  const content = (
    <>
      <Avatar size={size === "sm" ? "xs" : "sm"}>
        {avatarUrl ? <AvatarImage alt={name} src={avatarUrl} /> : null}
        <AvatarFallback
          className={cn(
            type === "company" &&
              "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
            type === "contact" &&
              "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
          )}
        >
          {avatarUrl ? (
            getInitials(name, type)
          ) : (
            <Icon className="h-2.5 w-2.5" />
          )}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "truncate",
          size === "sm" ? "text-xs" : "text-sm",
          isClickable && "group-hover:underline"
        )}
      >
        {name}
      </span>
    </>
  );

  const baseClasses = cn(
    "inline-flex items-center gap-1.5 rounded-full",
    "border border-border/50 bg-muted/30",
    "transition-colors duration-150",
    size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1",
    isClickable && "group cursor-pointer hover:border-border hover:bg-muted/60",
    inline && "mx-0.5 align-middle",
    className
  );

  if (isClickable) {
    return (
      <button className={baseClasses} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return <span className={baseClasses}>{content}</span>;
}

// =============================================================================
// ENTITY LINK COMPONENT (for inline use in text)
// =============================================================================

export interface EntityLinkProps {
  type: "contact" | "company";
  name: string;
  avatarUrl?: string | null;
  id?: string;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}

export function EntityLink({
  type,
  name,
  avatarUrl,
  id,
  onClick,
  children,
  className,
}: EntityLinkProps) {
  const isClickable = Boolean(onClick || id);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  // If clickable, render as a button for proper accessibility
  if (isClickable) {
    return (
      <button
        className={cn(
          "inline-flex items-center gap-0.5 align-baseline",
          "group cursor-pointer",
          "border-none bg-transparent p-0",
          className
        )}
        onClick={onClick}
        type="button"
      >
        <Avatar className="relative -top-px" size="xs">
          {avatarUrl ? <AvatarImage alt={name} src={avatarUrl} /> : null}
          <AvatarFallback
            className={cn(
              "text-[8px]",
              type === "company" &&
                "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
              type === "contact" &&
                "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
            )}
          >
            {getInitials(name, type)}
          </AvatarFallback>
        </Avatar>
        <span className={cn("text-primary", "group-hover:underline")}>
          {children ?? name}
        </span>
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 align-baseline",
        className
      )}
    >
      <Avatar className="relative -top-px" size="xs">
        {avatarUrl ? <AvatarImage alt={name} src={avatarUrl} /> : null}
        <AvatarFallback
          className={cn(
            "text-[8px]",
            type === "company" &&
              "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
            type === "contact" &&
              "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300"
          )}
        >
          {getInitials(name, type)}
        </AvatarFallback>
      </Avatar>
      <span className="text-primary">{children ?? name}</span>
    </span>
  );
}
