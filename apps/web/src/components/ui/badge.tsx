import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Badge component
 *
 * Features:
 * - Subtle, small badges
 * - 11px font size
 * - Pill shape (rounded-full)
 * - Color-coded variants
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center justify-center gap-1",
    "overflow-hidden whitespace-nowrap",
    "rounded-full border px-2 py-0.5",
    "font-medium text-[11px]",
    "transition-colors duration-150",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        // Default - Primary purple
        default: [
          "border-primary/30 bg-primary/10 text-primary",
        ].join(" "),

        // Secondary - Subtle grey
        secondary: [
          "border-border bg-secondary text-secondary-foreground",
        ].join(" "),

        // Destructive - Red for warnings/errors
        destructive: [
          "border-destructive/30 bg-destructive/10 text-destructive",
        ].join(" "),

        // Outline - Border only
        outline: [
          "border-border bg-transparent text-muted-foreground",
        ].join(" "),

        // Success - Green
        success: [
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
        ].join(" "),

        // Warning - Amber
        warning: [
          "border-amber-500/30 bg-amber-500/10 text-amber-500",
        ].join(" "),

        // Info - Blue
        info: [
          "border-blue-500/30 bg-blue-500/10 text-blue-500",
        ].join(" "),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      className={cn(badgeVariants({ variant }), className)}
      data-slot="badge"
      {...props}
    />
  );
}

export { Badge, badgeVariants };
