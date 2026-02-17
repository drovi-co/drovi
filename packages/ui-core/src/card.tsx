import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Card component
 *
 * Features:
 * - Subtle border (#393A4B in dark mode)
 * - Card background (#252631 in dark mode)
 * - 4px border radius
 * - Subtle shadow
 */
function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: "default" | "dossier" }) {
  return (
    <div
      className={cn(
        "old-money-panel flex flex-col rounded-[8px] border border-border/85",
        "bg-card text-card-foreground backdrop-blur-[1px]",
        variant === "dossier"
          ? "rounded-[6px] border-border bg-card/95 shadow-none ring-1 ring-border/40"
          : "shadow-card",
        className
      )}
      data-slot="card"
      data-variant={variant}
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
      className={cn("font-medium text-[15px] leading-none tracking-[0.01em]", className)}
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
