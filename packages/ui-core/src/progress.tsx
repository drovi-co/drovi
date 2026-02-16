"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Progress component
 *
 * Features:
 * - Slim 4px height
 * - Muted background track
 * - Primary color indicator
 * - Smooth transition
 */
interface ProgressProps
  extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  indicatorClassName?: string;
}

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      className={cn(
        "relative h-1 w-full overflow-hidden rounded-full",
        "bg-muted",
        className
      )}
      data-slot="progress"
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full w-full flex-1 rounded-full",
          "bg-primary",
          "transition-transform duration-300 ease-out",
          indicatorClassName
        )}
        data-slot="progress-indicator"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

/**
 * Linear-style Progress Wheel (circular progress)
 *
 * Features:
 * - 14px size matching Linear design
 * - SVG-based circular progress
 * - Smooth animation
 */
interface ProgressWheelProps extends React.SVGProps<SVGSVGElement> {
  value?: number;
  size?: number;
  strokeWidth?: number;
}

function ProgressWheel({
  value = 0,
  size = 14,
  strokeWidth = 2,
  className,
  ...props
}: ProgressWheelProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg
      className={cn("text-primary", className)}
      data-slot="progress-wheel"
      fill="none"
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      {...props}
    >
      {/* Background circle */}
      <circle
        className="opacity-20"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      {/* Progress circle */}
      <circle
        className="transition-[stroke-dashoffset] duration-300 ease-out"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export { Progress, ProgressWheel };
