"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { AssigneeIcon } from "./assignee-icon";
import { IssueCheckbox } from "./issue-checkbox";
import { LabelDot, type LabelType } from "./label-dot";
import { type Priority, PriorityIcon } from "./priority-icon";
import { type Status, StatusIcon } from "./status-icon";
import { cn } from "./utils";

/**
 * Linear-style Issue Row component
 *
 * Features:
 * - 44px row height (matches Figma)
 * - Checkbox, priority, ID, status, title, labels, date, assignee layout
 * - Hover and selected states
 * - Keyboard navigation support
 */
const issueRowVariants = cva(
  [
    "flex items-center gap-3",
    "h-[44px] px-4",
    "border-border border-b",
    "transition-colors duration-150",
    "cursor-pointer",
    "group",
  ],
  {
    variants: {
      selected: {
        true: "bg-muted",
        false: "hover:bg-muted/50",
      },
      focused: {
        true: "ring-2 ring-primary/50 ring-inset",
        false: "",
      },
    },
    defaultVariants: {
      selected: false,
      focused: false,
    },
  }
);

interface IssueLabel {
  type?: LabelType;
  name: string;
  color?: string;
}

interface IssueAssignee {
  name?: string;
  email?: string;
  imageUrl?: string;
}

interface IssueRowProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof issueRowVariants> {
  // Issue data
  id: string;
  identifier: string; // e.g., "LIN-123"
  title: string;
  status?: Status;
  priority?: Priority;
  labels?: IssueLabel[];
  dueDate?: Date | string;
  assignee?: IssueAssignee;
  checked?: boolean;

  // Callbacks
  onCheckedChange?: (checked: boolean) => void;
  onStatusClick?: () => void;
  onPriorityClick?: () => void;
  onAssigneeClick?: () => void;
  onLabelClick?: () => void;
  onDateClick?: () => void;
}

function formatDueDate(date: Date | string | undefined): string | null {
  if (!date) {
    return null;
  }
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  if (days === -1) {
    return "Yesterday";
  }
  if (days > 0 && days <= 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function IssueRow({
  className,
  selected,
  focused,
  id,
  identifier,
  title,
  status = "todo",
  priority = "none",
  labels,
  dueDate,
  assignee,
  checked = false,
  onCheckedChange,
  onStatusClick,
  onPriorityClick,
  onAssigneeClick,
  onLabelClick,
  onDateClick,
  ...props
}: IssueRowProps) {
  const formattedDate = formatDueDate(dueDate);
  const isOverdue = dueDate && new Date(dueDate) < new Date();

  return (
    <div
      className={cn(issueRowVariants({ selected, focused }), className)}
      data-issue-id={id}
      data-slot="issue-row"
      {...props}
    >
      {/* Checkbox */}
      <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
        <IssueCheckbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Priority */}
      <button
        aria-label="Change priority"
        className="shrink-0 rounded p-1 hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onPriorityClick?.();
        }}
        type="button"
      >
        <PriorityIcon priority={priority} size="sm" />
      </button>

      {/* Identifier */}
      <span className="min-w-[70px] shrink-0 font-mono text-[12px] text-muted-foreground">
        {identifier}
      </span>

      {/* Status */}
      <button
        aria-label="Change status"
        className="shrink-0 rounded p-1 hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onStatusClick?.();
        }}
        type="button"
      >
        <StatusIcon size="sm" status={status} />
      </button>

      {/* Title */}
      <span className="flex-1 truncate font-medium text-[13px] text-foreground">
        {title}
      </span>

      {/* Labels (show first 2) */}
      {labels && labels.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-1"
          onClick={(e) => {
            e.stopPropagation();
            onLabelClick?.();
          }}
        >
          {labels.slice(0, 2).map((label, _idx) => (
            <LabelDot
              color={label.color}
              key={label.name}
              label={labels.length === 1 ? label.name : undefined}
              labelType={label.type}
              showLabel={labels.length === 1}
              size="sm"
            />
          ))}
          {labels.length > 2 && (
            <span className="text-[11px] text-muted-foreground">
              +{labels.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Due Date */}
      {formattedDate && (
        <button
          aria-label="Change due date"
          className={cn(
            "shrink-0 rounded px-1 text-[12px] hover:bg-muted",
            isOverdue ? "text-destructive" : "text-muted-foreground"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDateClick?.();
          }}
          type="button"
        >
          {formattedDate}
        </button>
      )}

      {/* Assignee */}
      <button
        aria-label="Change assignee"
        className="shrink-0 rounded p-1 hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onAssigneeClick?.();
        }}
        type="button"
      >
        <AssigneeIcon
          email={assignee?.email}
          imageUrl={assignee?.imageUrl}
          name={assignee?.name}
          showTooltip
          size="sm"
        />
      </button>
    </div>
  );
}

/**
 * Issue List - container for issue rows
 */
interface IssueListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function IssueList({ className, children, ...props }: IssueListProps) {
  return (
    <div
      className={cn("flex flex-col", className)}
      data-slot="issue-list"
      role="list"
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Issue List Header - column headers for the list
 */
interface IssueListHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  showCheckbox?: boolean;
}

function IssueListHeader({
  className,
  showCheckbox = true,
  ...props
}: IssueListHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        "h-[36px] px-4",
        "border-border border-b",
        "font-medium text-[12px] text-muted-foreground uppercase tracking-wider",
        className
      )}
      data-slot="issue-list-header"
      {...props}
    >
      {showCheckbox && <div className="w-3.5" />}
      <div className="w-3.5" /> {/* Priority */}
      <div className="min-w-[70px]">ID</div>
      <div className="w-3.5" /> {/* Status */}
      <div className="flex-1">Title</div>
      <div className="w-16">Labels</div>
      <div className="w-16">Due</div>
      <div className="w-5">Assignee</div>
    </div>
  );
}

export { IssueRow, IssueList, IssueListHeader, issueRowVariants };
