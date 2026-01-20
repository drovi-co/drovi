"use client";

import type * as React from "react";
import {
  getSourceColor,
  getSourceIcon,
  type SourceType,
} from "@/lib/source-config";
import { cn } from "@/lib/utils";

/**
 * Source Icon component for the unified inbox
 *
 * Displays a small icon representing the source type (email, slack, etc.)
 * with source-specific colors
 */

interface SourceIconProps extends React.HTMLAttributes<HTMLDivElement> {
  sourceType: SourceType;
  size?: "xs" | "sm" | "md";
  showColor?: boolean;
}

const sizeClasses = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
};

function SourceIcon({
  sourceType,
  size = "sm",
  showColor = true,
  className,
  ...props
}: SourceIconProps) {
  const Icon = getSourceIcon(sourceType);
  const color = getSourceColor(sourceType);

  return (
    <div
      className={cn("flex shrink-0 items-center justify-center", className)}
      {...props}
    >
      <Icon
        className={cn(sizeClasses[size])}
        style={showColor ? { color } : undefined}
      />
    </div>
  );
}

export { SourceIcon, type SourceIconProps };
