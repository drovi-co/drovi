import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Textarea component
 *
 * Features:
 * - 30px min-height matching Linear inputs
 * - Muted background in dark mode
 * - Subtle border with focus ring
 * - 13px font size
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        // Base styles
        "flex min-h-[80px] w-full",
        "rounded-[6px] border bg-input",
        "border-input-border",
        "px-[10px] py-[8px]",
        "text-[13px] text-foreground leading-[1.5]",
        "placeholder:text-muted-foreground",
        // Resize
        "resize-none",
        // Transitions
        "transition-colors duration-150",
        // Focus states
        "outline-none",
        "focus:border-ring focus:ring-2 focus:ring-ring/20",
        // Hover state
        "hover:border-border-hover",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid state
        "aria-invalid:border-destructive aria-invalid:focus:ring-destructive/20",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
