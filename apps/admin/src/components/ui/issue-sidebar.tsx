"use client";

import { Clipboard, GitBranch, Link2, Plus } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { AssigneeIcon } from "./assignee-icon";
import { LabelDot, type LabelType } from "./label-dot";
import { type Priority, PriorityIcon } from "./priority-icon";
import { type Status, StatusIcon } from "./status-icon";

/**
 * Linear-style Issue Sidebar component
 *
 * Features:
 * - Issue ID header with action buttons (link, copy, branch)
 * - Properties section: Status, Priority, Assignee, Labels
 * - Hover states for selectors
 * - Matches Linear's right panel styling
 */

interface SidebarActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ElementType;
  label: string;
}

function SidebarActionButton({
  icon: Icon,
  label,
  className,
  ...props
}: SidebarActionButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center",
        "rounded-[4px] p-[6px]",
        "text-muted-foreground",
        "transition-colors duration-150",
        "hover:bg-muted hover:text-foreground",
        className
      )}
      type="button"
      {...props}
    >
      <Icon className="size-4" />
    </button>
  );
}

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

function PropertyRow({ label, children, className }: PropertyRowProps) {
  return (
    <div className={cn("flex items-center", className)}>
      <div className="w-[95px] shrink-0 py-[10px]">
        <span className="font-medium text-[13px] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

interface PropertySelectorProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

function PropertySelector({
  children,
  className,
  ...props
}: PropertySelectorProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-[10px]",
        "min-h-0 min-w-0 flex-1",
        "px-2 py-[10.5px]",
        "rounded-[4px]",
        "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
        "transition-colors duration-150",
        "hover:bg-muted/50",
        "text-left",
        className
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

// Status Selector
interface StatusSelectorProps {
  value?: Status;
  onClick?: () => void;
}

function StatusSelector({ value = "todo", onClick }: StatusSelectorProps) {
  const labels: Record<Status, string> = {
    backlog: "Backlog",
    todo: "Todo",
    in_progress: "In Progress",
    done: "Done",
    canceled: "Canceled",
  };

  return (
    <PropertySelector onClick={onClick}>
      <StatusIcon size="sm" status={value} />
      <span className="font-normal text-[12px] text-foreground">
        {labels[value]}
      </span>
    </PropertySelector>
  );
}

// Priority Selector
interface PrioritySelectorProps {
  value?: Priority;
  onClick?: () => void;
}

function PrioritySelector({ value = "none", onClick }: PrioritySelectorProps) {
  const labels: Record<Priority, string> = {
    urgent: "Urgent",
    high: "High",
    medium: "Medium",
    low: "Low",
    none: "No priority",
  };

  return (
    <PropertySelector onClick={onClick}>
      <PriorityIcon priority={value} size="sm" />
      <span className="font-normal text-[12px] text-foreground">
        {labels[value]}
      </span>
    </PropertySelector>
  );
}

// Assignee Selector
interface AssigneeSelectorProps {
  value?: {
    name?: string;
    email?: string;
    imageUrl?: string;
  };
  onClick?: () => void;
}

function AssigneeSelector({ value, onClick }: AssigneeSelectorProps) {
  const isAssigned = Boolean(value?.name || value?.email);

  return (
    <PropertySelector onClick={onClick}>
      <AssigneeIcon
        email={value?.email}
        imageUrl={value?.imageUrl}
        name={value?.name}
        size="xs"
      />
      <span
        className={cn(
          "font-normal text-[12px]",
          isAssigned ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {isAssigned ? value?.name || value?.email : "Unassigned"}
      </span>
    </PropertySelector>
  );
}

// Labels Selector
interface Label {
  type?: LabelType;
  name: string;
  color?: string;
}

interface LabelsSelectorProps {
  value?: Label[];
  onClick?: () => void;
  onAddClick?: () => void;
}

function LabelsSelector({
  value = [],
  onClick,
  onAddClick,
}: LabelsSelectorProps) {
  if (value.length === 0) {
    return (
      <button
        className={cn(
          "flex items-center gap-2",
          "px-2 py-[5px]",
          "rounded-full",
          "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
          "transition-colors duration-150",
          "hover:bg-muted/50"
        )}
        onClick={onAddClick}
        type="button"
      >
        <Plus className="size-2 text-muted-foreground" />
        <span className="font-normal text-[12px] text-muted-foreground">
          Add label
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {value.map((label) => (
        <button
          className={cn(
            "flex items-center gap-1.5",
            "px-2 py-[5px]",
            "rounded-full",
            "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
            "transition-colors duration-150",
            "hover:bg-muted/50"
          )}
          key={label.name}
          onClick={onClick}
          type="button"
        >
          <LabelDot color={label.color} labelType={label.type} size="sm" />
          <span className="font-normal text-[12px] text-foreground">
            {label.name}
          </span>
        </button>
      ))}
    </div>
  );
}

// Main Sidebar Component
interface IssueSidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  issueId: string;
  status?: Status;
  priority?: Priority;
  assignee?: {
    name?: string;
    email?: string;
    imageUrl?: string;
  };
  labels?: Label[];
  onStatusClick?: () => void;
  onPriorityClick?: () => void;
  onAssigneeClick?: () => void;
  onLabelsClick?: () => void;
  onAddLabelClick?: () => void;
  onCopyLink?: () => void;
  onCopyId?: () => void;
  onCreateBranch?: () => void;
}

function IssueSidebar({
  className,
  issueId,
  status = "todo",
  priority = "none",
  assignee,
  labels = [],
  onStatusClick,
  onPriorityClick,
  onAssigneeClick,
  onLabelsClick,
  onAddLabelClick,
  onCopyLink,
  onCopyId,
  onCreateBranch,
  ...props
}: IssueSidebarProps) {
  return (
    <div
      className={cn("flex flex-col bg-card", className)}
      data-slot="issue-sidebar"
      {...props}
    >
      {/* Header with ID and actions */}
      <div className="border-border border-b px-6 py-[14.5px]">
        <div className="flex items-center justify-between">
          <span className="w-[95px] font-medium text-[13px] text-muted-foreground">
            {issueId}
          </span>
          <div className="flex items-center gap-3">
            <SidebarActionButton
              icon={Link2}
              label="Copy link"
              onClick={onCopyLink}
            />
            <SidebarActionButton
              icon={Clipboard}
              label="Copy ID"
              onClick={onCopyId}
            />
            <SidebarActionButton
              icon={GitBranch}
              label="Create branch"
              onClick={onCreateBranch}
            />
          </div>
        </div>
      </div>

      {/* Properties */}
      <div className="px-6 py-1">
        <div className="flex flex-col gap-4">
          <PropertyRow label="Status">
            <StatusSelector onClick={onStatusClick} value={status} />
          </PropertyRow>

          <PropertyRow label="Priority">
            <PrioritySelector onClick={onPriorityClick} value={priority} />
          </PropertyRow>

          <PropertyRow label="Assignee">
            <AssigneeSelector onClick={onAssigneeClick} value={assignee} />
          </PropertyRow>

          <PropertyRow label="Labels">
            <LabelsSelector
              onAddClick={onAddLabelClick}
              onClick={onLabelsClick}
              value={labels}
            />
          </PropertyRow>
        </div>
      </div>
    </div>
  );
}

export {
  IssueSidebar,
  PropertyRow,
  PropertySelector,
  StatusSelector,
  PrioritySelector,
  AssigneeSelector,
  LabelsSelector,
  SidebarActionButton,
};
