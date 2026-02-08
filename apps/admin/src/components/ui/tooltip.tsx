import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Tooltip component
 *
 * Pixel-perfect values from Figma:
 * - Background: gradient #202128 to #1D1E2B
 * - Border: #52526F
 * - Text: #E0E1EC, Inter Regular 11px
 * - Shadow: 0px 2px 4px rgba(0,0,0,0.1)
 * - Border radius: 4px
 */
function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={cn(
          "z-50 w-fit overflow-hidden",
          // Linear tooltip styling - pixel perfect from Figma
          "rounded-[4px]",
          // Tooltip background - uses popover color from design system
          "bg-popover",
          // Figma border: #52526F
          "border border-border",
          "px-2 py-1",
          // Figma shadow: 0px 2px 4px rgba(0,0,0,0.1)
          "shadow-[0px_2px_4px_rgba(0,0,0,0.1)]",
          // Tooltip text - uses popover foreground from design system
          "text-[11px] text-popover-foreground leading-[1.1]",
          // Animations
          "fade-in-0 zoom-in-95 animate-in",
          "data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
