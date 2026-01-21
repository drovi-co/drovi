"use client";

import { format, isPast, isThisWeek, isToday, isTomorrow } from "date-fns";
import { Check, Clock, MoreHorizontal } from "lucide-react";
import type * as React from "react";
import { SourceIcon } from "@/components/inbox/source-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";

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
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "overdue"
    | "waiting"
    | "snoozed";
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

interface CommitmentRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
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
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  person: "w-[120px]", // 120px
} as const;

function getPriority(
  dueDate: Date | null | undefined,
  status: string
): Priority {
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
  person:
    | { displayName?: string | null; primaryEmail: string }
    | null
    | undefined
): string {
  if (!person) return "Unknown";
  return person.displayName || person.primaryEmail.split("@")[0] || "Unknown";
}

function formatDueDate(
  date: Date | null | undefined,
  daysOverdue?: number
): string {
  if (!date) return "No due date";
  if (isPast(date)) {
    const days =
      daysOverdue ??
      Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
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
    return (
      <div className={cn("flex items-center justify-center", className)}>
        {children}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex items-center justify-center",
        "rounded-[4px] transition-all duration-100",
        "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-secondary",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      type="button"
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
  const otherPerson =
    commitment.direction === "owed_by_me"
      ? commitment.creditor
      : commitment.debtor;
  const personName = getPersonName(otherPerson);
  const dueDateDisplay = formatDueDate(
    commitment.dueDate,
    commitment.daysOverdue
  );
  const confidenceLevel = getConfidenceLevel(commitment.confidence);

  const isOverdue =
    commitment.status === "overdue" ||
    (commitment.dueDate && isPast(commitment.dueDate));
  const isCompleted =
    commitment.status === "completed" || commitment.status === "cancelled";

  return (
    <div
      className={cn(
        "group flex h-10 items-center",
        "cursor-pointer transition-colors duration-100",
        "border-border border-b",
        isSelected && "bg-accent",
        isActive &&
          "border-l-2 border-l-secondary bg-accent pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !(isSelected || isActive) && "hover:bg-muted",
        className
      )}
      data-slot="commitment-row"
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
          onCheckedChange={(checked) => onSelect?.(commitment.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width */}
      <div
        className={cn(
          COL.priority,
          "flex shrink-0 items-center justify-center"
        )}
      >
        <PriorityIcon priority={priority} size="sm" />
      </div>

      {/* Source - fixed width */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        {commitment.sourceType ? (
          <SourceIcon size="sm" sourceType={commitment.sourceType} />
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

      {/* Person - fixed width */}
      <div className={cn(COL.person, "shrink-0 px-1")}>
        <div className="flex items-center gap-1.5">
          <AssigneeIcon
            email={otherPerson?.primaryEmail}
            name={otherPerson?.displayName ?? undefined}
            size="xs"
          />
          <span className="truncate font-medium text-[13px] text-foreground">
            {personName}
          </span>
        </div>
      </div>

      {/* Title - flexible width */}
      <div className="min-w-0 flex-1 px-2">
        <span
          className={cn(
            "block truncate font-normal text-[13px] text-muted-foreground",
            isCompleted && "line-through opacity-60"
          )}
        >
          {commitment.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Due Date + Direction + Confidence - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Due Date */}
          <span
            className={cn(
              "w-14 whitespace-nowrap text-right font-normal text-[12px]",
              isOverdue ? "text-red-400" : "text-muted-foreground"
            )}
          >
            {dueDateDisplay}
          </span>

          {/* Direction indicator */}
          <div className="flex w-7 items-center justify-center">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-medium text-[10px]",
                commitment.direction === "owed_by_me"
                  ? "bg-blue-500/20 text-blue-400"
                  : "bg-purple-500/20 text-purple-400"
              )}
            >
              {commitment.direction === "owed_by_me" ? "I" : "Me"}
            </span>
          </div>

          {/* Confidence indicator */}
          <div className="flex w-7 items-center justify-center">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                confidenceLevel === "high" && "bg-green-500",
                confidenceLevel === "medium" && "bg-yellow-500",
                confidenceLevel === "low" && "bg-red-500",
                commitment.isUserVerified &&
                  "ring-2 ring-green-400 ring-offset-1 ring-offset-card"
              )}
              title={`${Math.round(commitment.confidence * 100)}% confidence${commitment.isUserVerified ? " (verified)" : ""}`}
            />
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          {/* Complete button */}
          {!isCompleted && onComplete && (
            <button
              aria-label="Mark complete"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[4px]",
                "transition-colors duration-100",
                "text-green-500",
                "hover:bg-accent hover:text-green-400"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onComplete();
              }}
              type="button"
            >
              <Check className="size-4" />
            </button>
          )}

          {/* Snooze dropdown */}
          {!isCompleted && onSnooze && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Snooze"
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-[4px]",
                    "transition-colors duration-100",
                    "text-muted-foreground",
                    "hover:bg-accent hover:text-foreground"
                  )}
                  onClick={(e) => e.stopPropagation()}
                  type="button"
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
                  <DropdownMenuItem
                    className="text-red-400"
                    onClick={onDismiss}
                  >
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
interface CommitmentListHeaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
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
        "flex h-8 items-center px-3",
        "border-border border-b bg-background",
        "font-medium text-[11px] text-muted-foreground uppercase tracking-wider",
        className
      )}
      data-slot="commitment-list-header"
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

      {/* Person */}
      <div className={cn(COL.person, "shrink-0 px-1")}>Person</div>

      {/* Title */}
      <div className="flex-1 px-2">Commitment</div>

      {/* Right section */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        <div className="flex items-center gap-1.5">
          <span className="w-14 whitespace-nowrap text-right">Due</span>
          <div className="w-7" />
          <div className="w-7" />
        </div>
      </div>
    </div>
  );
}

export {
  CommitmentRow,
  CommitmentListHeader,
  type CommitmentRowProps,
  type CommitmentListHeaderProps,
};
