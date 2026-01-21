"use client";

import type * as React from "react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Editable Title component
 *
 * Features:
 * - Click to edit functionality
 * - Large title font (24px)
 * - Placeholder support
 * - Auto-focus on edit mode
 * - Submit on Enter, cancel on Escape
 */

interface EditableTitleProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

function EditableTitle({
  className,
  value,
  onChange,
  placeholder = "Issue title",
  readOnly = false,
  ...props
}: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (!readOnly) {
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue.trim() !== value) {
      onChange?.(editValue.trim() || value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className={cn("relative", className)} {...props}>
        <input
          className={cn(
            "w-full",
            "bg-transparent",
            "font-semibold text-[24px] text-foreground leading-tight",
            "placeholder:text-muted-foreground",
            "outline-none",
            "border-primary/50 border-b-2"
          )}
          data-slot="editable-title-input"
          onBlur={handleBlur}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          type="text"
          value={editValue}
        />
      </div>
    );
  }

  return (
    <div
      className={cn("relative", !readOnly && "cursor-text", className)}
      data-slot="editable-title"
      onClick={handleClick}
      {...props}
    >
      {value ? (
        <h1 className="font-semibold text-[24px] text-foreground leading-tight">
          {value}
        </h1>
      ) : (
        <h1 className="font-semibold text-[24px] text-muted-foreground leading-tight">
          {placeholder}
        </h1>
      )}
    </div>
  );
}

/**
 * Smaller editable text for sub-items
 */
interface EditableTextProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  size?: "sm" | "md" | "lg";
}

function EditableText({
  className,
  value,
  onChange,
  placeholder = "Enter text...",
  readOnly = false,
  size = "md",
  ...props
}: EditableTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const sizeClasses = {
    sm: "text-[13px]",
    md: "text-[15px]",
    lg: "text-[18px]",
  };

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (!readOnly) {
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue.trim() !== value) {
      onChange?.(editValue.trim() || value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className={cn("relative", className)} {...props}>
        <input
          className={cn(
            "w-full",
            "bg-transparent",
            sizeClasses[size],
            "font-medium text-foreground",
            "placeholder:text-muted-foreground",
            "outline-none",
            "border-primary/50 border-b"
          )}
          data-slot="editable-text-input"
          onBlur={handleBlur}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          type="text"
          value={editValue}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative",
        !readOnly && "-mx-1 cursor-text rounded px-1 hover:bg-muted/30",
        className
      )}
      data-slot="editable-text"
      onClick={handleClick}
      {...props}
    >
      {value ? (
        <span className={cn(sizeClasses[size], "font-medium text-foreground")}>
          {value}
        </span>
      ) : (
        <span
          className={cn(sizeClasses[size], "font-medium text-muted-foreground")}
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}

export { EditableTitle, EditableText };
