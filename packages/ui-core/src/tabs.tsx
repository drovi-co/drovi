"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Tabs component
 *
 * Features:
 * - Underline-style active indicator
 * - 13px font size
 * - Subtle hover states
 * - Compact design
 */
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col gap-3", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex h-8 items-center gap-1",
        "border-border border-b",
        className
      )}
      data-slot="tabs-list"
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5",
        "whitespace-nowrap px-3 pb-px",
        "font-medium text-[13px] text-muted-foreground",
        "outline-none transition-colors duration-150",
        // Hover state
        "hover:text-foreground",
        // Active state - underline
        "relative",
        "data-[state=active]:text-foreground",
        "data-[state=active]:after:absolute",
        "data-[state=active]:after:bottom-0 data-[state=active]:after:left-0",
        "data-[state=active]:after:h-[2px] data-[state=active]:after:w-full",
        "data-[state=active]:after:bg-primary",
        // Focus state
        "focus-visible:text-foreground",
        // Disabled state
        "disabled:pointer-events-none disabled:opacity-50",
        // Icon styling
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
