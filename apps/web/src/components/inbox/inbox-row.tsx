"use client";

import type * as React from "react";
import { Archive, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { cn } from "@/lib/utils";
import { type SourceType } from "@/lib/source-config";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { PriorityIcon, type Priority } from "@/components/ui/priority-icon";
import { StatusIcon, type Status } from "@/components/ui/status-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { SourceIcon } from "./source-icon";
import { IntelligenceDots } from "./intelligence-dots";
import {
  TaskStatusDropdown,
  TaskPriorityDropdown,
  TaskAssigneeDropdown,
  type TaskStatus,
  type TaskPriority,
  type TaskAssignee,
} from "@/components/tasks";

/**
 * Linear-style Inbox Row component
 *
 * Layout - fixed widths for perfect alignment:
 * | Checkbox(28) | Priority(28) | Source(24) | Status(28) | Sender(120) | Brief(flex) | Right(140px) |
 *
 * Right section (140px fixed):
 * - Default: Date | Assignee(28) | Dots(28)
 * - On hover: Star | Archive buttons replace entire section
 */

export interface InboxItem {
  id: string;
  sourceType: SourceType;
  sourceAccountId: string;
  sourceAccountName?: string;
  externalId: string;
  conversationType: string | null;
  title: string;
  snippet: string;
  brief?: string | null;
  participants: Array<{ id: string; name?: string; email?: string }>;
  messageCount: number;
  lastMessageAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  priorityTier: string | null;
  urgencyScore: number | null;
  importanceScore: number | null;
  hasOpenLoops: boolean | null;
  openLoopCount: number | null;
  suggestedAction: string | null;
  hasCommitments?: boolean;
  commitmentCount?: number;
  hasDecisions?: boolean;
  decisionCount?: number;
  assignee?: { name?: string; email?: string; imageUrl?: string };
  metadata?: Record<string, unknown>;
  /** Linked task data - if present, shows task controls */
  task?: {
    id: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: TaskAssignee | null;
  };
}

interface InboxRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  item: InboxItem;
  isSelected?: boolean;
  isActive?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onClick?: () => void;
  onStar?: (starred: boolean) => void;
  onArchive?: () => void;
  onPriorityClick?: (e: React.MouseEvent) => void;
  onStatusClick?: (e: React.MouseEvent) => void;
  onAssigneeClick?: (e: React.MouseEvent) => void;
  onDotsClick?: (e: React.MouseEvent) => void;
  currentUserId?: string;
  /** Organization ID - required if task controls should be editable */
  organizationId?: string;
}

// Fixed column widths for perfect alignment (left side)
const COL = {
  checkbox: "w-7",      // 28px
  priority: "w-7",      // 28px
  source: "w-6",        // 24px
  status: "w-7",        // 28px
  sender: "w-[120px]",  // 120px
} as const;

function getPriority(urgencyScore: number | null): Priority {
  const urgency = urgencyScore ?? 0;
  if (urgency >= 0.8) return "urgent";
  if (urgency >= 0.6) return "high";
  if (urgency >= 0.4) return "medium";
  if (urgency >= 0.2) return "low";
  return "none";
}

function getStatus(isRead: boolean, isArchived: boolean): Status {
  if (isArchived) return "done";
  if (isRead) return "in_progress";
  return "todo";
}

function getSenderName(
  participants: Array<{ id: string; name?: string; email?: string }>,
  currentUserId?: string
): string {
  const sender = participants.find((p) => p.id !== currentUserId);
  if (!sender) {
    const first = participants[0];
    if (!first) return "Unknown";
    return first.name || first.email?.split("@")[0] || "Unknown";
  }
  return sender.name || sender.email?.split("@")[0] || "Unknown";
}

function formatDate(date: Date | null): string {
  if (!date) return "";
  return formatDistanceToNow(date, { addSuffix: false });
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

function InboxRow({
  item,
  isSelected = false,
  isActive = false,
  onSelect,
  onClick,
  onStar,
  onArchive,
  onPriorityClick,
  onStatusClick,
  onAssigneeClick,
  onDotsClick,
  currentUserId,
  organizationId,
  className,
  ...props
}: InboxRowProps) {
  const priority = getPriority(item.urgencyScore);
  const status = getStatus(item.isRead, item.isArchived);
  const senderName = getSenderName(item.participants, currentUserId);
  const dateDisplay = formatDate(item.lastMessageAt);
  // Fallback chain for brief text: AI brief → suggested action → title → snippet
  const briefText = item.brief || item.suggestedAction || item.title || item.snippet || "No summary available";
  // Check if we should use task controls
  const hasTaskData = item.task && organizationId;

  const hasIntelligence =
    item.hasCommitments ||
    item.hasDecisions ||
    item.hasOpenLoops ||
    (item.commitmentCount ?? 0) > 0 ||
    (item.decisionCount ?? 0) > 0 ||
    (item.openLoopCount ?? 0) > 0;

  return (
    <div
      className={cn(
        "group flex items-center h-10",
        "cursor-pointer transition-colors duration-100",
        "border-b border-[#1E1F2E]",
        !item.isRead && "bg-[#1A1B26]",
        isSelected && "bg-[#252736]",
        isActive && "bg-[#252736] border-l-2 border-l-[#5E6AD2] pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !isSelected && !isActive && "hover:bg-[#1E1F2E]",
        className
      )}
      onClick={onClick}
      data-slot="inbox-row"
      {...props}
    >
      {/* Checkbox - fixed width */}
      <div
        className={cn(COL.checkbox, "shrink-0 flex items-center justify-center")}
        onClick={(e) => e.stopPropagation()}
      >
        <IssueCheckbox
          checked={isSelected}
          onCheckedChange={(checked) => onSelect?.(item.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width, use task dropdown if task data exists */}
      {hasTaskData ? (
        <div
          className={cn(COL.priority, "h-7 shrink-0 flex items-center justify-center")}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskPriorityDropdown
            taskId={item.task!.id}
            organizationId={organizationId!}
            currentPriority={item.task!.priority}
            compact
            align="start"
          />
        </div>
      ) : (
        <ClickableCell
          onClick={onPriorityClick}
          className={cn(COL.priority, "h-7 shrink-0")}
        >
          <PriorityIcon priority={priority} size="sm" />
        </ClickableCell>
      )}

      {/* Source - fixed width */}
      <div className={cn(COL.source, "shrink-0 flex items-center justify-center")}>
        <SourceIcon sourceType={item.sourceType} size="sm" />
      </div>

      {/* Status - fixed width, use task dropdown if task data exists */}
      {hasTaskData ? (
        <div
          className={cn(COL.status, "h-7 shrink-0 flex items-center justify-center")}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskStatusDropdown
            taskId={item.task!.id}
            organizationId={organizationId!}
            currentStatus={item.task!.status}
            compact
            align="start"
          />
        </div>
      ) : (
        <ClickableCell
          onClick={onStatusClick}
          className={cn(COL.status, "h-7 shrink-0")}
        >
          <StatusIcon status={status} size="sm" />
        </ClickableCell>
      )}

      {/* Sender - fixed width */}
      <div className={cn(COL.sender, "shrink-0 px-1")}>
        <span
          className={cn(
            "text-[13px] truncate block",
            !item.isRead ? "font-medium text-[#EEEFFC]" : "font-normal text-[#9CA3AF]"
          )}
        >
          {senderName}
        </span>
      </div>

      {/* Brief - flexible width, takes remaining space */}
      <div className="flex-1 min-w-0 px-2">
        <span className="text-[13px] font-normal text-[#6B7280] truncate block">
          {briefText}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="shrink-0 w-[140px] flex items-center justify-end">
        {/* Default state: Date + Assignee + Dots - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date - fixed width, right aligned text */}
          <span className="w-14 text-right text-[12px] font-normal text-[#6B7280] whitespace-nowrap">
            {dateDisplay}
          </span>

          {/* Assignee */}
          <div className="w-7 h-7 flex items-center justify-center">
            {hasTaskData ? (
              <div onClick={(e) => e.stopPropagation()}>
                <TaskAssigneeDropdown
                  taskId={item.task!.id}
                  organizationId={organizationId!}
                  currentAssignee={item.task!.assignee}
                  compact
                  align="end"
                />
              </div>
            ) : item.assignee ? (
              <AssigneeIcon
                name={item.assignee.name}
                email={item.assignee.email}
                imageUrl={item.assignee.imageUrl}
                size="xs"
              />
            ) : (
              <AssigneeIcon size="xs" />
            )}
          </div>

          {/* Dots or Star */}
          <div className="w-7 flex items-center justify-center">
            {item.isStarred ? (
              <Star className="size-4 fill-yellow-400 text-yellow-400" />
            ) : (
              <IntelligenceDots
                hasCommitments={item.hasCommitments}
                commitmentCount={item.commitmentCount}
                hasDecisions={item.hasDecisions}
                decisionCount={item.decisionCount}
                hasOpenLoops={item.hasOpenLoops ?? false}
                openLoopCount={item.openLoopCount ?? undefined}
                size="sm"
              />
            )}
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden group-hover:flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStar?.(!item.isStarred);
            }}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              item.isStarred ? "text-yellow-400" : "text-[#6B7280]",
              "hover:bg-[#292B41] hover:text-[#EEEFFC]"
            )}
            aria-label={item.isStarred ? "Unstar" : "Star"}
          >
            <Star className={cn("size-4", item.isStarred && "fill-yellow-400")} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onArchive?.();
            }}
            className={cn(
              "w-7 h-7 flex items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-[#6B7280]",
              "hover:bg-[#292B41] hover:text-[#EEEFFC]"
            )}
            aria-label="Archive"
          >
            <Archive className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Inbox List Header - matches row layout exactly for alignment
 */
interface InboxListHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  onSelectAll?: (selected: boolean) => void;
  allSelected?: boolean;
  someSelected?: boolean;
}

function InboxListHeader({
  onSelectAll,
  allSelected = false,
  someSelected = false,
  className,
  ...props
}: InboxListHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center h-8 px-3",
        "bg-[#13141B] border-b border-[#1E1F2E]",
        "text-[11px] font-medium text-[#6B7280] uppercase tracking-wider",
        className
      )}
      data-slot="inbox-list-header"
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

      {/* Sender */}
      <div className={cn(COL.sender, "shrink-0 px-1")}>From</div>

      {/* Brief */}
      <div className="flex-1 px-2">Summary</div>

      {/* Right section - fixed width matches row layout */}
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

export { InboxRow, InboxListHeader, type InboxRowProps, type InboxListHeaderProps };
