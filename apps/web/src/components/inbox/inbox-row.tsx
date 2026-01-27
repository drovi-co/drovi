"use client";

import { formatDistanceToNow } from "date-fns";
import { Archive, Star } from "lucide-react";
import type * as React from "react";
import {
  type TaskAssignee,
  TaskAssigneeDropdown,
  type TaskPriority,
  TaskPriorityDropdown,
  type TaskStatus,
  TaskStatusDropdown,
} from "@/components/tasks";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";
import { IntelligenceDots } from "./intelligence-dots";
import { SourceIcon } from "./source-icon";

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

interface InboxRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
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
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  sender: "w-[120px]", // 120px
} as const;

function getPriority(
  urgencyScore: number | null,
  priorityTier: string | null
): Priority {
  // First check if there's a priorityTier from analysis
  if (priorityTier) {
    const tier = priorityTier.toLowerCase();
    if (tier === "urgent") {
      return "urgent";
    }
    if (tier === "high") {
      return "high";
    }
    if (tier === "medium") {
      return "medium";
    }
    if (tier === "low") {
      return "low";
    }
  }

  // Fall back to urgencyScore if available
  if (urgencyScore !== null) {
    if (urgencyScore >= 0.8) {
      return "urgent";
    }
    if (urgencyScore >= 0.6) {
      return "high";
    }
    if (urgencyScore >= 0.4) {
      return "medium";
    }
    if (urgencyScore >= 0.2) {
      return "low";
    }
  }

  return "none";
}

function getStatus(isRead: boolean, isArchived: boolean): Status {
  if (isArchived) {
    return "done";
  }
  if (isRead) {
    return "in_progress";
  }
  return "todo";
}

function getSenderName(
  participants: Array<{ id: string; name?: string; email?: string }>,
  currentUserId?: string,
  sourceType?: SourceType,
  sourceAccountName?: string,
  title?: string
): string {
  // For document-based sources, use title or source name instead of "sender"
  if (sourceType === "notion" || sourceType === "google_docs") {
    // Use the page/document title, truncated
    if (title && title !== "Untitled" && title !== "No subject") {
      return title.length > 20 ? `${title.slice(0, 20)}...` : title;
    }
    // Fallback to source account name
    if (sourceAccountName) {
      return sourceAccountName;
    }
    // Last fallback to source type name
    return sourceType === "notion" ? "Notion" : "Google Docs";
  }

  // For messaging sources (email, slack, whatsapp), show participant names
  const sender = participants.find((p) => p.id !== currentUserId);
  if (!sender) {
    const first = participants[0];
    if (!first) {
      return "Unknown";
    }
    return first.name || first.email?.split("@")[0] || "Unknown";
  }
  return sender.name || sender.email?.split("@")[0] || "Unknown";
}

function formatDate(date: Date | null): string {
  if (!date) {
    return "";
  }
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
  const priority = getPriority(item.urgencyScore, item.priorityTier);
  const status = getStatus(item.isRead, item.isArchived);
  const senderName = getSenderName(
    item.participants,
    currentUserId,
    item.sourceType,
    item.sourceAccountName,
    item.title
  );
  const dateDisplay = formatDate(item.lastMessageAt);
  // Fallback chain for brief text depends on source type
  // For document sources (Notion, Google Docs), prefer snippet since title is shown in "From"
  const getBriefText = () => {
    // AI-generated brief always takes priority
    if (item.brief) {
      return item.brief;
    }
    if (item.suggestedAction) {
      return item.suggestedAction;
    }

    // For document sources, show snippet (page content preview)
    if (item.sourceType === "notion" || item.sourceType === "google_docs") {
      if (item.snippet?.trim()) {
        return item.snippet;
      }
      // If no snippet, fall back to something descriptive
      return item.conversationType === "notion_database"
        ? "Database entry"
        : "Document content";
    }

    // For messaging sources, title then snippet
    return item.title || item.snippet || "No summary available";
  };
  const briefText = getBriefText();
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
        "group flex h-10 items-center",
        "cursor-pointer transition-colors duration-100",
        "border-border border-b",
        !item.isRead && "bg-card",
        isSelected && "bg-accent",
        isActive &&
          "border-l-2 border-l-secondary bg-accent pl-[calc(0.75rem-2px)]",
        !isActive && "pl-3",
        "pr-3",
        !(isSelected || isActive) && "hover:bg-muted",
        className
      )}
      data-slot="inbox-row"
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
          onCheckedChange={(checked) => onSelect?.(item.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width, use task dropdown if task data exists */}
      {hasTaskData ? (
        <div
          className={cn(
            COL.priority,
            "flex h-7 shrink-0 items-center justify-center"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskPriorityDropdown
            align="start"
            compact
            currentPriority={item.task!.priority}
            organizationId={organizationId!}
            taskId={item.task!.id}
          />
        </div>
      ) : (
        <ClickableCell
          className={cn(COL.priority, "h-7 shrink-0")}
          onClick={onPriorityClick}
        >
          <PriorityIcon priority={priority} size="sm" />
        </ClickableCell>
      )}

      {/* Source - fixed width */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        <SourceIcon size="sm" sourceType={item.sourceType} />
      </div>

      {/* Status - fixed width, use task dropdown if task data exists */}
      {hasTaskData ? (
        <div
          className={cn(
            COL.status,
            "flex h-7 shrink-0 items-center justify-center"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <TaskStatusDropdown
            align="start"
            compact
            currentStatus={item.task!.status}
            organizationId={organizationId!}
            taskId={item.task!.id}
          />
        </div>
      ) : (
        <ClickableCell
          className={cn(COL.status, "h-7 shrink-0")}
          onClick={onStatusClick}
        >
          <StatusIcon size="sm" status={status} />
        </ClickableCell>
      )}

      {/* Sender - fixed width */}
      <div className={cn(COL.sender, "shrink-0 px-1")}>
        <span
          className={cn(
            "block truncate text-[13px]",
            item.isRead
              ? "font-normal text-muted-foreground"
              : "font-medium text-foreground"
          )}
        >
          {senderName}
        </span>
      </div>

      {/* Brief - flexible width, takes remaining space */}
      <div className="min-w-0 flex-1 px-2">
        <span className="block truncate font-normal text-[13px] text-muted-foreground">
          {briefText}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Date + Assignee + Dots - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date - fixed width, right aligned text */}
          <span className="w-14 whitespace-nowrap text-right font-normal text-[12px] text-muted-foreground">
            {dateDisplay}
          </span>

          {/* Assignee */}
          <div className="flex h-7 w-7 items-center justify-center">
            {hasTaskData ? (
              <div onClick={(e) => e.stopPropagation()}>
                <TaskAssigneeDropdown
                  align="end"
                  compact
                  currentAssignee={item.task!.assignee}
                  organizationId={organizationId!}
                  taskId={item.task!.id}
                />
              </div>
            ) : item.assignee ? (
              <AssigneeIcon
                email={item.assignee.email}
                imageUrl={item.assignee.imageUrl}
                name={item.assignee.name}
                size="xs"
              />
            ) : (
              <AssigneeIcon size="xs" />
            )}
          </div>

          {/* Dots or Star */}
          <div className="flex w-7 items-center justify-center">
            {item.isStarred ? (
              <Star className="size-4 fill-yellow-400 text-yellow-400" />
            ) : (
              <IntelligenceDots
                commitmentCount={item.commitmentCount}
                decisionCount={item.decisionCount}
                hasCommitments={item.hasCommitments}
                hasDecisions={item.hasDecisions}
                hasOpenLoops={item.hasOpenLoops ?? false}
                openLoopCount={item.openLoopCount ?? undefined}
                size="sm"
              />
            )}
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          <button
            aria-label={item.isStarred ? "Unstar" : "Star"}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              item.isStarred ? "text-yellow-400" : "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onStar?.(!item.isStarred);
            }}
            type="button"
          >
            <Star
              className={cn("size-4", item.isStarred && "fill-yellow-400")}
            />
          </button>
          <button
            aria-label="Archive"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onArchive?.();
            }}
            type="button"
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
        "flex h-8 items-center px-3",
        "border-border border-b bg-background",
        "font-medium text-[11px] text-muted-foreground uppercase tracking-wider",
        className
      )}
      data-slot="inbox-list-header"
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

      {/* Sender */}
      <div className={cn(COL.sender, "shrink-0 px-1")}>From</div>

      {/* Brief */}
      <div className="flex-1 px-2">Summary</div>

      {/* Right section - fixed width matches row layout */}
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
  InboxRow,
  InboxListHeader,
  type InboxRowProps,
  type InboxListHeaderProps,
};
