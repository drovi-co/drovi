import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Premium Card component - Light mode first design
 *
 * Features:
 * - Subtle border with 50% opacity for softness
 * - Pure white card background
 * - 8px border radius for modern look
 * - Soft shadow that elevates without being heavy
 * - Smooth hover transition for interactive cards
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg",
        "border border-border/50",
        "bg-card text-card-foreground",
        "shadow-card",
        "transition-shadow duration-200",
        className
      )}
      data-slot="card"
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 p-4",
        "[.border-b]:border-border [.border-b]:border-b",
        className
      )}
      data-slot="card-header"
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-medium text-[15px] leading-none", className)}
      data-slot="card-title"
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn("text-[13px] text-muted-foreground", className)}
      data-slot="card-description"
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("ml-auto", className)}
      data-slot="card-action"
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("p-4 pt-0", className)}
      data-slot="card-content"
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 p-4 pt-0",
        "[.border-t]:border-border [.border-t]:border-t [.border-t]:pt-4",
        className
      )}
      data-slot="card-footer"
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
