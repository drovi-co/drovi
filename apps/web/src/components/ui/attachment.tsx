"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Archive, File, FileText, Film, Image, Music, X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Linear-style Attachment component
 *
 * Features:
 * - Document icon + filename + filesize layout
 * - File type detection for appropriate icons
 * - Removable with X button
 * - Clickable to open/download
 */
const attachmentVariants = cva(
  [
    "inline-flex items-center gap-2",
    "h-8 px-2.5",
    "rounded-[4px]",
    "border border-border bg-muted/50",
    "text-[12px]",
    "transition-colors duration-150",
    "hover:bg-muted",
    "cursor-pointer",
  ],
  {
    variants: {
      size: {
        sm: "h-7 px-2 text-[11px]",
        md: "h-8 px-2.5 text-[12px]",
        lg: "h-9 px-3 text-[13px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
);

type FileType = "document" | "image" | "video" | "audio" | "archive" | "other";

interface AttachmentProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof attachmentVariants> {
  filename: string;
  filesize?: string;
  fileType?: FileType;
  url?: string;
  onRemove?: () => void;
}

const fileTypeIcons: Record<FileType, React.ElementType> = {
  document: FileText,
  image: Image,
  video: Film,
  audio: Music,
  archive: Archive,
  other: File,
};

function getFileType(filename: string): FileType {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  if (
    [
      "pdf",
      "doc",
      "docx",
      "txt",
      "rtf",
      "odt",
      "xls",
      "xlsx",
      "csv",
      "ppt",
      "pptx",
    ].includes(ext)
  ) {
    return "document";
  }
  if (
    ["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "ico"].includes(ext)
  ) {
    return "image";
  }
  if (["mp4", "mov", "avi", "mkv", "webm", "flv"].includes(ext)) {
    return "video";
  }
  if (["mp3", "wav", "ogg", "flac", "aac", "m4a"].includes(ext)) {
    return "audio";
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) {
    return "archive";
  }
  return "other";
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

function Attachment({
  className,
  size,
  filename,
  filesize,
  fileType,
  url,
  onRemove,
  onClick,
  ...props
}: AttachmentProps) {
  const detectedType = fileType || getFileType(filename);
  const Icon = fileTypeIcons[detectedType];
  const iconSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    onClick?.(e);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.();
  };

  return (
    <div
      className={cn(attachmentVariants({ size }), className)}
      data-slot="attachment"
      onClick={handleClick}
      {...props}
    >
      <Icon
        className="shrink-0 text-muted-foreground"
        style={{ width: iconSize, height: iconSize }}
      />
      <span className="max-w-[150px] truncate font-medium text-foreground">
        {filename}
      </span>
      {filesize && (
        <span className="shrink-0 text-muted-foreground">{filesize}</span>
      )}
      {onRemove && (
        <button
          aria-label="Remove attachment"
          className="ml-1 rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
          onClick={handleRemove}
          type="button"
        >
          <X style={{ width: iconSize - 2, height: iconSize - 2 }} />
        </button>
      )}
    </div>
  );
}

/**
 * Attachment List - container for multiple attachments
 */
interface AttachmentListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function AttachmentList({
  className,
  children,
  ...props
}: AttachmentListProps) {
  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-slot="attachment-list"
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Attachment,
  AttachmentList,
  attachmentVariants,
  formatFileSize,
  getFileType,
};
