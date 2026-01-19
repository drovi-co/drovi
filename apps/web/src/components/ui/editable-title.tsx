"use client";

import type * as React from "react";
import { useState, useRef, useEffect } from "react";

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

interface EditableTitleProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
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
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full",
            "bg-transparent",
            "text-[24px] font-semibold text-[#EEEFFC] leading-tight",
            "placeholder:text-[#4C4F6B]",
            "outline-none",
            "border-b-2 border-primary/50"
          )}
          placeholder={placeholder}
          data-slot="editable-title-input"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative",
        !readOnly && "cursor-text",
        className
      )}
      onClick={handleClick}
      data-slot="editable-title"
      {...props}
    >
      {value ? (
        <h1 className="text-[24px] font-semibold text-[#EEEFFC] leading-tight">
          {value}
        </h1>
      ) : (
        <h1 className="text-[24px] font-semibold text-[#4C4F6B] leading-tight">
          {placeholder}
        </h1>
      )}
    </div>
  );
}

/**
 * Smaller editable text for sub-items
 */
interface EditableTextProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
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
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={cn(
            "w-full",
            "bg-transparent",
            sizeClasses[size],
            "font-medium text-[#EEEFFC]",
            "placeholder:text-[#4C4F6B]",
            "outline-none",
            "border-b border-primary/50"
          )}
          placeholder={placeholder}
          data-slot="editable-text-input"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative",
        !readOnly && "cursor-text hover:bg-muted/30 rounded px-1 -mx-1",
        className
      )}
      onClick={handleClick}
      data-slot="editable-text"
      {...props}
    >
      {value ? (
        <span className={cn(sizeClasses[size], "font-medium text-[#EEEFFC]")}>
          {value}
        </span>
      ) : (
        <span className={cn(sizeClasses[size], "font-medium text-[#4C4F6B]")}>
          {placeholder}
        </span>
      )}
    </div>
  );
}

export { EditableTitle, EditableText };
