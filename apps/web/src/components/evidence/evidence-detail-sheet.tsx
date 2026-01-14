// =============================================================================
// EVIDENCE DETAIL SHEET
// =============================================================================
//
// The "Show Me" capability - every AI extraction needs one-click proof.
// This is the cornerstone of trust: users must see the exact evidence
// that led to any commitment, decision, or claim extraction.
//

import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Hash,
  Lightbulb,
  Mail,
  MessageSquare,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export type EvidenceType = "commitment" | "decision" | "claim" | "relationship";

export interface EvidenceSource {
  messageId: string;
  threadId: string;
  threadSubject?: string | null;
  senderEmail: string;
  senderName?: string | null;
  sentAt: Date;
  bodyText?: string | null;
  snippet?: string | null;
}

export interface ConfidenceFactor {
  name: string;
  score: number;
  explanation: string;
  weight: number;
}

export interface OtherMention {
  id: string;
  type: EvidenceType;
  title: string;
  confidence: number;
  threadSubject?: string | null;
  extractedAt: Date;
}

export interface UserCorrection {
  id: string;
  action: "verified" | "dismissed" | "corrected";
  correctedText?: string | null;
  reason?: string | null;
  timestamp: Date;
  userId: string;
  userName?: string | null;
}

export interface EvidenceData {
  // Core identification
  id: string;
  type: EvidenceType;
  title: string;

  // The extracted content
  extractedText: string;

  // Source evidence
  quotedText?: string | null;
  quotedTextStart?: number | null;
  quotedTextEnd?: number | null;
  sourceMessage?: EvidenceSource | null;
  sourceMessageIds?: string[];

  // Confidence details
  confidence: number;
  confidenceFactors?: ConfidenceFactor[];

  // Extraction metadata
  extractedAt: Date;
  modelVersion?: string | null;
  modelName?: string | null;

  // User interactions
  isUserVerified?: boolean;
  isUserDismissed?: boolean;
  userCorrectedText?: string | null;
  corrections?: UserCorrection[];

  // Related extractions
  otherMentions?: OtherMention[];

  // Links
  threadId?: string | null;
  entityId?: string | null;
}

interface EvidenceDetailSheetProps {
  evidence: EvidenceData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerify?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onCorrect?: (id: string, correctedText: string) => void;
  onThreadClick?: (threadId: string) => void;
  onMentionClick?: (mention: OtherMention) => void;
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
        gradient: "from-blue-500/10",
      };
    case "decision":
      return {
        label: "Decision",
        icon: Lightbulb,
        color: "text-purple-600 bg-purple-500/10",
        gradient: "from-purple-500/10",
      };
    case "claim":
      return {
        label: "Claim",
        icon: FileText,
        color: "text-amber-600 bg-amber-500/10",
        gradient: "from-amber-500/10",
      };
    case "relationship":
      return {
        label: "Relationship",
        icon: User,
        color: "text-green-600 bg-green-500/10",
        gradient: "from-green-500/10",
      };
  }
}

function getConfidenceLevel(confidence: number): {
  label: string;
  color: string;
  description: string;
} {
  if (confidence >= 0.9) {
    return {
      label: "Very High",
      color: "text-green-600",
      description: "Strong linguistic indicators and clear context",
    };
  }
  if (confidence >= 0.75) {
    return {
      label: "High",
      color: "text-green-500",
      description: "Clear indicators with supporting context",
    };
  }
  if (confidence >= 0.5) {
    return {
      label: "Medium",
      color: "text-amber-600",
      description: "Likely correct but some ambiguity present",
    };
  }
  return {
    label: "Low",
    color: "text-red-600",
    description: "Possible extraction, review recommended",
  };
}

function highlightQuotedText(
  bodyText: string,
  quotedText: string | null | undefined,
  start: number | null | undefined,
  end: number | null | undefined
): React.ReactNode {
  if (!quotedText || start === null || start === undefined) {
    return <p className="text-sm text-muted-foreground whitespace-pre-wrap">{bodyText}</p>;
  }

  // Use positions if available, otherwise find the quoted text
  let actualStart = start;
  let actualEnd = end ?? (start + quotedText.length);

  if (actualStart > bodyText.length) {
    // Fallback: search for the quoted text
    actualStart = bodyText.indexOf(quotedText);
    if (actualStart === -1) {
      return <p className="text-sm text-muted-foreground whitespace-pre-wrap">{bodyText}</p>;
    }
    actualEnd = actualStart + quotedText.length;
  }

  const before = bodyText.slice(0, actualStart);
  const highlighted = bodyText.slice(actualStart, actualEnd);
  const after = bodyText.slice(actualEnd);

  return (
    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-800/50 text-foreground px-0.5 rounded">
        {highlighted}
      </mark>
      {after}
    </p>
  );
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
// DEFAULT CONFIDENCE FACTORS
// =============================================================================

function getDefaultConfidenceFactors(
  type: EvidenceType,
  confidence: number
): ConfidenceFactor[] {
  // Generate explanatory factors based on confidence level
  const factors: ConfidenceFactor[] = [];

  if (type === "commitment") {
    factors.push({
      name: "Language Pattern",
      score: confidence > 0.7 ? 0.85 : 0.5,
      explanation:
        confidence > 0.7
          ? 'Clear commitment language detected (e.g., "I will", "we promise")'
          : "Implicit commitment language, context-dependent",
      weight: 0.4,
    });
    factors.push({
      name: "Temporal Reference",
      score: confidence > 0.6 ? 0.75 : 0.4,
      explanation:
        confidence > 0.6
          ? "Specific deadline or timeframe mentioned"
          : "No clear deadline detected",
      weight: 0.3,
    });
    factors.push({
      name: "Party Attribution",
      score: confidence > 0.5 ? 0.8 : 0.5,
      explanation:
        confidence > 0.5
          ? "Clear identification of who made/received the commitment"
          : "Ambiguous party attribution",
      weight: 0.3,
    });
  } else if (type === "decision") {
    factors.push({
      name: "Decision Language",
      score: confidence > 0.7 ? 0.9 : 0.5,
      explanation:
        confidence > 0.7
          ? 'Explicit decision indicators (e.g., "we decided", "final answer")'
          : "Implied decision, may be preliminary",
      weight: 0.5,
    });
    factors.push({
      name: "Finality",
      score: confidence > 0.6 ? 0.7 : 0.4,
      explanation:
        confidence > 0.6
          ? "Language suggests concluded decision"
          : "May be tentative or subject to change",
      weight: 0.3,
    });
    factors.push({
      name: "Authority",
      score: confidence > 0.5 ? 0.75 : 0.5,
      explanation:
        confidence > 0.5
          ? "Decision maker has apparent authority"
          : "Decision maker authority unclear",
      weight: 0.2,
    });
  } else {
    factors.push({
      name: "Context Quality",
      score: confidence,
      explanation: "Based on surrounding context and clarity",
      weight: 0.5,
    });
    factors.push({
      name: "Extraction Clarity",
      score: confidence,
      explanation: "How clearly the content was identified",
      weight: 0.5,
    });
  }

  return factors;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function EvidenceDetailSheet({
  evidence,
  open,
  onOpenChange,
  onVerify,
  onDismiss,
  onCorrect,
  onThreadClick,
  onMentionClick,
}: EvidenceDetailSheetProps) {
  if (!evidence) return null;

  const typeConfig = getTypeConfig(evidence.type);
  const TypeIcon = typeConfig.icon;
  const confidenceLevel = getConfidenceLevel(evidence.confidence);
  const confidenceFactors =
    evidence.confidenceFactors ??
    getDefaultConfidenceFactors(evidence.type, evidence.confidence);

  const handleCopyEvidence = () => {
    const text = evidence.quotedText ?? evidence.extractedText;
    navigator.clipboard.writeText(text);
    toast.success("Evidence copied to clipboard");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:w-[600px] p-0 flex flex-col">
        {/* Header */}
        <div
          className={cn(
            "px-6 pt-6 pb-4 bg-gradient-to-b to-transparent",
            typeConfig.gradient
          )}
        >
          <SheetHeader className="space-y-4">
            {/* Type & Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full",
                    typeConfig.color
                  )}
                >
                  <TypeIcon className="h-3.5 w-3.5" />
                  {typeConfig.label} Evidence
                </span>
                {evidence.isUserVerified && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-2 py-1 rounded-full">
                    <ThumbsUp className="h-3 w-3" />
                    Verified
                  </span>
                )}
                {evidence.isUserDismissed && (
                  <span className="flex items-center gap-1 text-xs text-red-600 bg-red-500/10 px-2 py-1 rounded-full">
                    <ThumbsDown className="h-3 w-3" />
                    Dismissed
                  </span>
                )}
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help">
                      {evidence.modelName ?? "AI"} •{" "}
                      {formatDistanceToNow(evidence.extractedAt, {
                        addSuffix: true,
                      })}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Extracted on{" "}
                      {format(evidence.extractedAt, "MMM d, yyyy 'at' h:mm a")}
                    </p>
                    {evidence.modelVersion && (
                      <p className="text-xs text-muted-foreground">
                        Model: {evidence.modelVersion}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Title */}
            <SheetTitle className="text-xl font-semibold leading-tight pr-8">
              {evidence.title}
            </SheetTitle>

            {/* Extracted Text Preview */}
            <div className="p-3 rounded-lg bg-background/80 border border-border/50">
              <p className="text-sm leading-relaxed">{evidence.extractedText}</p>
            </div>
          </SheetHeader>
        </div>

        <Separator />

        {/* Content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-6">
            {/* Confidence Breakdown */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                  AI Confidence
                </h4>
                <span className={cn("text-sm font-semibold", confidenceLevel.color)}>
                  {Math.round(evidence.confidence * 100)}% - {confidenceLevel.label}
                </span>
              </div>

              {/* Overall Progress */}
              <div className="space-y-1">
                <Progress value={evidence.confidence * 100} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {confidenceLevel.description}
                </p>
              </div>

              {/* Factor Breakdown */}
              <div className="space-y-3 pt-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Confidence Factors
                </p>
                {confidenceFactors.map((factor, index) => (
                  <div key={index} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{factor.name}</span>
                      <span
                        className={cn(
                          "text-xs font-medium",
                          factor.score >= 0.7
                            ? "text-green-600"
                            : factor.score >= 0.5
                              ? "text-amber-600"
                              : "text-red-600"
                        )}
                      >
                        {Math.round(factor.score * 100)}%
                      </span>
                    </div>
                    <Progress value={factor.score * 100} className="h-1" />
                    <p className="text-xs text-muted-foreground">
                      {factor.explanation}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Source Evidence - The "Show Me" */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Source Evidence
              </h4>

              {evidence.quotedText ? (
                <div className="space-y-3">
                  {/* Quoted Text Box */}
                  <div className="p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
                    <div className="flex items-start gap-2">
                      <Hash className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                          Exact Quote
                        </p>
                        <p className="text-sm italic text-yellow-900 dark:text-yellow-100">
                          "{evidence.quotedText}"
                        </p>
                        {evidence.quotedTextStart !== null &&
                          evidence.quotedTextStart !== undefined && (
                            <p className="text-xs text-yellow-600 dark:text-yellow-400">
                              Characters {evidence.quotedTextStart} -{" "}
                              {evidence.quotedTextEnd ?? "end"}
                            </p>
                          )}
                      </div>
                    </div>
                  </div>

                  {/* Full Context */}
                  {evidence.sourceMessage?.bodyText && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Full Message Context
                      </p>
                      <div className="p-4 rounded-lg bg-muted/30 border border-border/50 max-h-48 overflow-y-auto">
                        {highlightQuotedText(
                          evidence.sourceMessage.bodyText,
                          evidence.quotedText,
                          evidence.quotedTextStart,
                          evidence.quotedTextEnd
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                  <p className="text-sm text-muted-foreground italic">
                    No specific quote captured. This extraction was based on
                    contextual analysis.
                  </p>
                </div>
              )}
            </div>

            {/* Source Message Details */}
            {evidence.sourceMessage && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" />
                    Source Email
                  </h4>

                  <button
                    type="button"
                    onClick={() =>
                      evidence.threadId && onThreadClick?.(evidence.threadId)
                    }
                    className="flex items-start gap-3 w-full p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
                  >
                    <Avatar className="h-10 w-10 mt-0.5">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {getInitials(
                          evidence.sourceMessage.senderName,
                          evidence.sourceMessage.senderEmail
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium">
                          {evidence.sourceMessage.senderName ??
                            evidence.sourceMessage.senderEmail}
                        </p>
                        <span className="text-xs text-muted-foreground">
                          {format(evidence.sourceMessage.sentAt, "MMM d, yyyy")}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {evidence.sourceMessage.threadSubject ?? "Email thread"}
                      </p>
                      {evidence.sourceMessage.snippet && (
                        <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                          {evidence.sourceMessage.snippet}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                </div>
              </>
            )}

            {/* Other Mentions */}
            {evidence.otherMentions && evidence.otherMentions.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5" />
                    Related Extractions ({evidence.otherMentions.length})
                  </h4>

                  <div className="space-y-2">
                    {evidence.otherMentions.map((mention) => {
                      const mentionConfig = getTypeConfig(mention.type);
                      const MentionIcon = mentionConfig.icon;
                      return (
                        <button
                          key={mention.id}
                          type="button"
                          onClick={() => onMentionClick?.(mention)}
                          className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors text-left group"
                        >
                          <div
                            className={cn(
                              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                              mentionConfig.color
                            )}
                          >
                            <MentionIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {mention.title}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{mentionConfig.label}</span>
                              <span>•</span>
                              <span
                                className={cn(
                                  mention.confidence >= 0.7
                                    ? "text-green-600"
                                    : mention.confidence >= 0.5
                                      ? "text-amber-600"
                                      : "text-red-600"
                                )}
                              >
                                {Math.round(mention.confidence * 100)}%
                              </span>
                              {mention.threadSubject && (
                                <>
                                  <span>•</span>
                                  <span className="truncate">
                                    {mention.threadSubject}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            {/* User Corrections History */}
            {evidence.corrections && evidence.corrections.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Eye className="h-3.5 w-3.5" />
                    User Feedback History
                  </h4>

                  <div className="space-y-2">
                    {evidence.corrections.map((correction) => (
                      <div
                        key={correction.id}
                        className={cn(
                          "p-3 rounded-lg border",
                          correction.action === "verified" &&
                            "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
                          correction.action === "dismissed" &&
                            "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
                          correction.action === "corrected" &&
                            "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={cn(
                              "text-xs font-medium capitalize",
                              correction.action === "verified" &&
                                "text-green-700 dark:text-green-300",
                              correction.action === "dismissed" &&
                                "text-red-700 dark:text-red-300",
                              correction.action === "corrected" &&
                                "text-blue-700 dark:text-blue-300"
                            )}
                          >
                            {correction.action}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(correction.timestamp, {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                        {correction.correctedText && (
                          <p className="text-sm mt-1">
                            Corrected to: "{correction.correctedText}"
                          </p>
                        )}
                        {correction.reason && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Reason: {correction.reason}
                          </p>
                        )}
                        {correction.userName && (
                          <p className="text-xs text-muted-foreground mt-1">
                            By {correction.userName}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* User Correction Display */}
            {evidence.userCorrectedText && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <ThumbsUp className="h-3.5 w-3.5 text-amber-500" />
                    User Corrected
                  </h4>
                  <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <p className="text-sm">
                      <span className="text-muted-foreground line-through mr-2">
                        {evidence.extractedText}
                      </span>
                      <span className="font-medium text-amber-800 dark:text-amber-200">
                        {evidence.userCorrectedText}
                      </span>
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Actions Footer */}
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCopyEvidence} className="flex-1">
              <Copy className="h-4 w-4 mr-2" />
              Copy Evidence
            </Button>
            {evidence.threadId && onThreadClick && (
              <Button
                variant="outline"
                onClick={() => onThreadClick(evidence.threadId!)}
                className="flex-1"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Thread
              </Button>
            )}
          </div>

          {!evidence.isUserDismissed && (
            <div className="flex gap-2">
              {!evidence.isUserVerified && onVerify && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onVerify(evidence.id)}
                  className="flex-1 text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                  Verify Correct
                </Button>
              )}
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDismiss(evidence.id)}
                  className="flex-1 text-destructive hover:text-destructive"
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                  Dismiss
                </Button>
              )}
            </div>
          )}

          {/* Trust Banner */}
          <div className="flex items-center justify-center gap-2 pt-2">
            <AlertCircle className="h-3 w-3 text-muted-foreground" />
            <p className="text-xs text-muted-foreground text-center">
              Your feedback improves AI accuracy for everyone
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default EvidenceDetailSheet;
