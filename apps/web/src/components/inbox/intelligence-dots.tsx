"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Intelligence Dots component for the unified inbox
 *
 * Shows colored dots to indicate:
 * - Blue: Has commitments
 * - Purple: Has decisions
 * - Amber: Has open loops
 */

interface IntelligenceDotsProps extends React.HTMLAttributes<HTMLDivElement> {
  hasCommitments?: boolean;
  hasDecisions?: boolean;
  hasOpenLoops?: boolean;
  commitmentCount?: number;
  decisionCount?: number;
  openLoopCount?: number;
  size?: "xs" | "sm" | "md";
}

const sizeClasses = {
  xs: "size-1.5",
  sm: "size-2",
  md: "size-2.5",
};

const dotColors = {
  commitment: "#5E6AD2", // Blue/purple (Linear primary)
  decision: "#9333EA", // Purple
  openLoop: "#F59E0B", // Amber
};

function IntelligenceDots({
  hasCommitments = false,
  hasDecisions = false,
  hasOpenLoops = false,
  commitmentCount,
  decisionCount,
  openLoopCount,
  size = "sm",
  className,
  ...props
}: IntelligenceDotsProps) {
  const showCommitment = hasCommitments || (commitmentCount ?? 0) > 0;
  const showDecision = hasDecisions || (decisionCount ?? 0) > 0;
  const showOpenLoop = hasOpenLoops || (openLoopCount ?? 0) > 0;

  if (!(showCommitment || showDecision || showOpenLoop)) {
    return null;
  }

  return (
    <div
      className={cn("flex items-center gap-1", className)}
      data-slot="intelligence-dots"
      {...props}
    >
      {showCommitment && (
        <div
          className={cn("rounded-full", sizeClasses[size])}
          style={{ backgroundColor: dotColors.commitment }}
          title={`${commitmentCount ?? 1} commitment${(commitmentCount ?? 1) > 1 ? "s" : ""}`}
        />
      )}
      {showDecision && (
        <div
          className={cn("rounded-full", sizeClasses[size])}
          style={{ backgroundColor: dotColors.decision }}
          title={`${decisionCount ?? 1} decision${(decisionCount ?? 1) > 1 ? "s" : ""}`}
        />
      )}
      {showOpenLoop && (
        <div
          className={cn("rounded-full", sizeClasses[size])}
          style={{ backgroundColor: dotColors.openLoop }}
          title={`${openLoopCount ?? 1} open loop${(openLoopCount ?? 1) > 1 ? "s" : ""}`}
        />
      )}
    </div>
  );
}

export { IntelligenceDots, type IntelligenceDotsProps };
