"use client";

import { MoreHorizontal, Network } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { IssueStar } from "./issue-star";

/**
 * Linear-style Issue Header component
 *
 * Features:
 * - Team icon with color
 * - Breadcrumb navigation (Workspace › Issue ID)
 * - Star/favorite toggle
 * - More options button
 */

interface TeamIconProps {
  color?: string;
  className?: string;
}

function TeamIcon({ color = "#00B2BF", className }: TeamIconProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center justify-center",
        "p-px rounded-[4px]",
        "bg-[#292B41]",
        className
      )}
    >
      <Network className="size-4" style={{ color }} />
    </div>
  );
}

interface BreadcrumbProps {
  teamName: string;
  issueId: string;
  teamColor?: string;
  onTeamClick?: () => void;
  className?: string;
}

function IssueBreadcrumb({
  teamName,
  issueId,
  teamColor = "#00B2BF",
  onTeamClick,
  className,
}: BreadcrumbProps) {
  return (
    <div className={cn("flex items-center gap-[14px]", className)}>
      <TeamIcon color={teamColor} />
      <div className="flex items-center text-[13px] font-medium text-[#EEEFFC]">
        <button
          type="button"
          onClick={onTeamClick}
          className="hover:underline cursor-pointer"
        >
          {teamName}
        </button>
        <span className="mx-1"> › </span>
        <span>{issueId}</span>
      </div>
    </div>
  );
}

interface IssueHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  teamName: string;
  issueId: string;
  teamColor?: string;
  starred?: boolean;
  onTeamClick?: () => void;
  onStarredChange?: (starred: boolean) => void;
  onMoreClick?: () => void;
}

function IssueHeader({
  className,
  teamName,
  issueId,
  teamColor = "#00B2BF",
  starred = false,
  onTeamClick,
  onStarredChange,
  onMoreClick,
  ...props
}: IssueHeaderProps) {
  return (
    <div
      className={cn("px-[40px]", className)}
      data-slot="issue-header"
      {...props}
    >
      <div className="flex items-center justify-between py-3 border-b border-[#2C2D3C]">
        <div className="flex items-center gap-3">
          <IssueBreadcrumb
            teamName={teamName}
            issueId={issueId}
            teamColor={teamColor}
            onTeamClick={onTeamClick}
          />
          <IssueStar
            starred={starred}
            onStarredChange={onStarredChange}
            size="sm"
          />
        </div>

        <button
          type="button"
          onClick={onMoreClick}
          className={cn(
            "inline-flex items-center justify-center",
            "p-[6px] rounded-[4px]",
            "text-[#858699]",
            "transition-colors duration-150",
            "hover:bg-muted hover:text-foreground"
          )}
          aria-label="More options"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { IssueHeader, IssueBreadcrumb, TeamIcon };
