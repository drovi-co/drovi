// =============================================================================
// VIRTUALIZED TASK LIST
// =============================================================================
//
// High-performance task list using @tanstack/react-virtual for virtualization.
// Linear-style design matching the smart inbox row layout EXACTLY.
//
// Layout - fixed widths for perfect alignment (matches inbox-row.tsx):
// | Checkbox(28) | Priority(28) | Source(24) | Status(28) | TaskID(120) | Title(flex) | Right(140px) |
//
// Right section (140px fixed):
// - Date | Assignee(28) | Dots(28)
//

import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, Plus, Star } from "lucide-react";
import { useRef } from "react";
import { SourceIcon } from "@/components/inbox/source-icon";
import { AssigneeIcon } from "@/components/ui/assignee-icon";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { type Priority, PriorityIcon } from "@/components/ui/priority-icon";
import { type Status, StatusIcon } from "@/components/ui/status-icon";
import type { SourceType } from "@/lib/source-config";
import { cn } from "@/lib/utils";

import {
  formatDueDate,
  STATUS_CONFIG,
  type TaskData,
  type TaskPriority,
  type TaskSourceType,
  type TaskStatus,
} from "./task-types";

// =============================================================================
// FIXED COLUMN WIDTHS (matching inbox-row.tsx EXACTLY)
// =============================================================================

const COL = {
  checkbox: "w-7", // 28px
  priority: "w-7", // 28px
  source: "w-6", // 24px
  status: "w-7", // 28px
  taskId: "w-[120px]", // 120px - matches sender column in inbox
} as const;

// =============================================================================
// PROPS
// =============================================================================

interface TaskVirtualListProps {
  tasks: TaskData[];
  selectedTaskId: string | null;
  selectedIds: Set<string>;
  onSelectTask: (id: string, selected: boolean) => void;
  onTaskClick: (id: string) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onPriorityChange: (id: string, priority: TaskPriority) => void;
  groupByStatus?: boolean;
  className?: string;
}

// =============================================================================
// ROW HEIGHT
// =============================================================================

const ROW_HEIGHT = 40;
const GROUP_HEADER_HEIGHT = 36;

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function TaskVirtualList({
  tasks,
  selectedTaskId,
  selectedIds,
  onSelectTask,
  onTaskClick,
  onStatusChange,
  onPriorityChange,
  groupByStatus = false,
  className,
}: TaskVirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // If grouping by status, create a flat list with group headers
  const items = groupByStatus
    ? createGroupedItems(tasks)
    : tasks.map((task) => ({ type: "task" as const, data: task }));

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      items[index]?.type === "header" ? GROUP_HEADER_HEIGHT : ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className={cn("h-full overflow-auto", className)} ref={parentRef}>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) {
            return null;
          }

          if (item.type === "header") {
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <GroupHeader count={item.count} status={item.status} />
              </div>
            );
          }

          const task = item.data;
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <VirtualTaskRow
                isActive={selectedTaskId === task.id}
                isSelected={selectedIds.has(task.id)}
                onClick={() => onTaskClick(task.id)}
                onPriorityChange={onPriorityChange}
                onSelect={onSelectTask}
                onStatusChange={onStatusChange}
                task={task}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// GROUP HEADER (Linear-style)
// =============================================================================

interface GroupHeaderProps {
  status: TaskStatus;
  count: number;
}

function GroupHeader({ status, count }: GroupHeaderProps) {
  const config = STATUS_CONFIG[status];
  // Map our status to the StatusIcon status type
  const iconStatus: Status =
    status === "backlog"
      ? "backlog"
      : status === "todo"
        ? "todo"
        : status === "in_progress"
          ? "in_progress"
          : status === "in_review"
            ? "in_progress"
            : status === "done"
              ? "done"
              : "canceled";

  return (
    <div className="flex items-center gap-2 bg-muted px-4 py-1">
      <StatusIcon size="md" status={iconStatus} />
      <span className="font-medium text-[13px] text-foreground">
        {config.label}
      </span>
      <span className="text-[13px] text-muted-foreground">{count}</span>
      <button className="ml-auto rounded p-1.5 transition-colors hover:bg-accent">
        <Plus className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

// =============================================================================
// VIRTUAL TASK ROW (Linear-style)
// =============================================================================

interface VirtualTaskRowProps {
  task: TaskData;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onClick: () => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
  onPriorityChange: (id: string, priority: TaskPriority) => void;
}

// Map task status to status icon status
function mapStatus(status: TaskStatus): Status {
  switch (status) {
    case "backlog":
      return "backlog";
    case "todo":
      return "todo";
    case "in_progress":
      return "in_progress";
    case "in_review":
      return "in_progress";
    case "done":
      return "done";
    case "cancelled":
      return "canceled";
    default:
      return "todo";
  }
}

// Map task priority to priority icon priority
function mapPriority(priority: TaskPriority): Priority {
  switch (priority) {
    case "urgent":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "no_priority":
      return "none";
    default:
      return "none";
  }
}

// Generate task ID from index (like MY-1, MY-2)
function getTaskId(task: TaskData): string {
  // Use first 4 chars of ID as a simple identifier
  return `T-${task.id.slice(0, 4).toUpperCase()}`;
}

// Get initials from name/email
function getInitials(name?: string | null, email?: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email?.slice(0, 2).toUpperCase() ?? "??";
}

// Map task source type to inbox SourceType for SourceIcon
function mapSourceTypeToSourceType(sourceType: TaskSourceType): SourceType {
  switch (sourceType) {
    case "conversation":
      return "email";
    case "commitment":
      return "email";
    case "decision":
      return "email";
    case "manual":
      return "email";
    default:
      return "email";
  }
}

function VirtualTaskRow({
  task,
  isSelected,
  isActive,
  onSelect,
  onClick,
}: VirtualTaskRowProps) {
  const dueInfo = formatDueDate(task.dueDate);
  const iconStatus = mapStatus(task.status);
  const iconPriority = mapPriority(task.priority);
  const sourceType = mapSourceTypeToSourceType(task.sourceType);

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
        !(isSelected || isActive) && "hover:bg-muted"
      )}
      onClick={onClick}
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
          onCheckedChange={(checked) => onSelect(task.id, checked)}
          size="md"
        />
      </div>

      {/* Priority - fixed width */}
      <div
        className={cn(
          COL.priority,
          "flex h-7 shrink-0 items-center justify-center"
        )}
      >
        <PriorityIcon priority={iconPriority} size="sm" />
      </div>

      {/* Source - fixed width (matches inbox exactly) */}
      <div
        className={cn(COL.source, "flex shrink-0 items-center justify-center")}
      >
        <SourceIcon size="sm" sourceType={sourceType} />
      </div>

      {/* Status - fixed width */}
      <div
        className={cn(
          COL.status,
          "flex h-7 shrink-0 items-center justify-center"
        )}
      >
        <StatusIcon size="sm" status={iconStatus} />
      </div>

      {/* Task ID - fixed width (matches sender column in inbox) */}
      <div className={cn(COL.taskId, "shrink-0 px-1")}>
        <span
          className={cn(
            "block truncate text-[13px]",
            "font-medium text-foreground"
          )}
        >
          {getTaskId(task)}
        </span>
      </div>

      {/* Title - flexible width, takes remaining space (matches brief in inbox) */}
      <div className="min-w-0 flex-1 px-2">
        <span className="block truncate font-normal text-[13px] text-muted-foreground">
          {task.title}
        </span>
      </div>

      {/* Right section - fixed width, perfectly aligned (matches inbox exactly) */}
      <div className="flex w-[140px] shrink-0 items-center justify-end">
        {/* Default state: Date + Assignee + Labels - hidden on hover */}
        <div className="flex items-center gap-1.5 group-hover:hidden">
          {/* Date - fixed width, right aligned text */}
          <span
            className={cn(
              "w-14 whitespace-nowrap text-right font-normal text-[12px]",
              dueInfo?.className ?? "text-muted-foreground"
            )}
          >
            {dueInfo?.text ?? ""}
          </span>

          {/* Assignee - fixed width */}
          <div className="flex h-7 w-7 items-center justify-center">
            {task.assignee ? (
              <AssigneeIcon
                email={task.assignee.email}
                imageUrl={task.assignee.image ?? undefined}
                name={task.assignee.name ?? undefined}
                size="xs"
              />
            ) : (
              <AssigneeIcon size="xs" />
            )}
          </div>

          {/* Labels indicator or spacer */}
          <div className="flex w-7 items-center justify-center">
            {task.labels.length > 0 ? (
              <div className="flex items-center gap-0.5">
                {task.labels.slice(0, 2).map((label) => (
                  <span
                    className="h-2 w-2 rounded-full"
                    key={label.id}
                    style={{ backgroundColor: label.color }}
                    title={label.name}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Hover state: Actions - replaces entire section (matches inbox) */}
        <div className="hidden items-center justify-end gap-0.5 group-hover:flex">
          <button
            aria-label="Star"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[4px]",
              "transition-colors duration-100",
              "text-muted-foreground",
              "hover:bg-accent hover:text-foreground"
            )}
            onClick={(e) => {
              e.stopPropagation();
              // Star action - placeholder
            }}
            type="button"
          >
            <Star className="size-4" />
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
              // Archive action - placeholder
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

// =============================================================================
// HELPERS
// =============================================================================

type ListItem =
  | { type: "header"; status: TaskStatus; count: number }
  | { type: "task"; data: TaskData };

function createGroupedItems(tasks: TaskData[]): ListItem[] {
  const statusOrder: TaskStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
    "cancelled",
  ];

  const grouped: Record<TaskStatus, TaskData[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    cancelled: [],
  };

  for (const task of tasks) {
    grouped[task.status].push(task);
  }

  const items: ListItem[] = [];

  for (const status of statusOrder) {
    const statusTasks = grouped[status];
    if (statusTasks.length === 0) {
      continue;
    }

    items.push({ type: "header", status, count: statusTasks.length });
    for (const task of statusTasks) {
      items.push({ type: "task", data: task });
    }
  }

  return items;
}
