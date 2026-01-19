"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  Plus,
  Expand,
  Paperclip,
  MoreHorizontal,
  Link2,
  Copy,
  Trash2,
  Edit,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Settings,
  Search,
  Filter,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Icon Button component
 *
 * Features:
 * - 28px default size (matches Figma)
 * - Multiple variants: default, ghost, outline
 * - Icon-only button for toolbar actions
 * - Hover/active states
 */
const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center shrink-0",
    "rounded-[4px]",
    "transition-colors duration-150",
    "cursor-pointer",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-muted text-foreground",
          "hover:bg-muted/80",
          "active:bg-muted/70",
        ],
        ghost: [
          "bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "active:bg-muted/80",
        ],
        outline: [
          "border border-border bg-transparent text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "active:bg-muted/80",
        ],
        primary: [
          "bg-primary text-primary-foreground",
          "hover:bg-primary/90",
          "active:bg-primary/80",
        ],
        destructive: [
          "bg-transparent text-muted-foreground",
          "hover:bg-destructive/10 hover:text-destructive",
          "active:bg-destructive/20",
        ],
      },
      size: {
        xs: "size-5", // 20px
        sm: "size-6", // 24px
        md: "size-7", // 28px
        lg: "size-8", // 32px
        xl: "size-10", // 40px
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
    },
  }
);

interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  icon: React.ReactNode;
  label: string;
}

function IconButton({
  className,
  variant,
  size,
  icon,
  label,
  ...props
}: IconButtonProps) {
  const iconSize =
    size === "xs" ? 12 : size === "sm" ? 14 : size === "lg" ? 18 : size === "xl" ? 20 : 16;

  return (
    <button
      type="button"
      aria-label={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      data-slot="icon-button"
      {...props}
    >
      {React.isValidElement(icon)
        ? React.cloneElement(icon as React.ReactElement<{ style?: React.CSSProperties }>, {
            style: { width: iconSize, height: iconSize },
          })
        : icon}
    </button>
  );
}

/**
 * Pre-configured common icon buttons
 */
function AddButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Plus />} label="Add" {...props} />;
}

function ExpandButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Expand />} label="Expand" {...props} />;
}

function AttachButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Paperclip />} label="Attach" {...props} />;
}

function MoreButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<MoreHorizontal />} label="More options" {...props} />;
}

function LinkButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Link2 />} label="Add link" {...props} />;
}

function CopyButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Copy />} label="Copy" {...props} />;
}

function DeleteButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Trash2 />} label="Delete" variant="destructive" {...props} />;
}

function EditButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Edit />} label="Edit" {...props} />;
}

function ExternalLinkButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<ExternalLink />} label="Open in new tab" {...props} />;
}

function ExpandRightButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<ChevronRight />} label="Expand" {...props} />;
}

function CollapseButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<ChevronDown />} label="Collapse" {...props} />;
}

function SettingsButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Settings />} label="Settings" {...props} />;
}

function SearchButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Search />} label="Search" {...props} />;
}

function FilterButton(props: Omit<IconButtonProps, "icon" | "label">) {
  return <IconButton icon={<Filter />} label="Filter" {...props} />;
}

export {
  IconButton,
  iconButtonVariants,
  AddButton,
  ExpandButton,
  AttachButton,
  MoreButton,
  LinkButton,
  CopyButton,
  DeleteButton,
  EditButton,
  ExternalLinkButton,
  ExpandRightButton,
  CollapseButton,
  SettingsButton,
  SearchButton,
  FilterButton,
};
