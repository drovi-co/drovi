"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, Plus, X } from "lucide-react";
import type * as React from "react";
import { Button } from "./button";
import { cn } from "./utils";

/**
 * Linear-style Filter Button component
 *
 * Features:
 * - Multiple variants: default, active, add
 * - 24px height
 * - Pill-shaped with subtle background
 * - Icon + label layout
 */
const filterButtonVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "h-6 px-2",
    "rounded-[4px]",
    "font-medium text-[12px]",
    "transition-colors duration-150",
    "outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
        ],
        active: ["bg-primary/10 text-primary", "hover:bg-primary/20"],
        add: [
          "bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "border border-border border-dashed",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface FilterButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof filterButtonVariants> {
  label: string;
  value?: string;
  icon?: React.ReactNode;
  showDropdown?: boolean;
  onClear?: () => void;
}

function FilterButton({
  className,
  variant,
  label,
  value,
  icon,
  showDropdown = true,
  onClear,
  ...props
}: FilterButtonProps) {
  const hasValue = Boolean(value);
  const effectiveVariant = hasValue ? "active" : variant;

  return (
    <button
      className={cn(
        filterButtonVariants({ variant: effectiveVariant }),
        className
      )}
      data-slot="filter-button"
      type="button"
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{hasValue ? value : label}</span>
      {hasValue && onClear ? (
        <button
          aria-label="Clear filter"
          className="ml-0.5 rounded-sm p-0.5 hover:bg-primary/20"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : showDropdown ? (
        <ChevronDown className="size-3 opacity-60" />
      ) : null}
    </button>
  );
}

/**
 * Add Filter Button - for adding new filters
 */
function AddFilterButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(filterButtonVariants({ variant: "add" }), className)}
      data-slot="add-filter-button"
      type="button"
      {...props}
    >
      <Plus className="size-3" />
      <span>Filter</span>
    </button>
  );
}

/**
 * Filter Bar - container for multiple filter buttons
 */
interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function FilterBar({ className, children, ...props }: FilterBarProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-slot="filter-bar"
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * View Toggle Button - for switching between list/board views
 */
interface ViewToggleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  view: "list" | "board";
  isActive?: boolean;
}

function ViewToggleButton({
  view,
  isActive,
  className,
  ...props
}: ViewToggleButtonProps) {
  return (
    <Button
      className={cn("h-6 px-2", isActive && "bg-muted", className)}
      data-slot="view-toggle-button"
      size="xs"
      variant={isActive ? "secondary" : "ghost"}
      {...props}
    >
      {view === "list" ? (
        <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
          <path
            d="M2 4h10M2 7h10M2 10h10"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
      ) : (
        <svg fill="none" height="14" viewBox="0 0 14 14" width="14">
          <rect fill="currentColor" height="4" rx="1" width="4" x="2" y="2" />
          <rect fill="currentColor" height="4" rx="1" width="4" x="8" y="2" />
          <rect fill="currentColor" height="4" rx="1" width="4" x="2" y="8" />
          <rect fill="currentColor" height="4" rx="1" width="4" x="8" y="8" />
        </svg>
      )}
    </Button>
  );
}

export {
  FilterButton,
  AddFilterButton,
  FilterBar,
  ViewToggleButton,
  filterButtonVariants,
};
