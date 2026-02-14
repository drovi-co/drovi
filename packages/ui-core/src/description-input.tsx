"use client";

import { ChevronRight, FileText, Paperclip } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "./utils";

/**
 * Linear-style Description Input component
 *
 * Features:
 * - Rich text area for issue descriptions
 * - Placeholder "Add description..."
 * - Inline attachment display
 * - Attach button on hover
 * - 15px font size with 22px line height
 */

interface AttachmentDisplayProps {
  filename: string;
  filesize: string;
  onClick?: () => void;
}

function AttachmentDisplay({
  filename,
  filesize,
  onClick,
}: AttachmentDisplayProps) {
  return (
    <button
      className={cn(
        "flex w-full items-center justify-between",
        "px-[18px] py-[14px]",
        "rounded-[3px]",
        "bg-[rgba(67,69,99,0.17)]",
        "border border-[rgba(82,82,111,0.25)]",
        "shadow-[0px_2px_4px_0px_rgba(0,0,0,0.1)]",
        "transition-colors duration-150",
        "hover:bg-[rgba(67,69,99,0.25)]"
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center gap-px">
        <div className="flex h-9 items-center pr-4">
          <FileText className="size-4 text-primary" />
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className="font-normal text-[13px] text-foreground">
            {filename}
          </span>
          <span className="text-[11px] text-[rgba(220,216,254,0.56)]">
            {filesize}
          </span>
        </div>
      </div>
      <ChevronRight className="size-2 rotate-90 text-muted-foreground" />
    </button>
  );
}

interface Attachment {
  id: string;
  filename: string;
  filesize: string;
  url?: string;
}

interface DescriptionInputProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  attachments?: Attachment[];
  onAttach?: () => void;
  onAttachmentClick?: (attachment: Attachment) => void;
  readOnly?: boolean;
}

function DescriptionInput({
  className,
  value: controlledValue,
  onValueChange,
  placeholder = "Add description...",
  attachments = [],
  onAttach,
  onAttachmentClick,
  readOnly = false,
  ...props
}: DescriptionInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const value = controlledValue ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;

  const showAttachButton = (isFocused || isHovered) && onAttach;

  return (
    <div
      className={cn("relative", className)}
      data-slot="description-input"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...props}
    >
      {/* Text Area */}
      <div className="pb-3">
        {readOnly ? (
          <p
            className={cn(
              "font-normal text-[15px] text-foreground leading-[22px]",
              "whitespace-pre-wrap"
            )}
          >
            {value || (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </p>
        ) : (
          <textarea
            className={cn(
              "min-h-[80px] w-full resize-none",
              "bg-transparent",
              "font-normal text-[15px] text-foreground leading-[22px]",
              "placeholder:text-muted-foreground",
              "focus:outline-none"
            )}
            onBlur={() => setIsFocused(false)}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            placeholder={placeholder}
            value={value}
          />
        )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 pb-[10px]">
          {attachments.map((attachment) => (
            <AttachmentDisplay
              filename={attachment.filename}
              filesize={attachment.filesize}
              key={attachment.id}
              onClick={() => onAttachmentClick?.(attachment)}
            />
          ))}
        </div>
      )}

      {/* Attach Button (shows on hover/focus) */}
      {showAttachButton && (
        <button
          aria-label="Attach file"
          className={cn(
            "absolute top-0 right-0",
            "rounded-[4px] p-[6px]",
            "text-muted-foreground",
            "transition-colors duration-150",
            "hover:bg-muted hover:text-foreground"
          )}
          onClick={onAttach}
          type="button"
        >
          <Paperclip className="size-4" />
        </button>
      )}
    </div>
  );
}

export { DescriptionInput, AttachmentDisplay };
