"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Avatar component
 *
 * Features:
 * - Multiple sizes (16px, 20px, 24px, 32px)
 * - Optional status indicator
 * - Rounded corners matching Linear design
 */
const avatarVariants = cva(
  "relative flex shrink-0 overflow-hidden rounded-full",
  {
    variants: {
      size: {
        xs: "size-4", // 16px
        sm: "size-5", // 20px
        md: "size-6", // 24px
        lg: "size-8", // 32px
        xl: "size-10", // 40px
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

interface AvatarProps
  extends React.ComponentProps<typeof AvatarPrimitive.Root>,
    VariantProps<typeof avatarVariants> {
  showStatus?: boolean;
  status?: "online" | "offline" | "busy" | "away";
}

function Avatar({
  className,
  size,
  showStatus,
  status = "online",
  children,
  ...props
}: AvatarProps) {
  return (
    <div className="relative inline-flex">
      <AvatarPrimitive.Root
        className={cn(avatarVariants({ size }), className)}
        data-slot="avatar"
        {...props}
      >
        {children}
      </AvatarPrimitive.Root>
      {showStatus && (
        <span
          className={cn(
            "absolute right-0 bottom-0 block rounded-full ring-2 ring-background",
            size === "xs" && "size-1.5",
            size === "sm" && "size-2",
            size === "md" && "size-2.5",
            size === "lg" && "size-3",
            size === "xl" && "size-3.5",
            status === "online" && "bg-green-500",
            status === "offline" && "bg-muted-foreground",
            status === "busy" && "bg-destructive",
            status === "away" && "bg-amber-500"
          )}
          data-slot="avatar-status"
        />
      )}
    </div>
  );
}

function AvatarImage({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      className={cn("aspect-square size-full object-cover", className)}
      data-slot="avatar-image"
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "flex size-full items-center justify-center rounded-full",
        "bg-muted text-muted-foreground",
        "font-medium text-[11px]",
        className
      )}
      data-slot="avatar-fallback"
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback, avatarVariants };
