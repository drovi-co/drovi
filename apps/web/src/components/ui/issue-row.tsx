"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { IssueCheckbox } from "./issue-checkbox";
import { PriorityIcon, type Priority } from "./priority-icon";
import { StatusIcon, type Status } from "./status-icon";
import { AssigneeIcon } from "./assignee-icon";
import { LabelDot, type LabelType } from "./label-dot";

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
    "border-b border-border",
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
        true: "ring-2 ring-inset ring-primary/50",
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
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
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
      data-slot="issue-row"
      data-issue-id={id}
      {...props}
    >
      {/* Checkbox */}
      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <IssueCheckbox
          checked={checked}
          onCheckedChange={onCheckedChange}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Priority */}
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onPriorityClick?.();
        }}
        aria-label="Change priority"
      >
        <PriorityIcon priority={priority} size="sm" />
      </button>

      {/* Identifier */}
      <span className="shrink-0 text-[12px] text-muted-foreground font-mono min-w-[70px]">
        {identifier}
      </span>

      {/* Status */}
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onStatusClick?.();
        }}
        aria-label="Change status"
      >
        <StatusIcon status={status} size="sm" />
      </button>

      {/* Title */}
      <span className="flex-1 truncate text-[13px] text-foreground font-medium">
        {title}
      </span>

      {/* Labels (show first 2) */}
      {labels && labels.length > 0 && (
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onLabelClick?.();
          }}
        >
          {labels.slice(0, 2).map((label, idx) => (
            <LabelDot
              key={label.name}
              labelType={label.type}
              color={label.color}
              size="sm"
              label={labels.length === 1 ? label.name : undefined}
              showLabel={labels.length === 1}
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
          type="button"
          className={cn(
            "shrink-0 text-[12px] px-1 rounded hover:bg-muted",
            isOverdue ? "text-destructive" : "text-muted-foreground"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDateClick?.();
          }}
          aria-label="Change due date"
        >
          {formattedDate}
        </button>
      )}

      {/* Assignee */}
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-muted"
        onClick={(e) => {
          e.stopPropagation();
          onAssigneeClick?.();
        }}
        aria-label="Change assignee"
      >
        <AssigneeIcon
          name={assignee?.name}
          email={assignee?.email}
          imageUrl={assignee?.imageUrl}
          size="sm"
          showTooltip
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
      role="list"
      data-slot="issue-list"
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
        "border-b border-border",
        "text-[12px] font-medium text-muted-foreground uppercase tracking-wider",
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
