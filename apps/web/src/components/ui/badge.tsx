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
    "rounded-md border px-2 py-0.5",
    "font-medium text-[11px]",
    "transition-colors duration-150",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        // Default - Neutral gray (Vercel style)
        default: ["border-border bg-secondary text-foreground"].join(" "),

        // Secondary - Subtle grey
        secondary: [
          "border-border bg-secondary text-muted-foreground",
        ].join(" "),

        // Destructive - Vercel red
        destructive: [
          "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c] dark:border-[#7f1d1d] dark:bg-[#450a0a] dark:text-[#fca5a5]",
        ].join(" "),

        // Outline - Border only
        outline: ["border-border bg-transparent text-muted-foreground"].join(
          " "
        ),

        // Success - Vercel teal/green
        success: [
          "border-[#a7f3d0] bg-[#ecfdf5] text-[#047857] dark:border-[#064e3b] dark:bg-[#022c22] dark:text-[#6ee7b7]",
        ].join(" "),

        // Warning - Vercel amber
        warning: [
          "border-[#fde68a] bg-[#fffbeb] text-[#b45309] dark:border-[#78350f] dark:bg-[#451a03] dark:text-[#fcd34d]",
        ].join(" "),

        // Info - Vercel blue
        info: [
          "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] dark:border-[#1e3a8a] dark:bg-[#172554] dark:text-[#93c5fd]",
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
