import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Premium Button component - Light mode first design
 *
 * Variants:
 * - default (primary): Indigo filled button with subtle shadow
 * - secondary: Stone background with border
 * - tertiary: Border only, no background
 * - destructive: Red for dangerous actions
 * - success: Green for positive actions
 * - ghost: No border, subtle hover
 * - link: Text link style
 *
 * Sizes:
 * - xs: Extra small (24px height)
 * - sm: Small (28px height)
 * - default: Medium (32px height)
 * - lg: Large (40px height)
 */
const buttonVariants = cva(
  [
    // Base styles
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md font-medium text-[13px] leading-none",
    "outline-none transition-all duration-200",
    // Focus state
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // Icon sizing
    "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary - Indigo filled button with subtle glow
        default: [
          "bg-primary text-primary-foreground",
          "shadow-sm hover:shadow-md",
          "hover:bg-primary-hover",
          "active:scale-[0.98]",
        ].join(" "),

        // Secondary - Stone background with border
        secondary: [
          "bg-secondary text-secondary-foreground",
          "border border-border",
          "shadow-xs",
          "hover:bg-secondary-hover hover:border-border-hover",
          "active:scale-[0.98]",
        ].join(" "),

        // Tertiary - Border only, transparent background
        tertiary: [
          "bg-transparent text-muted-foreground",
          "border border-border",
          "hover:border-border-hover hover:text-foreground hover:bg-muted/50",
        ].join(" "),

        // Destructive - Red for dangerous actions
        destructive: [
          "bg-destructive text-destructive-foreground",
          "shadow-sm",
          "hover:bg-destructive-hover hover:shadow-md",
          "focus-visible:ring-destructive/50",
          "active:scale-[0.98]",
        ].join(" "),

        // Success - Green for positive actions
        success: [
          "bg-success text-success-foreground",
          "shadow-sm",
          "hover:opacity-90 hover:shadow-md",
          "focus-visible:ring-success/50",
          "active:scale-[0.98]",
        ].join(" "),

        // Outline - Border with transparent background
        outline: [
          "bg-transparent text-foreground",
          "border border-border",
          "hover:bg-accent hover:text-accent-foreground hover:border-border-hover",
        ].join(" "),

        // Ghost - No border, subtle hover
        ghost: [
          "bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
        ].join(" "),

        // Link - Text link style
        link: [
          "bg-transparent text-primary",
          "underline-offset-4 hover:underline",
          "h-auto p-0",
        ].join(" "),
      },
      size: {
        // Extra small - 24px height
        xs: "h-6 px-2.5 py-1 text-[11px]",

        // Small - 28px height
        sm: "h-7 px-3 py-1.5 text-[12px]",

        // Default/Medium - 32px height
        default: "h-8 px-4 py-2 text-[13px]",

        // Large - 40px height
        lg: "h-10 px-5 py-3 text-[14px]",

        // Icon buttons - Square
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
