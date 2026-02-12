"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Check } from "lucide-react";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Issue Checkbox component
 *
 * Features:
 * - 14px default size (matches Figma)
 * - Status-based visual states: unchecked, partial, checked
 * - Rounded-[3px] border as per Linear spec
 * - Color: #4C4F6B border, fills on check
 */
const issueCheckboxVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center",
    "rounded-[3px] border",
    "transition-colors duration-150",
    "cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  ],
  {
    variants: {
      size: {
        sm: "size-3", // 12px
        md: "size-3.5", // 14px
        lg: "size-4", // 16px
      },
      state: {
        unchecked: "border-muted-foreground bg-transparent",
        partial: "border-secondary bg-secondary/20",
        checked: "border-secondary bg-secondary",
      },
    },
    defaultVariants: {
      size: "md",
      state: "unchecked",
    },
  }
);

type CheckboxState = "unchecked" | "partial" | "checked";

interface IssueCheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">,
    VariantProps<typeof issueCheckboxVariants> {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
}

function IssueCheckbox({
  className,
  size,
  checked = false,
  onCheckedChange,
  ...props
}: IssueCheckboxProps) {
  const state: CheckboxState =
    checked === "indeterminate" ? "partial" : checked ? "checked" : "unchecked";

  const iconSize = size === "sm" ? 8 : size === "lg" ? 12 : 10;

  const handleClick = () => {
    if (checked === "indeterminate") {
      onCheckedChange?.(true);
    } else {
      onCheckedChange?.(!checked);
    }
  };

  return (
    <button
      aria-checked={checked === "indeterminate" ? "mixed" : checked}
      className={cn(issueCheckboxVariants({ size, state }), className)}
      data-slot="issue-checkbox"
      onClick={handleClick}
      role="checkbox"
      type="button"
      {...props}
    >
      {state === "checked" && (
        <Check
          className="text-white"
          strokeWidth={2.5}
          style={{ width: iconSize, height: iconSize }}
        />
      )}
      {state === "partial" && (
        <div
          className="rounded-[1px] bg-secondary"
          style={{ width: iconSize - 2, height: 2 }}
        />
      )}
    </button>
  );
}

export { IssueCheckbox, issueCheckboxVariants };
