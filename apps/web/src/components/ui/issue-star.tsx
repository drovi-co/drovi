"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Star } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Issue Star component
 *
 * Features:
 * - 14px default icon size (matches Figma)
 * - Toggle between starred/unstarred
 * - Color: #4C4F6B unstarred, #F2C94C starred
 * - Hover states for interactivity
 */
const issueStarVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "transition-colors duration-150",
    "cursor-pointer",
    "rounded-sm",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  ],
  {
    variants: {
      size: {
        sm: "size-5", // 20px button, 12px icon
        md: "size-6", // 24px button, 14px icon
        lg: "size-7", // 28px button, 16px icon
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

interface IssueStarProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof issueStarVariants> {
  starred?: boolean;
  onStarredChange?: (starred: boolean) => void;
}

function IssueStar({
  className,
  size,
  starred = false,
  onStarredChange,
  ...props
}: IssueStarProps) {
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStarredChange?.(!starred);
  };

  return (
    <button
      aria-label={starred ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={starred}
      className={cn(
        issueStarVariants({ size }),
        starred
          ? "text-[#F2C94C] hover:text-[#F2C94C]/80"
          : "text-muted-foreground hover:text-muted-foreground",
        className
      )}
      data-slot="issue-star"
      onClick={handleClick}
      type="button"
      {...props}
    >
      <Star
        fill={starred ? "currentColor" : "none"}
        strokeWidth={starred ? 0 : 1.5}
        style={{ width: iconSize, height: iconSize }}
      />
    </button>
  );
}

export { IssueStar, issueStarVariants };
