import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Priority Icon component
 *
 * Features:
 * - 5 priority levels: urgent, high, medium, low, none
 * - 16px default size
 * - Color-coded for quick recognition
 * - Hover states for interactivity
 */
const priorityIconVariants = cva(
  "inline-flex shrink-0 items-center justify-center",
  {
    variants: {
      size: {
        xs: "size-3", // 12px
        sm: "size-3.5", // 14px
        md: "size-4", // 16px
        lg: "size-5", // 20px
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

export type Priority = "urgent" | "high" | "medium" | "low" | "none";

interface PriorityIconProps
  extends React.SVGProps<SVGSVGElement>,
    VariantProps<typeof priorityIconVariants> {
  priority: Priority;
  showLabel?: boolean;
}

// Vercel-style priority colors
const priorityConfig: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "#dc2626" },
  high: { label: "High", color: "#ea580c" },
  medium: { label: "Medium", color: "#d97706" },
  low: { label: "Low", color: "#059669" },
  none: { label: "No Priority", color: "#a3a3a3" },
};

function PriorityIcon({
  priority,
  size,
  showLabel,
  className,
  ...props
}: PriorityIconProps) {
  const config = priorityConfig[priority];
  const sizeValue =
    size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 20 : 16;

  if (priority === "none") {
    // Three dots icon for no priority
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        <svg
          className={priorityIconVariants({ size })}
          data-slot="priority-icon"
          fill="none"
          height={sizeValue}
          viewBox="0 0 16 16"
          width={sizeValue}
          {...props}
        >
          <circle cx="3" cy="8" fill={config.color} r="1.5" />
          <circle cx="8" cy="8" fill={config.color} r="1.5" />
          <circle cx="13" cy="8" fill={config.color} r="1.5" />
        </svg>
        {showLabel && (
          <span className="text-[12px] text-muted-foreground">
            {config.label}
          </span>
        )}
      </div>
    );
  }

  if (priority === "urgent") {
    // Warning square icon for urgent
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        <svg
          className={priorityIconVariants({ size })}
          data-slot="priority-icon"
          fill="none"
          height={sizeValue}
          viewBox="0 0 16 16"
          width={sizeValue}
          {...props}
        >
          <rect fill={config.color} height="12" rx="2" width="12" x="2" y="2" />
          <path
            d="M8 5v4"
            stroke="white"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
          <circle cx="8" cy="11" fill="white" r="0.75" />
        </svg>
        {showLabel && (
          <span className="text-[12px]" style={{ color: config.color }}>
            {config.label}
          </span>
        )}
      </div>
    );
  }

  // Bar chart icon for high, medium, low
  const bars = priority === "high" ? 3 : priority === "medium" ? 2 : 1;

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <svg
        className={priorityIconVariants({ size })}
        data-slot="priority-icon"
        fill="none"
        height={sizeValue}
        viewBox="0 0 16 16"
        width={sizeValue}
        {...props}
      >
        {/* Left bar (always shown) */}
        <rect
          fill={bars >= 1 ? config.color : "#a3a3a3"}
          height="4"
          opacity={bars >= 1 ? 1 : 0.3}
          rx="0.5"
          width="3"
          x="2"
          y="10"
        />
        {/* Middle bar */}
        <rect
          fill={bars >= 2 ? config.color : "#a3a3a3"}
          height="7"
          opacity={bars >= 2 ? 1 : 0.3}
          rx="0.5"
          width="3"
          x="6.5"
          y="7"
        />
        {/* Right bar */}
        <rect
          fill={bars >= 3 ? config.color : "#a3a3a3"}
          height="10"
          opacity={bars >= 3 ? 1 : 0.3}
          rx="0.5"
          width="3"
          x="11"
          y="4"
        />
      </svg>
      {showLabel && (
        <span className="text-[12px]" style={{ color: config.color }}>
          {config.label}
        </span>
      )}
    </div>
  );
}

export { PriorityIcon, priorityIconVariants, priorityConfig };
