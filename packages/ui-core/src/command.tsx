import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import * as React from "react";
import { cn } from "./utils";

/**
 * Linear-style Command Bar (⌘K)
 *
 * Features:
 * - Dark popover background (#292A35)
 * - Purple accent for selected items
 * - 13px font size
 * - Keyboard shortcut badges
 */
function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      className={cn(
        "flex h-full w-full flex-col overflow-hidden",
        "rounded-lg bg-popover text-popover-foreground",
        "shadow-dropdown",
        className
      )}
      data-slot="command"
      {...props}
    />
  );
}

function CommandDialog({
  children,
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive> & {
  children: React.ReactNode;
}) {
  return (
    <Command
      className={cn(
        "mx-auto max-w-[640px] rounded-lg border border-border",
        "[&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Command>
  );
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => {
  return (
    <div
      className="flex items-center gap-2 border-border border-b px-3"
      data-slot="command-input-wrapper"
    >
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <CommandPrimitive.Input
        className={cn(
          "flex h-11 w-full bg-transparent py-3",
          "text-[13px] text-foreground placeholder:text-muted-foreground",
          "outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        data-slot="command-input"
        ref={ref}
        {...props}
      />
    </div>
  );
});
CommandInput.displayName = CommandPrimitive.Input.displayName;

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        "max-h-[300px] overflow-y-auto overflow-x-hidden p-1",
        className
      )}
      data-slot="command-list"
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn(
        "py-6 text-center text-[13px] text-muted-foreground",
        className
      )}
      data-slot="command-empty"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "overflow-hidden py-1 text-foreground",
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
        "[&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[11px]",
        "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider",
        "[&_[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      data-slot="command-group"
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      data-slot="command-separator"
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2",
        "rounded-[4px] px-2 py-1.5",
        "text-[13px] text-foreground outline-none",
        "transition-colors duration-75",
        // Selected state
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
        // Disabled state
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        // Icon styling
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "[&_svg]:text-muted-foreground data-[selected=true]:[&_svg]:text-accent-foreground",
        className
      )}
      data-slot="command-item"
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto flex items-center gap-1", className)}
      data-slot="command-shortcut"
      {...props}
    />
  );
}

/**
 * Keyboard shortcut badge for command items
 */
function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center",
        "rounded px-1.5",
        "bg-muted font-medium text-[10px] text-muted-foreground",
        "border border-border",
        className
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Kbd,
};
