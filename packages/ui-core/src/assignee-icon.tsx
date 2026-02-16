import { cva, type VariantProps } from "class-variance-authority";
import { User } from "lucide-react";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Assignee Icon component
 *
 * Features:
 * - User avatar with image, initials, or icon fallback
 * - Multiple sizes (14px, 16px, 20px, 24px)
 * - Supports stacking for multiple assignees
 * - Color-coded initials background
 */
const assigneeIconVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "rounded-full",
    "overflow-hidden",
    "font-medium",
  ],
  {
    variants: {
      size: {
        xs: "size-3.5 text-[8px]", // 14px
        sm: "size-4 text-[9px]", // 16px
        md: "size-5 text-[10px]", // 20px
        lg: "size-6 text-[11px]", // 24px
        xl: "size-8 text-[13px]", // 32px
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

interface AssigneeIconProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof assigneeIconVariants> {
  name?: string;
  email?: string;
  imageUrl?: string;
  showTooltip?: boolean;
}

// Generate a consistent color based on name/email
function getAvatarColor(identifier: string): string {
  const colors = [
    "#5E6AD2", // Purple (Linear primary)
    "#EB5757", // Red
    "#F2994A", // Orange
    "#F2C94C", // Yellow
    "#6FCF97", // Green
    "#56CCF2", // Cyan
    "#BB6BD9", // Magenta
    "#2D9CDB", // Blue
  ];

  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash;
  }

  // `noUncheckedIndexedAccess` makes this `string | undefined`, but `colors` is non-empty by construction.
  return colors[Math.abs(hash) % colors.length] ?? colors[0]!;
}

function getInitials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      const first = parts[0]?.charAt(0) ?? "";
      const last = parts.at(-1)?.charAt(0) ?? "";
      return (first + last).toUpperCase() || "?";
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "?";
}

function AssigneeIcon({
  className,
  size,
  name,
  email,
  imageUrl,
  showTooltip = false,
  ...props
}: AssigneeIconProps) {
  const identifier = name || email || "";
  const initials = getInitials(name, email);
  const bgColor = getAvatarColor(identifier);
  const iconSize =
    size === "xs"
      ? 8
      : size === "sm"
        ? 10
        : size === "lg"
          ? 14
          : size === "xl"
            ? 18
            : 12;
  const avatarSize =
    size === "xs"
      ? 14
      : size === "sm"
        ? 16
        : size === "lg"
          ? 24
          : size === "xl"
            ? 32
            : 20;

  const content = imageUrl ? (
    <img
      alt={name || email || "Assignee"}
      className="size-full object-cover"
      height={avatarSize}
      src={imageUrl}
      width={avatarSize}
    />
  ) : identifier ? (
    <span className="text-white">{initials}</span>
  ) : (
    <User
      className="text-muted-foreground"
      style={{ width: iconSize, height: iconSize }}
    />
  );

  return (
    <div
      className={cn(
        assigneeIconVariants({ size }),
        !imageUrl && identifier && "border-0",
        !(imageUrl || identifier) &&
          "border border-muted-foreground border-dashed bg-transparent",
        className
      )}
      data-slot="assignee-icon"
      style={!imageUrl && identifier ? { backgroundColor: bgColor } : undefined}
      title={showTooltip ? name || email : undefined}
      {...props}
    >
      {content}
    </div>
  );
}

/**
 * Assignee Stack - for showing multiple assignees with overlap
 */
interface AssigneeStackProps extends React.HTMLAttributes<HTMLDivElement> {
  assignees: Array<{
    name?: string;
    email?: string;
    imageUrl?: string;
  }>;
  max?: number;
  size?: VariantProps<typeof assigneeIconVariants>["size"];
}

function AssigneeStack({
  className,
  assignees,
  max = 3,
  size = "md",
  ...props
}: AssigneeStackProps) {
  const visibleAssignees = assignees.slice(0, max);
  const overflow = assignees.length - max;

  return (
    <div
      className={cn("flex items-center -space-x-1", className)}
      data-slot="assignee-stack"
      {...props}
    >
      {visibleAssignees.map((assignee, index) => (
        <AssigneeIcon
          className="ring-1 ring-background"
          email={assignee.email}
          imageUrl={assignee.imageUrl}
          key={assignee.email || assignee.name || index}
          name={assignee.name}
          showTooltip
          size={size}
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            assigneeIconVariants({ size }),
            "border border-border bg-muted text-muted-foreground ring-1 ring-background"
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

/**
 * Unassigned placeholder icon
 */
function UnassignedIcon({
  className,
  size = "md",
  ...props
}: Omit<AssigneeIconProps, "name" | "email" | "imageUrl">) {
  return <AssigneeIcon className={className} size={size} {...props} />;
}

export {
  AssigneeIcon,
  AssigneeStack,
  UnassignedIcon,
  assigneeIconVariants,
  getAvatarColor,
  getInitials,
};
