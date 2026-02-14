// =============================================================================
// EVIDENCE POPOVER COMPONENT
// =============================================================================
//
// Fast, inline evidence display for one-click "Show Me" capability.
// This is faster than the full evidence sheet - shows the key proof
// in a popover that appears on hover or click.
//

import { Avatar, AvatarFallback } from "@memorystack/ui-core/avatar";
import { Button } from "@memorystack/ui-core/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@memorystack/ui-core/popover";
import { Progress } from "@memorystack/ui-core/progress";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Hash,
  Lightbulb,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

import type { EvidenceType } from "./evidence-detail-sheet";

// =============================================================================
// TYPES
// =============================================================================

export interface EvidencePopoverData {
  id: string;
  type: EvidenceType;
  title: string;
  extractedText: string;
  quotedText?: string | null;
  confidence: number;
  isUserVerified?: boolean;
  isUserDismissed?: boolean;
  sourceMessage?: {
    senderEmail: string;
    senderName?: string | null;
    sentAt: Date;
    threadSubject?: string | null;
  } | null;
  threadId?: string | null;
  extractedAt: Date;
}

interface EvidencePopoverProps {
  children: React.ReactNode;
  evidence: EvidencePopoverData;
  onVerify?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onThreadClick?: (threadId: string) => void;
  onShowFullEvidence?: (id: string) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

// =============================================================================
// HELPERS
// =============================================================================

function getTypeConfig(type: EvidenceType) {
  switch (type) {
    case "commitment":
      return {
        label: "Commitment",
        icon: CheckCircle2,
        color: "text-blue-600 bg-blue-500/10",
      };
    case "decision":
      return {
        label: "Decision",
        icon: Lightbulb,
        color: "text-purple-600 bg-purple-500/10",
      };
    case "claim":
      return {
        label: "Claim",
        icon: FileText,
        color: "text-amber-600 bg-amber-500/10",
      };
    case "relationship":
      return {
        label: "Relationship",
        icon: User,
        color: "text-green-600 bg-green-500/10",
      };
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.85) {
    return "text-green-600";
  }
  if (confidence >= 0.6) {
    return "text-amber-600";
  }
  return "text-red-600";
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.85) {
    return "High";
  }
  if (confidence >= 0.6) {
    return "Medium";
  }
  return "Low";
}

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EvidencePopover({
  children,
  evidence,
  onVerify,
  onDismiss,
  onThreadClick,
  onShowFullEvidence,
  side = "right",
  align = "start",
}: EvidencePopoverProps) {
  const [open, setOpen] = useState(false);

  const typeConfig = getTypeConfig(evidence.type);
  const TypeIcon = typeConfig.icon;
  const confidenceColor = getConfidenceColor(evidence.confidence);
  const confidenceLabel = getConfidenceLabel(evidence.confidence);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-96 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        side={side}
      >
        {/* Header */}
        <div className="border-border/50 border-b p-4">
          <div className="mb-2 flex items-center justify-between">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs",
                typeConfig.color
              )}
            >
              <TypeIcon className="h-3 w-3" />
              {typeConfig.label}
            </span>
            <div className="flex items-center gap-2">
              {evidence.isUserVerified && (
                <span className="flex items-center gap-1 text-green-600 text-xs">
                  <ThumbsUp className="h-3 w-3" />
                  Verified
                </span>
              )}
              {evidence.isUserDismissed && (
                <span className="flex items-center gap-1 text-red-600 text-xs">
                  <ThumbsDown className="h-3 w-3" />
                  Dismissed
                </span>
              )}
            </div>
          </div>
          <p className="font-medium text-sm leading-snug">{evidence.title}</p>
        </div>

        {/* Confidence */}
        <div className="border-border/50 border-b bg-muted/30 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Sparkles className="h-3 w-3 text-purple-500" />
              AI Confidence
            </span>
            <span className={cn("font-medium text-xs", confidenceColor)}>
              {Math.round(evidence.confidence * 100)}% - {confidenceLabel}
            </span>
          </div>
          <Progress className="h-1.5" value={evidence.confidence * 100} />
        </div>

        {/* Quoted Evidence - The Key Proof */}
        {evidence.quotedText && (
          <div className="border-border/50 border-b px-4 py-3">
            <div className="flex items-start gap-2">
              <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />
              <div>
                <p className="mb-1 font-medium text-muted-foreground text-xs">
                  Source Quote
                </p>
                <p className="rounded bg-yellow-100 px-2 py-1 text-foreground text-sm italic dark:bg-yellow-900/30">
                  "{evidence.quotedText}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Source Message */}
        {evidence.sourceMessage && (
          <div className="border-border/50 border-b px-4 py-3">
            <button
              className="-mx-2 flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50"
              disabled={!(evidence.threadId && onThreadClick)}
              onClick={() =>
                evidence.threadId && onThreadClick?.(evidence.threadId)
              }
              type="button"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                  {getInitials(
                    evidence.sourceMessage.senderName,
                    evidence.sourceMessage.senderEmail
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-xs">
                  {evidence.sourceMessage.senderName ??
                    evidence.sourceMessage.senderEmail}
                </p>
                <p className="truncate text-muted-foreground text-xs">
                  {evidence.sourceMessage.threadSubject ?? "Email thread"} •{" "}
                  {format(evidence.sourceMessage.sentAt, "MMM d")}
                </p>
              </div>
              {evidence.threadId && onThreadClick && (
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 p-3">
          {!(evidence.isUserVerified || evidence.isUserDismissed) && (
            <>
              {onVerify && (
                <Button
                  className="h-8 flex-1 text-green-600 hover:bg-green-50 hover:text-green-700"
                  onClick={() => {
                    onVerify(evidence.id);
                    setOpen(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <ThumbsUp className="mr-1 h-3.5 w-3.5" />
                  Correct
                </Button>
              )}
              {onDismiss && (
                <Button
                  className="h-8 flex-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    onDismiss(evidence.id);
                    setOpen(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <ThumbsDown className="mr-1 h-3.5 w-3.5" />
                  Wrong
                </Button>
              )}
            </>
          )}
          {onShowFullEvidence && (
            <Button
              className={cn(
                "h-8",
                evidence.isUserVerified || evidence.isUserDismissed
                  ? "w-full"
                  : "flex-1"
              )}
              onClick={() => {
                onShowFullEvidence(evidence.id);
                setOpen(false);
              }}
              size="sm"
              variant="outline"
            >
              Full Details
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="border-border/50 border-t bg-muted/30 px-4 py-2">
          <p className="text-center text-[10px] text-muted-foreground">
            Extracted{" "}
            {formatDistanceToNow(evidence.extractedAt, { addSuffix: true })}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default EvidencePopover;
