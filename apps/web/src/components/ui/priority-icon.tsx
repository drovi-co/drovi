import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

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
  "inline-flex items-center justify-center shrink-0",
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

const priorityConfig: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "#F2994A" },
  high: { label: "High", color: "#EB5757" },
  medium: { label: "Medium", color: "#F2C94C" },
  low: { label: "Low", color: "#6FCF97" },
  none: { label: "No Priority", color: "#858699" },
};

function PriorityIcon({
  priority,
  size,
  showLabel,
  className,
  ...props
}: PriorityIconProps) {
  const config = priorityConfig[priority];
  const sizeValue = size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 20 : 16;

  if (priority === "none") {
    // Three dots icon for no priority
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        <svg
          width={sizeValue}
          height={sizeValue}
          viewBox="0 0 16 16"
          fill="none"
          className={priorityIconVariants({ size })}
          data-slot="priority-icon"
          {...props}
        >
          <circle cx="3" cy="8" r="1.5" fill={config.color} />
          <circle cx="8" cy="8" r="1.5" fill={config.color} />
          <circle cx="13" cy="8" r="1.5" fill={config.color} />
        </svg>
        {showLabel && (
          <span className="text-[12px] text-muted-foreground">{config.label}</span>
        )}
      </div>
    );
  }

  if (priority === "urgent") {
    // Warning square icon for urgent
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        <svg
          width={sizeValue}
          height={sizeValue}
          viewBox="0 0 16 16"
          fill="none"
          className={priorityIconVariants({ size })}
          data-slot="priority-icon"
          {...props}
        >
          <rect x="2" y="2" width="12" height="12" rx="2" fill={config.color} />
          <path
            d="M8 5v4"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11" r="0.75" fill="white" />
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
        width={sizeValue}
        height={sizeValue}
        viewBox="0 0 16 16"
        fill="none"
        className={priorityIconVariants({ size })}
        data-slot="priority-icon"
        {...props}
      >
        {/* Left bar (always shown) */}
        <rect
          x="2"
          y="10"
          width="3"
          height="4"
          rx="0.5"
          fill={bars >= 1 ? config.color : "#858699"}
          opacity={bars >= 1 ? 1 : 0.3}
        />
        {/* Middle bar */}
        <rect
          x="6.5"
          y="7"
          width="3"
          height="7"
          rx="0.5"
          fill={bars >= 2 ? config.color : "#858699"}
          opacity={bars >= 2 ? 1 : 0.3}
        />
        {/* Right bar */}
        <rect
          x="11"
          y="4"
          width="3"
          height="10"
          rx="0.5"
          fill={bars >= 3 ? config.color : "#858699"}
          opacity={bars >= 3 ? 1 : 0.3}
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
