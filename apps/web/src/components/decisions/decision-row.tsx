"use client";

import type * as React from "react";
import { Copy, Eye, MoreHorizontal } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { type SourceType } from "@/lib/source-config";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { SourceIcon } from "@/components/inbox/source-icon";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

interface DecisionRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
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
  checkbox: "w-7",      // 28px
  priority: "w-7",      // 28px
  source: "w-6",        // 24px
  status: "w-7",        // 28px
  owner: "w-[120px]",   // 120px
} as const;

function getStatus(decision: DecisionRowData): Status {
  if (decision.isSuperseded || decision.supersededBy) return "done";
  return "in_progress"; // Active decisions
}

function getOwnerName(
  owner: { displayName?: string | null; primaryEmail: string } | null | undefined
): string {
  if (!owner) return "Unknown";
  return owner.displayName || owner.primaryEmail.split("@")[0] || "Unknown";
}

function formatDecisionDate(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
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
        "group flex items-center h-10",
        "cursor-pointer transition-colors duration-100",
        "border-b border-[#1E1F2E]",
        isSuperseded && "opacity-60",
        isSelected && "bg-[#252736]",
        isActive && "bg-[#252736] border-l-2 border-l-[#9333EA] pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !isSelected && !isActive && "hover:bg-[#1E1F2E]",
        className
      )}
      onClick={onClick}
      data-slot="decision-row"
      {...props}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(COL.checkbox, "shrink-0 flex items-center justify-center")}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect?.(decision.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width (always none for decisions) */}
      <div className={cn(COL.priority, "shrink-0 flex items-center justify-center")}>
        <PriorityIcon priority="none" size="sm" />
      </div>

      {/* Source - fixed width */}
      <div className={cn(COL.source, "shrink-0 flex items-center justify-center")}>
        {decision.sourceType ? (
          <SourceIcon sourceType={decision.sourceType} size="sm" />
        ) : (
          <div className="w-4 h-4" />
        )}
      </div>

      {/* Status - fixed width */}
      <div className={cn(COL.status, "shrink-0 flex items-center justify-center")}>
        <StatusIcon status={status} size="sm" />
      </div>

      {/* Owner - fixed width */}
      <div className={cn(COL.owner, "shrink-0 px-1")}>
        <div className="flex items-center gap-1.5">
          <AssigneeIcon
            name={firstOwner?.displayName ?? undefined}
            email={firstOwner?.primaryEmail}
            size="xs"
          />
          <span className="text-[13px] font-medium text-[#EEEFFC] truncate">
            {ownerName}
          </span>
        </div>
      </div>

      {/* Title - flexible width */}
      <div className="flex-1 min-w-0 px-2">
        <span className={cn(
          "text-[13px] font-normal text-[#6B7280] truncate block",
          isSuperseded && "line-through"
        )}>
          {decision.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="shrink-0 w-[140px] flex items-center justify-end">
        {/* Default state: Date + Topic + Confidence - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date */}
          <span className="w-14 text-right text-[12px] font-normal text-[#6B7280] whitespace-nowrap">
            {dateDisplay}
          </span>

          {/* Topic badge */}
          <div className="w-7 flex items-center justify-center">
            {firstTopic ? (
              <Badge
                variant="secondary"
                className="text-[9px] px-1 py-0 h-4 max-w-[28px] truncate"
              >
                {firstTopic.name.slice(0, 3)}
              </Badge>
            ) : (
              <div className="w-4" />
            )}
          </div>

          {/* Confidence indicator */}
          <div className="w-7 flex items-center justify-center">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                confidenceLevel === "high" && "bg-green-500",
                confidenceLevel === "medium" && "bg-yellow-500",
                confidenceLevel === "low" && "bg-red-500",
                decision.isUserVerified && "ring-2 ring-green-400 ring-offset-1 ring-offset-[#13141B]"
              )}
              title={`${Math.round(decision.confidence * 100)}% confidence${decision.isUserVerified ? " (verified)" : ""}`}
            />
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden group-hover:flex items-center justify-end gap-0.5">
          {/* Copy button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-[#6B7280]",
              "hover:bg-[#292B41] hover:text-[#EEEFFC]"
            )}
            aria-label="Copy statement"
          >
            <Copy className="size-4" />
          </button>

          {/* Evidence button */}
          {onShowEvidence && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowEvidence();
              }}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-[4px]",
                "transition-colors duration-100",
                "text-purple-500",
                "hover:bg-[#292B41] hover:text-purple-400"
              )}
              aria-label="Show evidence"
            >
              <Eye className="size-4" />
            </button>
          )}

          {/* More menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-[4px]",
                  "transition-colors duration-100",
                  "text-[#6B7280]",
                  "hover:bg-[#292B41] hover:text-[#EEEFFC]"
                )}
                aria-label="More actions"
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
                <DropdownMenuItem onClick={onDismiss} className="text-red-400">
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
        "flex items-center h-8 px-3",
        "bg-[#13141B] border-b border-[#1E1F2E]",
        "text-[11px] font-medium text-[#6B7280] uppercase tracking-wider",
        className
      )}
      data-slot="decision-list-header"
      {...props}
    >
      {/* Checkbox */}
      <div className={cn(COL.checkbox, "shrink-0 flex items-center justify-center")}>
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
      <div className="shrink-0 w-[140px] flex items-center justify-end">
        <div className="flex items-center gap-1.5">
          <span className="w-14 text-right whitespace-nowrap">Date</span>
          <div className="w-7" />
          <div className="w-7" />
        </div>
      </div>
    </div>
  );
}

export { DecisionRow, DecisionListHeader, type DecisionRowProps, type DecisionListHeaderProps };
