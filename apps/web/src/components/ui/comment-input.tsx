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

interface CommentInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSubmit"> {
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
        "rounded-[4px] border border-border",
        "bg-muted",
        "transition-colors duration-150",
        isFocused && "border-border",
        className
      )}
      data-slot="comment-input"
      {...props}
    >
      {/* Textarea */}
      <div className="p-1">
        <textarea
          className={cn(
            "min-h-[80px] w-full resize-none",
            "bg-transparent",
            "font-medium text-[12px] text-foreground",
            "placeholder:text-muted-foreground",
            "focus:outline-none",
            "p-1"
          )}
          onBlur={() => setIsFocused(false)}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          value={value}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end px-2 pb-2">
        <div className="flex items-center gap-2">
          <button
            aria-label="Attach file"
            className={cn(
              "inline-flex items-center justify-center",
              "rounded-[4px] p-[7px]",
              "text-muted-foreground",
              "transition-colors duration-150",
              "hover:bg-muted hover:text-foreground"
            )}
            onClick={onAttach}
            type="button"
          >
            <Paperclip className="size-[12.25px]" />
          </button>

          <Button
            className={cn(
              "h-[28px] px-[14px]",
              "border border-border bg-muted",
              "shadow-[0px_1px_1px_0px_rgba(0,0,0,0.15)]",
              "font-medium text-[12px]"
            )}
            disabled={!value.trim() || isSubmitting}
            onClick={handleSubmit}
            size="sm"
            variant="secondary"
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
    <div className={cn("flex gap-3", className)} data-slot="comment" {...props}>
      {/* Avatar */}
      <div className="shrink-0">
        {author.imageUrl ? (
          <img
            alt={author.name}
            className="size-6 rounded-full object-cover"
            src={author.imageUrl}
          />
        ) : (
          <div className="flex size-6 items-center justify-center rounded-full bg-secondary font-medium text-[10px] text-white">
            {author.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-medium text-foreground text-[12px]">
            {author.name}
          </span>
          <span className="text-muted-foreground text-[12px]">{timestamp}</span>
        </div>
        <p className="whitespace-pre-wrap text-[13px] text-foreground">
          {content}
        </p>
      </div>
    </div>
  );
}

export { CommentInput, Comment };
