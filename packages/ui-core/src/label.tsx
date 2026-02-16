import * as LabelPrimitive from "@radix-ui/react-label";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Label component
 *
 * Features:
 * - 13px font size
 * - Medium weight
 * - Muted color
 */
function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "flex select-none items-center gap-2",
        "font-medium text-[13px] leading-none",
        "text-foreground",
        // Disabled state (from peer or group)
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        className
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
