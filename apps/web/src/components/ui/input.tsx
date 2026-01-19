import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Input component
 *
 * Features:
 * - Dark background in dark mode (#292A35)
 * - Subtle border (#393A4B)
 * - Purple focus ring (#6C79FF)
 * - 13px font size
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        // Base styles
        "flex h-[30px] w-full min-w-0",
        "rounded-[4px] border border-input-border",
        "bg-input px-2.5 py-1",
        "text-[13px] text-foreground",
        "outline-none transition-colors duration-150",
        // Placeholder
        "placeholder:text-muted-foreground",
        // Selection
        "selection:bg-primary/30 selection:text-foreground",
        // Focus state - Linear style
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Error state
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30",
        // File input styling
        "file:mr-2 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-[12px]",
        className
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

/**
 * Linear-style Textarea component
 */
function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        // Base styles
        "flex min-h-[80px] w-full",
        "rounded-[4px] border border-input-border",
        "bg-input px-2.5 py-2",
        "text-[13px] text-foreground",
        "outline-none transition-colors duration-150",
        "resize-none",
        // Placeholder
        "placeholder:text-muted-foreground",
        // Selection
        "selection:bg-primary/30 selection:text-foreground",
        // Focus state
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        // Disabled state
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        // Error state
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Input, Textarea };
