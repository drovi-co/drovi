import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "./utils";

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

export type Status = "backlog" | "todo" | "in_progress" | "done" | "canceled";

interface StatusIconProps
  extends React.SVGProps<SVGSVGElement>,
    VariantProps<typeof statusIconVariants> {
  status: Status;
  showLabel?: boolean;
}

// Vercel-style status colors
const statusConfig: Record<Status, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#a3a3a3" },
  todo: { label: "Todo", color: "#737373" },
  in_progress: { label: "In Progress", color: "#0070f3" },
  done: { label: "Done", color: "#059669" },
  canceled: { label: "Canceled", color: "#a3a3a3" },
};

function StatusIcon({
  status,
  size,
  showLabel,
  className,
  ...props
}: StatusIconProps) {
  const config = statusConfig[status];
  const sizeValue =
    size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 20 : 16;
  const strokeWidth = size === "xs" ? 1 : 1.5;

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <svg
        className={statusIconVariants({ size })}
        data-slot="status-icon"
        fill="none"
        height={sizeValue}
        viewBox="0 0 16 16"
        width={sizeValue}
        {...props}
      >
        {status === "backlog" && (
          <>
            {/* Dotted circle for backlog */}
            <circle
              cx="8"
              cy="8"
              fill="none"
              r="6"
              stroke={config.color}
              strokeDasharray="2 2"
              strokeWidth={strokeWidth}
            />
          </>
        )}

        {status === "todo" && (
          <>
            {/* Empty circle for todo */}
            <circle
              cx="8"
              cy="8"
              fill="none"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
            />
          </>
        )}

        {status === "in_progress" && (
          <>
            {/* Half-filled circle for in progress */}
            <circle
              cx="8"
              cy="8"
              fill="none"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
            />
            <path d="M8 2A6 6 0 0 1 8 14" fill={config.color} />
          </>
        )}

        {status === "done" && (
          <>
            {/* Filled circle with checkmark for done */}
            <circle cx="8" cy="8" fill={config.color} r="7" />
            <path
              d="M5 8L7 10L11 6"
              fill="none"
              stroke="white"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </>
        )}

        {status === "canceled" && (
          <>
            {/* Circle with X for canceled */}
            <circle
              cx="8"
              cy="8"
              fill="none"
              r="6"
              stroke={config.color}
              strokeWidth={strokeWidth}
            />
            <path
              d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5"
              stroke={config.color}
              strokeLinecap="round"
              strokeWidth={strokeWidth}
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
