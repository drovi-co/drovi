"use client";

import {
  Bold,
  CheckSquare,
  Code,
  FileCode,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import type * as React from "react";
import { Separator } from "./separator";
import { Toggle } from "./toggle";
import { cn } from "./utils";

/**
 * Linear-style Text Editor Toolbar component
 *
 * Features:
 * - Formatting buttons: bold, italic, strikethrough, code
 * - List buttons: bullet, numbered, checklist
 * - Block buttons: quote, code block
 * - Grouped with dividers
 * - 28px button size
 * - Floating toolbar style
 */

interface ToolbarButtonProps {
  icon: React.ElementType;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}

function ToolbarButton({
  icon: Icon,
  label,
  isActive,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Toggle
      aria-label={label}
      className={cn(
        "size-7 p-0",
        "data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
      )}
      onPressedChange={() => onClick?.()}
      pressed={isActive}
      size="sm"
    >
      <Icon className="size-4" />
    </Toggle>
  );
}

interface TextEditorToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  activeFormats?: string[];
  onFormatChange?: (format: string) => void;
}

function TextEditorToolbar({
  className,
  activeFormats = [],
  onFormatChange,
  ...props
}: TextEditorToolbarProps) {
  const isActive = (format: string) => activeFormats.includes(format);
  const toggleFormat = (format: string) => onFormatChange?.(format);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1",
        "rounded-[4px] border border-border",
        "bg-popover/95 backdrop-blur-sm",
        "px-2 py-1",
        "shadow-dropdown",
        className
      )}
      data-slot="text-editor-toolbar"
      {...props}
    >
      {/* Text formatting */}
      <ToolbarButton
        icon={Bold}
        isActive={isActive("bold")}
        label="Bold"
        onClick={() => toggleFormat("bold")}
      />
      <ToolbarButton
        icon={Italic}
        isActive={isActive("italic")}
        label="Italic"
        onClick={() => toggleFormat("italic")}
      />
      <ToolbarButton
        icon={Strikethrough}
        isActive={isActive("strikethrough")}
        label="Strikethrough"
        onClick={() => toggleFormat("strikethrough")}
      />
      <ToolbarButton
        icon={Code}
        isActive={isActive("code")}
        label="Inline Code"
        onClick={() => toggleFormat("code")}
      />

      <Separator className="mx-1 h-4" orientation="vertical" />

      {/* Lists */}
      <ToolbarButton
        icon={List}
        isActive={isActive("bulletList")}
        label="Bullet List"
        onClick={() => toggleFormat("bulletList")}
      />
      <ToolbarButton
        icon={ListOrdered}
        isActive={isActive("orderedList")}
        label="Numbered List"
        onClick={() => toggleFormat("orderedList")}
      />
      <ToolbarButton
        icon={CheckSquare}
        isActive={isActive("taskList")}
        label="Checklist"
        onClick={() => toggleFormat("taskList")}
      />

      <Separator className="mx-1 h-4" orientation="vertical" />

      {/* Blocks */}
      <ToolbarButton
        icon={Quote}
        isActive={isActive("blockquote")}
        label="Quote"
        onClick={() => toggleFormat("blockquote")}
      />
      <ToolbarButton
        icon={FileCode}
        isActive={isActive("codeBlock")}
        label="Code Block"
        onClick={() => toggleFormat("codeBlock")}
      />
    </div>
  );
}

export { TextEditorToolbar, ToolbarButton };
