"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Switch/Toggle component
 *
 * Pixel-perfect values from Figma:
 * - Size: 30x20px
 * - Off state: bg #151621, border #393A4B
 * - On state: bg primary (#575BC7)
 * - Thumb: 16x16px circle
 * - Border radius: full (pill shape)
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center",
        // Linear toggle styling - pixel perfect from Figma
        "h-[20px] w-[30px] rounded-full",
        "outline-none transition-colors duration-150",
        // Off state - Figma: bg #151621
        "bg-[#151621] border border-[#393A4B]",
        // On state - Figma: bg primary
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary",
        // Focus state
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full",
          "bg-foreground",
          // Thumb size - fits inside the track
          "size-[16px]",
          "ring-0 transition-transform duration-150",
          // Position: 2px margin from edges
          "data-[state=unchecked]:translate-x-[1px]",
          "data-[state=checked]:translate-x-[11px]",
          // Checked state thumb color
          "data-[state=checked]:bg-white"
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
