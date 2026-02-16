import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "./utils";

/**
 * Linear-style Select component
 *
 * Pixel-perfect values from Figma:
 * - Trigger: bg #292A35, border #444556, radius 6px, height 30px
 * - Content: bg #1D1E2B, border #393A4B, radius 8px
 * - Item: padding 8px 3px 8px 6px, hover bg #26273B, radius 6px
 * - Text: #D2D3E0, Inter Regular 13px
 * - Shadow: 0px 7px 32px rgba(0,0,0,0.35)
 */
function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex w-full items-center justify-between gap-2",
        "whitespace-nowrap outline-none",
        // Linear input styling - pixel perfect from Figma
        "rounded-[6px] border border-input-border",
        "bg-input py-[2px] pr-[12px] pl-[10px]",
        "text-[13px] text-foreground",
        "transition-colors duration-150",
        // Size variants
        "data-[size=default]:h-[30px] data-[size=sm]:h-[26px]",
        // Placeholder
        "data-[placeholder]:text-muted-foreground",
        // Focus state
        "focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50",
        // Disabled state
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Error state
        "aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/30",
        // Icon styling
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        "[&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-[10px] opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "relative z-50 overflow-hidden",
          // Linear dropdown styling - pixel perfect from Figma
          "min-w-[var(--radix-select-trigger-width)]",
          "rounded-[8px] border border-border",
          "bg-card text-popover-foreground",
          "p-1",
          // Figma shadow: 0px 7px 32px rgba(0,0,0,0.35)
          "shadow-[0px_7px_32px_rgba(0,0,0,0.35)]",
          // Animations
          "data-[state=closed]:animate-out data-[state=open]:animate-in",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className
        )}
        data-slot="select-content"
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn(
        "px-[6px] py-1.5",
        "font-medium text-[11px] uppercase tracking-wider",
        "text-muted-foreground",
        className
      )}
      data-slot="select-label"
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center",
        // Linear item styling - pixel perfect from Figma
        "rounded-[6px] py-[8px] pr-[3px] pl-[6px]",
        "text-[13px] text-foreground outline-none",
        "transition-colors duration-75",
        // Focus/hover state - Figma: #26273B
        "focus:bg-accent focus:text-foreground",
        // Disabled state
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        // Icon styling
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span
        className="ml-auto flex size-4 items-center justify-center"
        data-slot="select-item-indicator"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4 text-muted-foreground" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        "text-muted-foreground",
        className
      )}
      data-slot="select-scroll-up-button"
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        "text-muted-foreground",
        className
      )}
      data-slot="select-scroll-down-button"
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
