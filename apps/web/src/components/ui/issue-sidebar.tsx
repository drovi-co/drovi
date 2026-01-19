"use client";

import { Link2, Clipboard, GitBranch, Plus } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { StatusIcon, type Status } from "./status-icon";
import { PriorityIcon, type Priority } from "./priority-icon";
import { AssigneeIcon } from "./assignee-icon";
import { LabelDot, type LabelType } from "./label-dot";

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
      type="button"
      className={cn(
        "inline-flex items-center justify-center",
        "p-[6px] rounded-[4px]",
        "text-[#858699]",
        "transition-colors duration-150",
        "hover:bg-muted hover:text-foreground",
        className
      )}
      aria-label={label}
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
      <div className="w-[95px] py-[10px] shrink-0">
        <span className="text-[13px] font-medium text-[#858699]">{label}</span>
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
      type="button"
      className={cn(
        "flex items-center gap-[10px]",
        "flex-1 min-w-0 min-h-0",
        "px-2 py-[10.5px]",
        "rounded-[4px]",
        "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
        "transition-colors duration-150",
        "hover:bg-muted/50",
        "text-left",
        className
      )}
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
      <StatusIcon status={value} size="sm" />
      <span className="text-[12px] font-normal text-[#EEEFFC]">
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
      <span className="text-[12px] font-normal text-[#EEEFFC]">
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
        name={value?.name}
        email={value?.email}
        imageUrl={value?.imageUrl}
        size="xs"
      />
      <span
        className={cn(
          "text-[12px] font-normal",
          isAssigned ? "text-[#EEEFFC]" : "text-[#858699]"
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

function LabelsSelector({ value = [], onClick, onAddClick }: LabelsSelectorProps) {
  if (value.length === 0) {
    return (
      <button
        type="button"
        onClick={onAddClick}
        className={cn(
          "flex items-center gap-2",
          "px-2 py-[5px]",
          "rounded-full",
          "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
          "transition-colors duration-150",
          "hover:bg-muted/50"
        )}
      >
        <Plus className="size-2 text-[#858699]" />
        <span className="text-[12px] font-normal text-[#858699]">Add label</span>
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {value.map((label) => (
        <button
          key={label.name}
          type="button"
          onClick={onClick}
          className={cn(
            "flex items-center gap-1.5",
            "px-2 py-[5px]",
            "rounded-full",
            "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
            "transition-colors duration-150",
            "hover:bg-muted/50"
          )}
        >
          <LabelDot labelType={label.type} color={label.color} size="sm" />
          <span className="text-[12px] font-normal text-[#EEEFFC]">
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
      className={cn("flex flex-col bg-[#1D1E2B]", className)}
      data-slot="issue-sidebar"
      {...props}
    >
      {/* Header with ID and actions */}
      <div className="px-6 py-[14.5px] border-b border-[#292B41]">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-[#858699] w-[95px]">
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
            <StatusSelector value={status} onClick={onStatusClick} />
          </PropertyRow>

          <PropertyRow label="Priority">
            <PrioritySelector value={priority} onClick={onPriorityClick} />
          </PropertyRow>

          <PropertyRow label="Assignee">
            <AssigneeSelector value={assignee} onClick={onAssigneeClick} />
          </PropertyRow>

          <PropertyRow label="Labels">
            <LabelsSelector
              value={labels}
              onClick={onLabelsClick}
              onAddClick={onAddLabelClick}
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
