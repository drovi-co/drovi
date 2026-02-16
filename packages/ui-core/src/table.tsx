import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Table component
 *
 * Features:
 * - 13px font size
 * - Subtle borders
 * - Hover state on rows
 * - 44px row height matching Linear list items
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      className="relative w-full overflow-x-auto"
      data-slot="table-container"
    >
      <table
        className={cn("w-full caption-bottom", "text-[13px]", className)}
        data-slot="table"
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("border-border border-b", "[&_tr]:border-b-0", className)}
      data-slot="table-header"
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      data-slot="table-body"
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-border border-t bg-muted/50",
        "font-medium",
        "[&>tr]:last:border-b-0",
        className
      )}
      data-slot="table-footer"
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "h-[44px] border-border border-b",
        "transition-colors duration-150",
        "hover:bg-muted/50",
        "data-[state=selected]:bg-muted",
        className
      )}
      data-slot="table-row"
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-[36px] px-3",
        "text-left align-middle",
        "font-medium text-muted-foreground",
        "text-[12px] uppercase tracking-wider",
        "[&:has([role=checkbox])]:pr-0",
        "[&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "px-3 align-middle",
        "text-foreground",
        "[&:has([role=checkbox])]:pr-0",
        "[&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-4 text-[12px] text-muted-foreground", className)}
      data-slot="table-caption"
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
