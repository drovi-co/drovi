"use client";

import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  FileCode,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";

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

function ToolbarButton({ icon: Icon, label, isActive, onClick }: ToolbarButtonProps) {
  return (
    <Toggle
      size="sm"
      pressed={isActive}
      onPressedChange={() => onClick?.()}
      aria-label={label}
      className={cn(
        "size-7 p-0",
        "data-[state=on]:bg-primary/20 data-[state=on]:text-primary"
      )}
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
        label="Bold"
        isActive={isActive("bold")}
        onClick={() => toggleFormat("bold")}
      />
      <ToolbarButton
        icon={Italic}
        label="Italic"
        isActive={isActive("italic")}
        onClick={() => toggleFormat("italic")}
      />
      <ToolbarButton
        icon={Strikethrough}
        label="Strikethrough"
        isActive={isActive("strikethrough")}
        onClick={() => toggleFormat("strikethrough")}
      />
      <ToolbarButton
        icon={Code}
        label="Inline Code"
        isActive={isActive("code")}
        onClick={() => toggleFormat("code")}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />

      {/* Lists */}
      <ToolbarButton
        icon={List}
        label="Bullet List"
        isActive={isActive("bulletList")}
        onClick={() => toggleFormat("bulletList")}
      />
      <ToolbarButton
        icon={ListOrdered}
        label="Numbered List"
        isActive={isActive("orderedList")}
        onClick={() => toggleFormat("orderedList")}
      />
      <ToolbarButton
        icon={CheckSquare}
        label="Checklist"
        isActive={isActive("taskList")}
        onClick={() => toggleFormat("taskList")}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />

      {/* Blocks */}
      <ToolbarButton
        icon={Quote}
        label="Quote"
        isActive={isActive("blockquote")}
        onClick={() => toggleFormat("blockquote")}
      />
      <ToolbarButton
        icon={FileCode}
        label="Code Block"
        isActive={isActive("codeBlock")}
        onClick={() => toggleFormat("codeBlock")}
      />
    </div>
  );
}

export { TextEditorToolbar, ToolbarButton };
