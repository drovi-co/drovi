"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Calendar, ChevronDown, MoreHorizontal, Tag, User } from "lucide-react";
import type * as React from "react";
import { AssigneeIcon } from "./assignee-icon";
import { LabelDot, type LabelType } from "./label-dot";
import { type Priority, PriorityIcon, priorityConfig } from "./priority-icon";
import { type Status, StatusIcon, statusConfig } from "./status-icon";
import { cn } from "./utils";

/**
 * Linear-style Issue Button component
 *
 * Features:
 * - 24px height (matches Figma)
 * - Icon + label layout
 * - Used for status, priority, assignee, label, date selection
 * - Hover states and active indicators
 */
const issueButtonVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "h-6 px-2",
    "rounded-[4px]",
    "font-medium text-[12px]",
    "transition-colors duration-150",
    "cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-muted-foreground/30 text-foreground",
          "hover:bg-muted-foreground/40",
        ],
        ghost: [
          "bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
        ],
        active: ["bg-primary/10 text-primary", "hover:bg-primary/20"],
      },
      hasValue: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "ghost",
        hasValue: false,
        className: "text-muted-foreground/60",
      },
    ],
    defaultVariants: {
      variant: "default",
      hasValue: false,
    },
  }
);

/**
 * Status Button - for selecting issue status
 */
interface StatusButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    VariantProps<typeof issueButtonVariants> {
  value?: Status;
  showDropdown?: boolean;
}

function StatusButton({
  className,
  variant = "default",
  value,
  showDropdown = true,
  ...props
}: StatusButtonProps) {
  const hasValue = Boolean(value);
  const label = value ? statusConfig[value].label : "Status";

  return (
    <button
      className={cn(issueButtonVariants({ variant, hasValue }), className)}
      data-slot="status-button"
      type="button"
      {...props}
    >
      <StatusIcon size="sm" status={value || "todo"} />
      <span className="truncate">{label}</span>
      {showDropdown && <ChevronDown className="ml-auto size-3 opacity-60" />}
    </button>
  );
}

/**
 * Priority Button - for selecting issue priority
 */
interface PriorityButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    VariantProps<typeof issueButtonVariants> {
  value?: Priority;
  showDropdown?: boolean;
}

function PriorityButton({
  className,
  variant = "default",
  value,
  showDropdown = true,
  ...props
}: PriorityButtonProps) {
  const hasValue = Boolean(value && value !== "none");
  const label = value ? priorityConfig[value].label : "Priority";

  return (
    <button
      className={cn(issueButtonVariants({ variant, hasValue }), className)}
      data-slot="priority-button"
      type="button"
      {...props}
    >
      <PriorityIcon priority={value || "none"} size="sm" />
      <span className="truncate">{label}</span>
      {showDropdown && <ChevronDown className="ml-auto size-3 opacity-60" />}
    </button>
  );
}

/**
 * Assignee Button - for selecting issue assignee
 */
interface AssigneeButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    VariantProps<typeof issueButtonVariants> {
  value?: {
    name?: string;
    email?: string;
    imageUrl?: string;
  };
  showDropdown?: boolean;
}

function AssigneeButton({
  className,
  variant = "default",
  value,
  showDropdown = true,
  ...props
}: AssigneeButtonProps) {
  const hasValue = Boolean(value?.name || value?.email);
  const label = value?.name || value?.email || "Assignee";

  return (
    <button
      className={cn(issueButtonVariants({ variant, hasValue }), className)}
      data-slot="assignee-button"
      type="button"
      {...props}
    >
      {hasValue ? (
        <AssigneeIcon
          email={value?.email}
          imageUrl={value?.imageUrl}
          name={value?.name}
          size="xs"
        />
      ) : (
        <User className="size-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[100px] truncate">{label}</span>
      {showDropdown && <ChevronDown className="ml-auto size-3 opacity-60" />}
    </button>
  );
}

/**
 * Label Button - for selecting issue labels
 */
interface LabelButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    VariantProps<typeof issueButtonVariants> {
  value?: {
    type?: LabelType;
    name: string;
    color?: string;
  }[];
  showDropdown?: boolean;
}

function LabelButton({
  className,
  variant = "default",
  value,
  showDropdown = true,
  ...props
}: LabelButtonProps) {
  const hasValue = Boolean(value && value.length > 0);
  const firstLabel = value?.[0];
  const label = hasValue
    ? value?.length === 1
      ? firstLabel?.name
      : `${value?.length} labels`
    : "Label";

  return (
    <button
      className={cn(issueButtonVariants({ variant, hasValue }), className)}
      data-slot="label-button"
      type="button"
      {...props}
    >
      {hasValue && firstLabel ? (
        <LabelDot
          color={firstLabel.color}
          labelType={firstLabel.type}
          size="sm"
        />
      ) : (
        <Tag className="size-3.5 text-muted-foreground" />
      )}
      <span className="max-w-[100px] truncate">{label}</span>
      {showDropdown && <ChevronDown className="ml-auto size-3 opacity-60" />}
    </button>
  );
}

/**
 * Date Button - for selecting due date
 */
interface DateButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">,
    VariantProps<typeof issueButtonVariants> {
  value?: Date | string;
  showDropdown?: boolean;
}

function formatDate(date: Date | string): string {
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

function DateButton({
  className,
  variant = "default",
  value,
  showDropdown = true,
  ...props
}: DateButtonProps) {
  const hasValue = Boolean(value);
  const label = hasValue ? formatDate(value!) : "Due date";

  // Check if overdue
  const isOverdue = hasValue && new Date(value!) < new Date();

  return (
    <button
      className={cn(
        issueButtonVariants({ variant, hasValue }),
        isOverdue && "text-destructive",
        className
      )}
      data-slot="date-button"
      type="button"
      {...props}
    >
      <Calendar
        className={cn(
          "size-3.5",
          isOverdue ? "text-destructive" : "text-muted-foreground"
        )}
      />
      <span className="truncate">{label}</span>
      {showDropdown && <ChevronDown className="ml-auto size-3 opacity-60" />}
    </button>
  );
}

/**
 * More Button - for additional actions
 */
function MoreOptionsButton({
  className,
  variant = "ghost",
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> &
  VariantProps<typeof issueButtonVariants>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center",
        "size-6 rounded-[4px]",
        "text-muted-foreground",
        "transition-colors duration-150",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      data-slot="more-options-button"
      type="button"
      {...props}
    >
      <MoreHorizontal className="size-4" />
    </button>
  );
}

export {
  issueButtonVariants,
  StatusButton,
  PriorityButton,
  AssigneeButton,
  LabelButton,
  DateButton,
  MoreOptionsButton,
};
