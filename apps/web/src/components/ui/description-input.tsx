"use client";

import { Paperclip, FileText, ChevronRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";

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
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between w-full",
        "px-[18px] py-[14px]",
        "rounded-[3px]",
        "bg-[rgba(67,69,99,0.17)]",
        "border border-[rgba(82,82,111,0.25)]",
        "shadow-[0px_2px_4px_0px_rgba(0,0,0,0.1)]",
        "transition-colors duration-150",
        "hover:bg-[rgba(67,69,99,0.25)]"
      )}
    >
      <div className="flex items-center gap-px">
        <div className="flex items-center h-9 pr-4">
          <FileText className="size-4 text-[#DCD8FE]" />
        </div>
        <div className="flex flex-col items-start gap-2">
          <span className="text-[13px] font-normal text-[#EEEFFC]">
            {filename}
          </span>
          <span className="text-[11px] text-[rgba(220,216,254,0.56)]">
            {filesize}
          </span>
        </div>
      </div>
      <ChevronRight className="size-2 text-[#858699] rotate-90" />
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
              "text-[15px] leading-[22px] font-normal text-[#EEEFFC]",
              "whitespace-pre-wrap"
            )}
          >
            {value || (
              <span className="text-[#4C4F6B]">{placeholder}</span>
            )}
          </p>
        ) : (
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            className={cn(
              "w-full min-h-[80px] resize-none",
              "bg-transparent",
              "text-[15px] leading-[22px] font-normal text-[#EEEFFC]",
              "placeholder:text-[#4C4F6B]",
              "focus:outline-none"
            )}
          />
        )}
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-col gap-2 pb-[10px]">
          {attachments.map((attachment) => (
            <AttachmentDisplay
              key={attachment.id}
              filename={attachment.filename}
              filesize={attachment.filesize}
              onClick={() => onAttachmentClick?.(attachment)}
            />
          ))}
        </div>
      )}

      {/* Attach Button (shows on hover/focus) */}
      {showAttachButton && (
        <button
          type="button"
          onClick={onAttach}
          className={cn(
            "absolute top-0 right-0",
            "p-[6px] rounded-[4px]",
            "text-[#858699]",
            "transition-colors duration-150",
            "hover:bg-muted hover:text-foreground"
          )}
          aria-label="Attach file"
        >
          <Paperclip className="size-4" />
        </button>
      )}
    </div>
  );
}

export { DescriptionInput, AttachmentDisplay };
