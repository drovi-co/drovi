// =============================================================================
// ATTACHMENT ZONE
// =============================================================================
//
// Shared attachment handling UI for all compose sources.
// Supports drag-and-drop, file picker, and source-specific limits.
//

import { FileIcon, FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Attachment, SourceType } from "../compose-provider";

// =============================================================================
// TYPES & CONSTANTS
// =============================================================================

interface AttachmentLimits {
  maxFileSize: number; // bytes
  maxTotalSize: number; // bytes
  allowedTypes?: string[]; // MIME types
  description: string;
}

// Source-specific attachment limits
const ATTACHMENT_LIMITS: Record<SourceType, AttachmentLimits> = {
  email: {
    maxFileSize: 25 * 1024 * 1024, // 25MB per file
    maxTotalSize: 50 * 1024 * 1024, // 50MB total
    description: "25MB per file, 50MB total",
  },
  slack: {
    maxFileSize: 1024 * 1024 * 1024, // 1GB per file
    maxTotalSize: 1024 * 1024 * 1024, // 1GB total
    description: "1GB per file",
  },
  whatsapp: {
    maxFileSize: 16 * 1024 * 1024, // 16MB for media
    maxTotalSize: 100 * 1024 * 1024, // 100MB total
    allowedTypes: [
      "image/*",
      "video/*",
      "audio/*",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    description: "16MB per file for media",
  },
};

// =============================================================================
// HELPERS
// =============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.includes("pdf") || mimeType.includes("document"))
    return FileText;
  return FileIcon;
}

// =============================================================================
// ATTACHMENT BUTTON
// =============================================================================

interface AttachmentButtonProps {
  sourceType: SourceType;
  onFilesSelected: (files: FileList) => void;
  disabled?: boolean;
}

export function AttachmentButton({
  sourceType,
  onFilesSelected,
  disabled,
}: AttachmentButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const limits = ATTACHMENT_LIMITS[sourceType];

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        onFilesSelected(files);
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [onFilesSelected]
  );

  return (
    <>
      <Button
        className="h-8 w-8"
        disabled={disabled}
        onClick={handleClick}
        size="icon"
        title={`Attach files (${limits.description})`}
        variant="ghost"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <input
        accept={limits.allowedTypes?.join(",") || "*/*"}
        className="hidden"
        multiple
        onChange={handleChange}
        ref={fileInputRef}
        type="file"
      />
    </>
  );
}

// =============================================================================
// ATTACHMENT LIST
// =============================================================================

interface AttachmentListProps {
  attachments: Attachment[];
  sourceType: SourceType;
  onRemove: (id: string) => void;
  className?: string;
}

export function AttachmentList({
  attachments,
  sourceType,
  onRemove,
  className,
}: AttachmentListProps) {
  if (attachments.length === 0) return null;

  const limits = ATTACHMENT_LIMITS[sourceType];
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  const isOverLimit = totalSize > limits.maxTotalSize;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => {
          const IconComponent = getFileIcon(attachment.mimeType);
          const isFileOverLimit = attachment.size > limits.maxFileSize;

          return (
            <Badge
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs",
                isFileOverLimit && "border-destructive bg-destructive/10"
              )}
              key={attachment.id}
              variant="secondary"
            >
              <IconComponent
                className={cn(
                  "h-3.5 w-3.5",
                  isFileOverLimit ? "text-destructive" : "text-muted-foreground"
                )}
              />
              <span className="max-w-[150px] truncate">{attachment.filename}</span>
              <span
                className={cn(
                  isFileOverLimit ? "text-destructive" : "text-muted-foreground"
                )}
              >
                ({formatFileSize(attachment.size)})
              </span>
              <button
                className="ml-1 rounded p-0.5 hover:bg-muted"
                onClick={() => onRemove(attachment.id)}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      <p
        className={cn(
          "text-xs",
          isOverLimit ? "text-destructive" : "text-muted-foreground"
        )}
      >
        Total: {formatFileSize(totalSize)}
        {isOverLimit && ` (exceeds ${limits.description})`}
      </p>
    </div>
  );
}

// =============================================================================
// ATTACHMENT ZONE (Combined drop zone + list)
// =============================================================================

interface AttachmentZoneProps {
  attachments: Attachment[];
  sourceType: SourceType;
  onAdd: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
  className?: string;
  disabled?: boolean;
}

export function AttachmentZone({
  attachments,
  sourceType,
  onAdd,
  onRemove,
  className,
  disabled,
}: AttachmentZoneProps) {
  const limits = ATTACHMENT_LIMITS[sourceType];

  const processFiles = useCallback(
    async (files: FileList) => {
      const currentTotalSize = attachments.reduce((sum, a) => sum + a.size, 0);

      for (const file of Array.from(files)) {
        // Check individual file size
        if (file.size > limits.maxFileSize) {
          toast.error(
            `File "${file.name}" exceeds maximum size of ${formatFileSize(limits.maxFileSize)}`
          );
          continue;
        }

        // Check total size
        if (currentTotalSize + file.size > limits.maxTotalSize) {
          toast.error(
            `Total attachment size would exceed ${formatFileSize(limits.maxTotalSize)} limit`
          );
          break;
        }

        // Check for duplicates
        if (attachments.some((a) => a.filename === file.name)) {
          toast.error(`File "${file.name}" is already attached`);
          continue;
        }

        // Check allowed types for WhatsApp
        if (limits.allowedTypes) {
          const isAllowed = limits.allowedTypes.some((type) => {
            if (type.endsWith("/*")) {
              return file.type.startsWith(type.slice(0, -1));
            }
            return file.type === type;
          });
          if (!isAllowed) {
            toast.error(`File type "${file.type}" is not supported for ${sourceType}`);
            continue;
          }
        }

        // Read file as base64
        try {
          const content = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // Remove data URL prefix
              const base64 = result.split(",")[1];
              resolve(base64 ?? "");
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const newAttachment: Attachment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            content,
          };

          onAdd(newAttachment);
        } catch {
          toast.error(`Failed to read file "${file.name}"`);
        }
      }
    },
    [attachments, limits, sourceType, onAdd]
  );

  const handleFilesSelected = useCallback(
    (files: FileList) => {
      processFiles(files);
    },
    [processFiles]
  );

  return (
    <div className={className}>
      {attachments.length > 0 && (
        <div className="border-t pt-3">
          <AttachmentList
            attachments={attachments}
            onRemove={onRemove}
            sourceType={sourceType}
          />
        </div>
      )}

      {/* The button is rendered separately in the toolbar */}
      <input
        accept={limits.allowedTypes?.join(",") || "*/*"}
        className="hidden"
        id="attachment-input"
        multiple
        onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
        type="file"
      />
    </div>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export { ATTACHMENT_LIMITS, formatFileSize, getFileIcon };
export type { AttachmentLimits };
