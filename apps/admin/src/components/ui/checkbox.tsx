"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Checkbox component
 *
 * Pixel-perfect values from Figma:
 * - Size: 14x14px
 * - Unchecked: bg transparent, border #393A4B
 * - Checked: bg #575BC7, border #37466C, check icon #FFFFFF
 * - Border radius: 3px
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer shrink-0",
        // Linear checkbox styling - pixel perfect from Figma
        "size-[14px] rounded-[3px]",
        "border border-border",
        "bg-transparent",
        "outline-none transition-colors duration-150",
        // Focus state
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Checked state
        "data-[state=checked]:border-secondary data-[state=checked]:bg-primary",
        // Error state
        "aria-invalid:border-destructive",
        className
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-white"
        data-slot="checkbox-indicator"
      >
        <CheckIcon className="size-[10px] stroke-[3]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
