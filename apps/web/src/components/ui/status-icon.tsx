import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Status Icon component
 *
 * Features:
 * - 5 status types: backlog, todo, in_progress, done, canceled
 * - 16px default size
 * - Color-coded circles with different states
 * - Animated progress indicator
 */
const statusIconVariants = cva(
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

export type Status = "backlog" | "todo" | "in_progress" | "done" | "canceled";

interface StatusIconProps
  extends React.SVGProps<SVGSVGElement>,
    VariantProps<typeof statusIconVariants> {
  status: Status;
  showLabel?: boolean;
}

const statusConfig: Record<Status, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#858699" },
  todo: { label: "Todo", color: "#858699" },
  in_progress: { label: "In Progress", color: "#F2C94C" },
  done: { label: "Done", color: "#5E6AD2" },
  canceled: { label: "Canceled", color: "#858699" },
};

function StatusIcon({
  status,
  size,
  showLabel,
  className,
  ...props
}: StatusIconProps) {
  const config = statusConfig[status];
  const sizeValue = size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 20 : 16;
  const strokeWidth = size === "xs" ? 1 : 1.5;

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <svg
        width={sizeValue}
        height={sizeValue}
        viewBox="0 0 16 16"
        fill="none"
        className={statusIconVariants({ size })}
        data-slot="status-icon"
        {...props}
      >
        {status === "backlog" && (
          <>
            {/* Dotted circle for backlog */}
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
              strokeDasharray="2 2"
              fill="none"
            />
          </>
        )}

        {status === "todo" && (
          <>
            {/* Empty circle for todo */}
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
              fill="none"
            />
          </>
        )}

        {status === "in_progress" && (
          <>
            {/* Half-filled circle for in progress */}
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
              fill="none"
            />
            <path
              d="M8 2A6 6 0 0 1 8 14"
              fill={config.color}
            />
          </>
        )}

        {status === "done" && (
          <>
            {/* Filled circle with checkmark for done */}
            <circle cx="8" cy="8" r="7" fill={config.color} />
            <path
              d="M5 8L7 10L11 6"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        )}

        {status === "canceled" && (
          <>
            {/* Circle with X for canceled */}
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
              fill="none"
            />
            <path
              d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
              stroke={config.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      {showLabel && (
        <span
          className="text-[12px]"
          style={{ color: status === "done" ? config.color : "#D2D3E0" }}
        >
          {config.label}
        </span>
      )}
    </div>
  );
}

export { StatusIcon, statusIconVariants, statusConfig };
