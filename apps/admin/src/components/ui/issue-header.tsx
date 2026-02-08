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
        "rounded-[4px] p-px",
        "bg-accent",
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
      <div className="flex items-center font-medium text-[13px] text-foreground">
        <button
          className="cursor-pointer hover:underline"
          onClick={onTeamClick}
          type="button"
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
      <div className="flex items-center justify-between border-border border-b py-3">
        <div className="flex items-center gap-3">
          <IssueBreadcrumb
            issueId={issueId}
            onTeamClick={onTeamClick}
            teamColor={teamColor}
            teamName={teamName}
          />
          <IssueStar
            onStarredChange={onStarredChange}
            size="sm"
            starred={starred}
          />
        </div>

        <button
          aria-label="More options"
          className={cn(
            "inline-flex items-center justify-center",
            "rounded-[4px] p-[6px]",
            "text-muted-foreground",
            "transition-colors duration-150",
            "hover:bg-muted hover:text-foreground"
          )}
          onClick={onMoreClick}
          type="button"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { IssueHeader, IssueBreadcrumb, TeamIcon };
