"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { X, ChevronUp, ChevronDown } from "lucide-react";
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
      type="button"
      className={cn(
        "inline-flex items-center justify-center",
        "px-[9px] py-[9.5px]",
        "rounded-[4px]",
        "bg-[#292a35] border border-[#313248]",
        "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
        "transition-colors duration-150",
        disabled
          ? "opacity-60 cursor-not-allowed"
          : "hover:bg-[#313248] cursor-pointer",
        className
      )}
      disabled={disabled}
      aria-label={`Navigate ${direction}`}
      {...props}
    >
      <Icon className="size-[8px] text-[#D2D3E0]" strokeWidth={2} />
    </button>
  );
}

interface CloseButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

function IssueCloseButton({ className, ...props }: CloseButtonProps) {
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
      aria-label="Close issue"
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
    <div className={cn("flex items-center text-[13px] font-normal", className)}>
      <span className="text-[#858699]">{current}</span>
      <span className="text-[#4C4F6B]"> / {total}</span>
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
        "bg-[#21232e]",
        "border-t border-l border-r border-[#2C2D3C]",
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
          onClick={onPrevious}
          disabled={!hasPrevious}
        />
        <NavigationArrow
          direction="down"
          onClick={onNext}
          disabled={!hasNext}
        />
      </div>

      {totalCount > 1 && (
        <IssueCounter current={currentIndex} total={totalCount} />
      )}
    </div>
  );
}

export {
  IssueNavigationBar,
  IssueCloseButton,
  NavigationArrow,
  IssueCounter,
};
