import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Button component
 *
 * Variants:
 * - default (primary): Purple background, white text
 * - secondary: Dark grey background with border
 * - tertiary: Border only, no background
 * - destructive: Red for dangerous actions
 * - ghost: No background, subtle hover
 * - link: Text link style
 *
 * Sizes match Linear's button scale:
 * - xs: Extra small (24px height)
 * - sm: Small (28px height)
 * - default: Medium (32px height)
 * - lg: Large (40px height)
 */
const buttonVariants = cva(
  [
    // Base styles
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[4px] font-medium text-[13px] leading-none",
    "outline-none transition-colors duration-150",
    // Focus state - Linear uses ring
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-60",
    // Icon sizing
    "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary - Purple filled button
        default: [
          "bg-primary text-primary-foreground",
          "border border-primary",
          "shadow-[0px_1px_2px_rgba(0,0,0,0.09)]",
          "hover:bg-primary-hover",
        ].join(" "),

        // Secondary - Dark grey with border
        secondary: [
          "bg-secondary text-secondary-foreground",
          "border border-border",
          "shadow-[0px_1px_1px_rgba(0,0,0,0.15)]",
          "hover:border-border-hover hover:bg-secondary-hover",
        ].join(" "),

        // Tertiary - Border only
        tertiary: [
          "bg-transparent text-muted-foreground",
          "border border-border",
          "shadow-[0px_1px_2px_rgba(0,0,0,0.09)]",
          "hover:border-border-hover hover:text-foreground",
        ].join(" "),

        // Destructive - Red for dangerous actions
        destructive: [
          "bg-destructive text-destructive-foreground",
          "border border-destructive",
          "shadow-[0px_1px_2px_rgba(0,0,0,0.09)]",
          "hover:bg-destructive-hover",
          "focus-visible:ring-destructive/50",
        ].join(" "),

        // Outline - Similar to tertiary but different hover
        outline: [
          "bg-transparent text-foreground",
          "border border-border",
          "hover:bg-accent hover:text-accent-foreground",
        ].join(" "),

        // Ghost - No border, subtle hover
        ghost: [
          "bg-transparent text-muted-foreground",
          "hover:bg-accent hover:text-accent-foreground",
        ].join(" "),

        // Link - Text link style
        link: [
          "bg-transparent text-primary",
          "underline-offset-4 hover:underline",
          "h-auto p-0",
        ].join(" "),

        // Banner - Special style for promotional buttons
        banner: [
          "bg-transparent text-primary",
          "shadow-[0px_1px_1px_rgba(0,0,0,0.15)]",
          "hover:text-primary-hover",
        ].join(" "),
      },
      size: {
        // Extra small - 24px height
        xs: "h-6 px-3 py-1 font-medium text-[12px]",

        // Small - 28px height
        sm: "h-7 px-3.5 py-1.5 font-medium text-[12px]",

        // Default/Medium - 32px height
        default: "h-8 px-3.5 py-2 text-[13px]",

        // Large - 40px height
        lg: "h-10 px-4 py-3 text-[15px]",

        // Icon buttons
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
        "icon-lg": "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      data-size={size}
      data-slot="button"
      data-variant={variant}
      {...props}
    />
  );
}

export { Button, buttonVariants };
