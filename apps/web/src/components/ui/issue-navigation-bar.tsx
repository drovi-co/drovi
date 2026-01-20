"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Issue Navigation Bar component
 *
 * Features:
 * - Close button to dismiss issue panel
 * - Up/Down arrows for navigating between issues
 * - Issue counter (e.g., "1 / 10")
 * - Matches Linear's top navigation bar styling
 */

interface NavigationArrowProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  direction: "up" | "down";
}

function NavigationArrow({
  direction,
  className,
  disabled,
  ...props
}: NavigationArrowProps) {
  const Icon = direction === "up" ? ChevronUp : ChevronDown;

  return (
    <button
      aria-label={`Navigate ${direction}`}
      className={cn(
        "inline-flex items-center justify-center",
        "px-[9px] py-[9.5px]",
        "rounded-[4px]",
        "border border-border bg-muted",
        "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
        "transition-colors duration-150",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "cursor-pointer hover:bg-accent",
        className
      )}
      disabled={disabled}
      type="button"
      {...props}
    >
      <Icon className="size-[8px] text-foreground" strokeWidth={2} />
    </button>
  );
}

interface CloseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

function IssueCloseButton({ className, ...props }: CloseButtonProps) {
  return (
    <button
      aria-label="Close issue"
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
      <X className="size-4" />
    </button>
  );
}

interface IssueCounterProps {
  current: number;
  total: number;
  className?: string;
}

function IssueCounter({ current, total, className }: IssueCounterProps) {
  return (
    <div className={cn("flex items-center font-normal text-[13px]", className)}>
      <span className="text-muted-foreground">{current}</span>
      <span className="text-muted-foreground"> / {total}</span>
    </div>
  );
}

interface IssueNavigationBarProps extends React.HTMLAttributes<HTMLDivElement> {
  currentIndex?: number;
  totalCount?: number;
  onClose?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

function IssueNavigationBar({
  className,
  currentIndex = 1,
  totalCount = 1,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  ...props
}: IssueNavigationBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        "px-[15px] py-[7.5px]",
        "bg-muted",
        "border-border border-t border-r border-l",
        "rounded-tl-[6px] rounded-tr-[6px]",
        className
      )}
      data-slot="issue-navigation-bar"
      {...props}
    >
      <IssueCloseButton onClick={onClose} />

      <div className="flex items-center gap-[6px]">
        <NavigationArrow
          direction="up"
          disabled={!hasPrevious}
          onClick={onPrevious}
        />
        <NavigationArrow
          direction="down"
          disabled={!hasNext}
          onClick={onNext}
        />
      </div>

      {totalCount > 1 && (
        <IssueCounter current={currentIndex} total={totalCount} />
      )}
    </div>
  );
}

export { IssueNavigationBar, IssueCloseButton, NavigationArrow, IssueCounter };
