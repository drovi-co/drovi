"use client";

import type * as React from "react";
import { Check, Clock, MoreHorizontal } from "lucide-react";
import { format, isPast, isToday, isTomorrow, isThisWeek } from "date-fns";

import { cn } from "@/lib/utils";
import { type SourceType } from "@/lib/source-config";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { SourceIcon } from "@/components/inbox/source-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Linear-style Commitment Row component
 *
 * Layout - fixed widths for perfect alignment:
 * | Checkbox(28) | Priority(28) | Source(24) | Status(28) | Person(120) | Title(flex) | Right(140px) |
 *
 * Right section (140px fixed):
 * - Default: Due Date | Direction | Confidence
 * - On hover: Complete | Snooze | More actions
 */

export interface CommitmentRowData {
  id: string;
  title: string;
  description?: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "overdue" | "waiting" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  confidence: number;
  isUserVerified?: boolean;
  debtor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  creditor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  sourceType?: SourceType;
  daysOverdue?: number;
}

interface CommitmentRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  commitment: CommitmentRowData;
  isSelected?: boolean;
  isActive?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onClick?: () => void;
  onComplete?: () => void;
  onSnooze?: (days: number) => void;
  onShowEvidence?: () => void;
  onDismiss?: () => void;
  onVerify?: () => void;
}

// Fixed column widths for perfect alignment
const COL = {
  checkbox: "w-7",      // 28px
  priority: "w-7",      // 28px
  source: "w-6",        // 24px
  status: "w-7",        // 28px
  person: "w-[120px]",  // 120px
} as const;

function getPriority(dueDate: Date | null | undefined, status: string): Priority {
  if (status === "overdue" || (dueDate && isPast(dueDate))) return "urgent";
  if (dueDate && (isToday(dueDate) || isTomorrow(dueDate))) return "high";
  if (dueDate && isThisWeek(dueDate)) return "medium";
  return "none";
}

function getStatus(status: string): Status {
  if (status === "completed") return "done";
  if (status === "in_progress" || status === "waiting") return "in_progress";
  if (status === "cancelled") return "canceled";
  if (status === "snoozed") return "backlog";
  return "todo"; // pending, overdue
}

function getPersonName(
  person: { displayName?: string | null; primaryEmail: string } | null | undefined
): string {
  if (!person) return "Unknown";
  return person.displayName || person.primaryEmail.split("@")[0] || "Unknown";
}

function formatDueDate(date: Date | null | undefined, daysOverdue?: number): string {
  if (!date) return "No due date";
  if (isPast(date)) {
    const days = daysOverdue ?? Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    return `${days}d overdue`;
  }
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "MMM d");
}

function getConfidenceLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

/**
 * Clickable cell wrapper with hover state
 */
function ClickableCell({
  children,
  onClick,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  className?: string;
  disabled?: boolean;
}) {
  if (!onClick || disabled) {
    return <div className={cn("flex items-center justify-center", className)}>{children}</div>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        "flex items-center justify-center",
        "rounded-[4px] transition-all duration-100",
        "hover:bg-[#292B41]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#5E6AD2]",
        className
      )}
    >
      {children}
    </button>
  );
}

function CommitmentRow({
  commitment,
  isSelected = false,
  isActive = false,
  onSelect,
  onClick,
  onComplete,
  onSnooze,
  onShowEvidence,
  onDismiss,
  onVerify,
  className,
  ...props
}: CommitmentRowProps) {
  const priority = getPriority(commitment.dueDate, commitment.status);
  const status = getStatus(commitment.status);
  const otherPerson = commitment.direction === "owed_by_me"
    ? commitment.creditor
    : commitment.debtor;
  const personName = getPersonName(otherPerson);
  const dueDateDisplay = formatDueDate(commitment.dueDate, commitment.daysOverdue);
  const confidenceLevel = getConfidenceLevel(commitment.confidence);

  const isOverdue = commitment.status === "overdue" || (commitment.dueDate && isPast(commitment.dueDate));
  const isCompleted = commitment.status === "completed" || commitment.status === "cancelled";

  return (
    <div
      className={cn(
        "group flex items-center h-10",
        "cursor-pointer transition-colors duration-100",
        "border-b border-[#1E1F2E]",
        isSelected && "bg-[#252736]",
        isActive && "bg-[#252736] border-l-2 border-l-[#5E6AD2] pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !isSelected && !isActive && "hover:bg-[#1E1F2E]",
        className
      )}
      onClick={onClick}
      data-slot="commitment-row"
      {...props}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(COL.checkbox, "shrink-0 flex items-center justify-center")}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect?.(commitment.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width */}
      <div className={cn(COL.priority, "shrink-0 flex items-center justify-center")}>
        <PriorityIcon priority={priority} size="sm" />
      </div>

      {/* Source - fixed width */}
      <div className={cn(COL.source, "shrink-0 flex items-center justify-center")}>
        {commitment.sourceType ? (
          <SourceIcon sourceType={commitment.sourceType} size="sm" />
        ) : (
          <div className="w-4 h-4" />
        )}
      </div>

      {/* Status - fixed width */}
      <div className={cn(COL.status, "shrink-0 flex items-center justify-center")}>
        <StatusIcon status={status} size="sm" />
      </div>

      {/* Person - fixed width */}
      <div className={cn(COL.person, "shrink-0 px-1")}>
        <div className="flex items-center gap-1.5">
          <AssigneeIcon
            name={otherPerson?.displayName ?? undefined}
            email={otherPerson?.primaryEmail}
            size="xs"
          />
          <span className="text-[13px] font-medium text-[#EEEFFC] truncate">
            {personName}
          </span>
        </div>
      </div>

      {/* Title - flexible width */}
      <div className="flex-1 min-w-0 px-2">
        <span className={cn(
          "text-[13px] font-normal text-[#6B7280] truncate block",
          isCompleted && "line-through opacity-60"
        )}>
          {commitment.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="shrink-0 w-[140px] flex items-center justify-end">
        {/* Default state: Due Date + Direction + Confidence - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Due Date */}
          <span className={cn(
            "w-14 text-right text-[12px] font-normal whitespace-nowrap",
            isOverdue ? "text-red-400" : "text-[#6B7280]"
          )}>
            {dueDateDisplay}
          </span>

          {/* Direction indicator */}
          <div className="w-7 flex items-center justify-center">
            <span className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded",
              commitment.direction === "owed_by_me"
                ? "bg-blue-500/20 text-blue-400"
                : "bg-purple-500/20 text-purple-400"
            )}>
              {commitment.direction === "owed_by_me" ? "I" : "Me"}
            </span>
          </div>

          {/* Confidence indicator */}
          <div className="w-7 flex items-center justify-center">
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                confidenceLevel === "high" && "bg-green-500",
                confidenceLevel === "medium" && "bg-yellow-500",
                confidenceLevel === "low" && "bg-red-500",
                commitment.isUserVerified && "ring-2 ring-green-400 ring-offset-1 ring-offset-[#13141B]"
              )}
              title={`${Math.round(commitment.confidence * 100)}% confidence${commitment.isUserVerified ? " (verified)" : ""}`}
            />
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden group-hover:flex items-center justify-end gap-0.5">
          {/* Complete button */}
          {!isCompleted && onComplete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              className={cn(
                "w-7 h-7 flex items-center justify-center rounded-[4px]",
                "transition-colors duration-100",
                "text-green-500",
                "hover:bg-[#292B41] hover:text-green-400"
              )}
              aria-label="Mark complete"
            >
              <Check className="size-4" />
            </button>
          )}

          {/* Snooze dropdown */}
          {!isCompleted && onSnooze && (
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
                  aria-label="Snooze"
                >
                  <Clock className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSnooze(1)}>
                  Snooze 1 day
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(3)}>
                  Snooze 3 days
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSnooze(7)}>
                  Snooze 1 week
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              {onShowEvidence && (
                <DropdownMenuItem onClick={onShowEvidence}>
                  Show Evidence
                </DropdownMenuItem>
              )}
              {!commitment.isUserVerified && onVerify && (
                <DropdownMenuItem onClick={onVerify}>
                  Verify (Correct)
                </DropdownMenuItem>
              )}
              {onDismiss && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDismiss} className="text-red-400">
                    Dismiss (Incorrect)
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/**
 * Commitment List Header - matches row layout exactly for alignment
 */
interface CommitmentListHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  onSelectAll?: (selected: boolean) => void;
  allSelected?: boolean;
  someSelected?: boolean;
}

function CommitmentListHeader({
  onSelectAll,
  allSelected = false,
  someSelected = false,
  className,
  ...props
}: CommitmentListHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center h-8 px-3",
        "bg-[#13141B] border-b border-[#1E1F2E]",
        "text-[11px] font-medium text-[#6B7280] uppercase tracking-wider",
        className
      )}
      data-slot="commitment-list-header"
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

      {/* Person */}
      <div className={cn(COL.person, "shrink-0 px-1")}>Person</div>

      {/* Title */}
      <div className="flex-1 px-2">Commitment</div>

      {/* Right section */}
      <div className="shrink-0 w-[140px] flex items-center justify-end">
        <div className="flex items-center gap-1.5">
          <span className="w-14 text-right whitespace-nowrap">Due</span>
          <div className="w-7" />
          <div className="w-7" />
        </div>
      </div>
    </div>
  );
}

export { CommitmentRow, CommitmentListHeader, type CommitmentRowProps, type CommitmentListHeaderProps };
