// =============================================================================
// EVIDENCE POPOVER COMPONENT
// =============================================================================
//
// Fast, inline evidence display for one-click "Show Me" capability.
// This is faster than the full evidence sheet - shows the key proof
// in a popover that appears on hover or click.
//

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

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
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
  if (confidence >= 0.85) return "text-green-600";
  if (confidence >= 0.6) return "text-amber-600";
  return "text-red-600";
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return "High";
  if (confidence >= 0.6) return "Medium";
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-96 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full",
                typeConfig.color
              )}
            >
              <TypeIcon className="h-3 w-3" />
              {typeConfig.label}
            </span>
            <div className="flex items-center gap-2">
              {evidence.isUserVerified && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <ThumbsUp className="h-3 w-3" />
                  Verified
                </span>
              )}
              {evidence.isUserDismissed && (
                <span className="flex items-center gap-1 text-xs text-red-600">
                  <ThumbsDown className="h-3 w-3" />
                  Dismissed
                </span>
              )}
            </div>
          </div>
          <p className="text-sm font-medium leading-snug">{evidence.title}</p>
        </div>

        {/* Confidence */}
        <div className="px-4 py-3 border-b border-border/50 bg-muted/30">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-purple-500" />
              AI Confidence
            </span>
            <span className={cn("text-xs font-medium", confidenceColor)}>
              {Math.round(evidence.confidence * 100)}% - {confidenceLabel}
            </span>
          </div>
          <Progress value={evidence.confidence * 100} className="h-1.5" />
        </div>

        {/* Quoted Evidence - The Key Proof */}
        {evidence.quotedText && (
          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-start gap-2">
              <Hash className="h-3.5 w-3.5 text-yellow-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Source Quote
                </p>
                <p className="text-sm italic text-foreground bg-yellow-100 dark:bg-yellow-900/30 px-2 py-1 rounded">
                  "{evidence.quotedText}"
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Source Message */}
        {evidence.sourceMessage && (
          <div className="px-4 py-3 border-b border-border/50">
            <button
              type="button"
              onClick={() => evidence.threadId && onThreadClick?.(evidence.threadId)}
              disabled={!evidence.threadId || !onThreadClick}
              className="flex items-center gap-2 w-full text-left hover:bg-muted/50 -mx-2 px-2 py-1 rounded transition-colors"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                  {getInitials(
                    evidence.sourceMessage.senderName,
                    evidence.sourceMessage.senderEmail
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">
                  {evidence.sourceMessage.senderName ??
                    evidence.sourceMessage.senderEmail}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {evidence.sourceMessage.threadSubject ?? "Email thread"} •{" "}
                  {format(evidence.sourceMessage.sentAt, "MMM d")}
                </p>
              </div>
              {evidence.threadId && onThreadClick && (
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="p-3 flex gap-2">
          {!evidence.isUserVerified && !evidence.isUserDismissed && (
            <>
              {onVerify && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onVerify(evidence.id);
                    setOpen(false);
                  }}
                  className="flex-1 h-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                  Correct
                </Button>
              )}
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onDismiss(evidence.id);
                    setOpen(false);
                  }}
                  className="flex-1 h-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                  Wrong
                </Button>
              )}
            </>
          )}
          {onShowFullEvidence && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onShowFullEvidence(evidence.id);
                setOpen(false);
              }}
              className={cn(
                "h-8",
                !evidence.isUserVerified && !evidence.isUserDismissed
                  ? "flex-1"
                  : "w-full"
              )}
            >
              Full Details
            </Button>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border/50 bg-muted/30">
          <p className="text-[10px] text-muted-foreground text-center">
            Extracted {formatDistanceToNow(evidence.extractedAt, { addSuffix: true })}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default EvidencePopover;
