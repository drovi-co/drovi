"use client";

import { format, isToday, isYesterday } from "date-fns";
import { Copy, Eye, MoreHorizontal } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { SourceIcon } from "@/components/inbox/source-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";

/**
 * Linear-style Decision Row component
 *
 * Layout - fixed widths for perfect alignment:
 * | Checkbox(28) | Priority(28) | Source(24) | Status(28) | Owner(120) | Title(flex) | Right(140px) |
 *
 * Right section (140px fixed):
 * - Default: Date | Topic | Confidence
 * - On hover: Copy | Evidence | More actions
 */

export interface DecisionRowData {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
  supersededBy?: {
    id: string;
    title: string;
    decidedAt: Date;
  } | null;
  owners?: Array<{
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  }>;
  topics?: Array<{
    id: string;
    name: string;
  }>;
  sourceType?: SourceType;
}

interface DecisionRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  decision: DecisionRowData;
  isSelected?: boolean;
  isActive?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onClick?: () => void;
  onCopy?: () => void;
  onShowEvidence?: () => void;
  onDismiss?: () => void;
  onVerify?: () => void;
  onViewSupersession?: () => void;
}

// Fixed column widths for perfect alignment
const COL = {
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  owner: "w-[120px]", // 120px
} as const;

function getStatus(decision: DecisionRowData): Status {
  if (decision.isSuperseded || decision.supersededBy) {
    return "done";
  }
  return "in_progress"; // Active decisions
}

function getOwnerName(
  owner:
    | { displayName?: string | null; primaryEmail: string }
    | null
    | undefined
): string {
  if (!owner) {
    return "Unknown";
  }
  return owner.displayName || owner.primaryEmail.split("@")[0] || "Unknown";
}

function formatDecisionDate(date: Date): string {
  if (isToday(date)) {
    return "Today";
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "MMM d");
}

function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) {
    return "high";
  }
  if (confidence >= 0.5) {
    return "medium";
  }
  return "low";
}

function DecisionRow({
  decision,
  isSelected = false,
  isActive = false,
  onSelect,
  onClick,
  onCopy,
  onShowEvidence,
  onDismiss,
  onVerify,
  onViewSupersession,
  className,
  ...props
}: DecisionRowProps) {
  const status = getStatus(decision);
  const firstOwner = decision.owners?.[0];
  const ownerName = getOwnerName(firstOwner);
  const dateDisplay = formatDecisionDate(decision.decidedAt);
  const confidenceLevel = getConfidenceLevel(decision.confidence);
  const firstTopic = decision.topics?.[0];

  const isSuperseded = decision.isSuperseded || !!decision.supersededBy;

  const handleCopy = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success("Decision statement copied");
    onCopy?.();
  };

  return (
    <div
      className={cn(
        "group flex h-10 items-center",
        "cursor-pointer transition-colors duration-100",
        "border-border border-b",
        isSuperseded && "opacity-60",
        isSelected && "bg-accent",
        isActive &&
          "border-l-2 border-l-secondary bg-accent pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !(isSelected || isActive) && "hover:bg-muted",
        className
      )}
      data-slot="decision-row"
      onClick={onClick}
      {...props}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(
          COL.checkbox,
          "flex shrink-0 items-center justify-center"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect?.(decision.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width (always none for decisions) */}
      <div
        className={cn(
          COL.priority,
          "flex shrink-0 items-center justify-center"
        )}
      >
        <PriorityIcon priority="none" size="sm" />
      </div>

      {/* Source - fixed width */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        {decision.sourceType ? (
          <SourceIcon size="sm" sourceType={decision.sourceType} />
        ) : (
          <div className="h-4 w-4" />
        )}
      </div>

      {/* Status - fixed width */}
      <div
        className={cn(COL.status, "flex shrink-0 items-center justify-center")}
      >
        <StatusIcon size="sm" status={status} />
      </div>

      {/* Owner - fixed width */}
      <div className={cn(COL.owner, "shrink-0 px-1")}>
        <div className="flex items-center gap-1.5">
          <AssigneeIcon
            email={firstOwner?.primaryEmail}
            name={firstOwner?.displayName ?? undefined}
            size="xs"
          />
          <span className="truncate font-medium text-[13px] text-foreground">
            {ownerName}
          </span>
        </div>
      </div>

      {/* Title - flexible width */}
      <div className="min-w-0 flex-1 px-2">
        <span
          className={cn(
            "block truncate font-normal text-[13px] text-muted-foreground",
            isSuperseded && "line-through"
          )}
        >
          {decision.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Date + Topic + Confidence - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date */}
          <span className="w-14 whitespace-nowrap text-right font-normal text-[12px] text-muted-foreground">
            {dateDisplay}
          </span>

          {/* Topic badge */}
          <div className="flex w-7 items-center justify-center">
            {firstTopic ? (
              <Badge
                className="h-4 max-w-[28px] truncate px-1 py-0 text-[9px]"
                variant="secondary"
              >
                {firstTopic.name.slice(0, 3)}
              </Badge>
            ) : (
              <div className="w-4" />
            )}
          </div>

          {/* Confidence indicator */}
          <div className="flex w-7 items-center justify-center">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                confidenceLevel === "high" && "bg-green-500",
                confidenceLevel === "medium" && "bg-yellow-500",
                confidenceLevel === "low" && "bg-red-500",
                decision.isUserVerified &&
                  "ring-2 ring-green-400 ring-offset-1 ring-offset-card"
              )}
              title={`${Math.round(decision.confidence * 100)}% confidence${decision.isUserVerified ? " (verified)" : ""}`}
            />
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          {/* Copy button */}
          <button
            aria-label="Copy statement"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            type="button"
          >
            <Copy className="size-4" />
          </button>

          {/* Evidence button */}
          {onShowEvidence && (
            <button
              aria-label="Show evidence"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[4px]",
                "transition-colors duration-100",
                "text-purple-500",
                "hover:bg-accent hover:text-purple-400"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onShowEvidence();
              }}
              type="button"
            >
              <Eye className="size-4" />
            </button>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="More actions"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-[4px]",
                  "transition-colors duration-100",
                  "text-muted-foreground",
                  "hover:bg-accent hover:text-foreground"
                )}
                onClick={(e) => e.stopPropagation()}
                type="button"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopy}>
                Copy Statement
              </DropdownMenuItem>
              {onShowEvidence && (
                <DropdownMenuItem onClick={onShowEvidence}>
                  Show Evidence
                </DropdownMenuItem>
              )}
              {onViewSupersession && (
                <DropdownMenuItem onClick={onViewSupersession}>
                  View Decision History
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!decision.isUserVerified && onVerify && (
                <DropdownMenuItem onClick={onVerify}>
                  Verify (Correct)
                </DropdownMenuItem>
              )}
              {onDismiss && (
                <DropdownMenuItem className="text-red-400" onClick={onDismiss}>
                  Dismiss (Incorrect)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * Decision List Header - matches row layout exactly for alignment
 */
interface DecisionListHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  onSelectAll?: (selected: boolean) => void;
  allSelected?: boolean;
  someSelected?: boolean;
}

function DecisionListHeader({
  onSelectAll,
  allSelected = false,
  someSelected = false,
  className,
  ...props
}: DecisionListHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-8 items-center px-3",
        "border-border border-b bg-background",
        "font-medium text-[11px] text-muted-foreground uppercase tracking-wider",
        className
      )}
      data-slot="decision-list-header"
      {...props}
    >
      {/* Checkbox */}
      <div
        className={cn(
          COL.checkbox,
          "flex shrink-0 items-center justify-center"
        )}
      >
        <IssueCheckbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(checked) => onSelectAll?.(checked)}
          size="sm"
        />
      </div>

      {/* Priority */}
      <div className={cn(COL.priority, "shrink-0")} />

      {/* Source */}
      <div className={cn(COL.source, "shrink-0")} />

      {/* Status */}
      <div className={cn(COL.status, "shrink-0")} />

      {/* Owner */}
      <div className={cn(COL.owner, "shrink-0 px-1")}>Owner</div>

      {/* Title */}
      <div className="flex-1 px-2">Decision</div>

      {/* Right section */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        <div className="flex items-center gap-1.5">
          <span className="w-14 whitespace-nowrap text-right">Date</span>
          <div className="w-7" />
          <div className="w-7" />
        </div>
      </div>
    </div>
  );
}

export {
  DecisionRow,
  DecisionListHeader,
  type DecisionRowProps,
  type DecisionListHeaderProps,
};
