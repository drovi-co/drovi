"use client";

import { Paperclip } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Linear-style Comment Input component
 *
 * Features:
 * - Placeholder text "Leave a comment..."
 * - Expands on focus
 * - Attach button
 * - Comment submit button
 * - Matches Linear's comment input styling
 */

interface CommentInputProps extends React.HTMLAttributes<HTMLDivElement> {
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  onAttach?: () => void;
  isSubmitting?: boolean;
}

function CommentInput({
  className,
  placeholder = "Leave a comment...",
  value: controlledValue,
  onValueChange,
  onSubmit,
  onAttach,
  isSubmitting = false,
  ...props
}: CommentInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const value = controlledValue ?? internalValue;
  const setValue = onValueChange ?? setInternalValue;

  const handleSubmit = () => {
    if (value.trim() && onSubmit) {
      onSubmit(value.trim());
      if (!controlledValue) {
        setInternalValue("");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        "rounded-[4px] border border-[#292B41]",
        "bg-[#1F2130]",
        "transition-colors duration-150",
        isFocused && "border-[#393A4B]",
        className
      )}
      data-slot="comment-input"
      {...props}
    >
      {/* Textarea */}
      <div className="p-1">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "w-full min-h-[80px] resize-none",
            "bg-transparent",
            "text-[12px] font-medium text-foreground",
            "placeholder:text-[#4C4F6B]",
            "focus:outline-none",
            "p-1"
          )}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end px-2 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onAttach}
            className={cn(
              "inline-flex items-center justify-center",
              "p-[7px] rounded-[4px]",
              "text-[#858699]",
              "transition-colors duration-150",
              "hover:bg-muted hover:text-foreground"
            )}
            aria-label="Attach file"
          >
            <Paperclip className="size-[12.25px]" />
          </button>

          <Button
            variant="secondary"
            size="sm"
            onClick={handleSubmit}
            disabled={!value.trim() || isSubmitting}
            className={cn(
              "h-[28px] px-[14px]",
              "bg-[#292a35] border border-[#393a4b]",
              "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
              "text-[12px] font-medium"
            )}
          >
            {isSubmitting ? "Sending..." : "Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Comment Display - for showing existing comments
 */
interface CommentProps extends React.HTMLAttributes<HTMLDivElement> {
  author: {
    name: string;
    imageUrl?: string;
  };
  content: string;
  timestamp: string;
  onEdit?: () => void;
  onDelete?: () => void;
}

function Comment({
  className,
  author,
  content,
  timestamp,
  onEdit,
  onDelete,
  ...props
}: CommentProps) {
  return (
    <div
      className={cn("flex gap-3", className)}
      data-slot="comment"
      {...props}
    >
      {/* Avatar */}
      <div className="shrink-0">
        {author.imageUrl ? (
          <img
            src={author.imageUrl}
            alt={author.name}
            className="size-6 rounded-full object-cover"
          />
        ) : (
          <div className="size-6 rounded-full bg-[#5E6AD2] flex items-center justify-center text-[10px] font-medium text-white">
            {author.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] font-medium text-[#EEEFFC]">
            {author.name}
          </span>
          <span className="text-[12px] text-[#858699]">{timestamp}</span>
        </div>
        <p className="text-[13px] text-foreground whitespace-pre-wrap">
          {content}
        </p>
      </div>
    </div>
  );
}

export { CommentInput, Comment };
