// =============================================================================
// DECISION DETAIL SHEET
// =============================================================================
//
// Beautiful, insightful decision details - showing the full reasoning,
// alternatives considered, who was involved, and the evolution chain.
//

import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  GitBranch,
  Lightbulb,
  MessageSquare,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface DecisionDetailData {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
  evidence?: string[];
  owners?: Array<{
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  }>;
  sourceThread?: {
    id: string;
    subject?: string | null;
    snippet?: string | null;
  } | null;
  supersededBy?: {
    id: string;
    title: string;
    decidedAt: Date;
  } | null;
  supersedes?: {
    id: string;
    title: string;
    decidedAt: Date;
  } | null;
  alternatives?: Array<{
    option: string;
    reason?: string;
  }>;
  topics?: Array<{
    id: string;
    name: string;
  }>;
  metadata?: {
    originalText?: string;
    extractedAt?: string;
  } | null;
}

interface DecisionDetailSheetProps {
  decision: DecisionDetailData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss?: (decisionId: string) => void;
  onVerify?: (decisionId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onViewSupersession?: (decisionId: string) => void;
}

// =============================================================================
// HELPERS
// =============================================================================

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

export function DecisionDetailSheet({
  decision,
  open,
  onOpenChange,
  onDismiss,
  onVerify,
  onThreadClick,
  onContactClick,
  onViewSupersession,
}: DecisionDetailSheetProps) {
  if (!decision) return null;

  const handleCopyStatement = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success("Decision statement copied to clipboard");
  };

  const isActive = !decision.isSuperseded && !decision.supersededBy;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:w-[540px] p-0 flex flex-col">
        {/* Header with purple gradient for decisions */}
        <div className={cn(
          "px-6 pt-6 pb-4",
          isActive
            ? "bg-gradient-to-b from-purple-500/10 to-transparent"
            : "bg-gradient-to-b from-gray-500/5 to-transparent"
        )}>
          <SheetHeader className="space-y-4">
            {/* Status badges */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {decision.supersededBy ? (
                  <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-2 py-1 rounded-full">
                    <AlertTriangle className="h-3 w-3" />
                    Superseded
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-500/10 px-2 py-1 rounded-full">
                    <Lightbulb className="h-3 w-3" />
                    Active Decision
                  </span>
                )}
                {decision.isUserVerified && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-500/10 px-2 py-1 rounded-full">
                    <ThumbsUp className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {format(decision.decidedAt, "MMMM d, yyyy")}
              </span>
            </div>

            {/* Title */}
            <SheetTitle className={cn(
              "text-xl font-semibold leading-tight pr-8",
              decision.supersededBy && "line-through opacity-60"
            )}>
              {decision.title}
            </SheetTitle>

            {/* Topics */}
            {decision.topics && decision.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {decision.topics.map((topic) => (
                  <Badge key={topic.id} variant="secondary" className="text-xs">
                    {topic.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* AI Confidence */}
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">AI Confidence</span>
                  <span className={cn(
                    "font-medium",
                    decision.confidence >= 0.8 && "text-green-600",
                    decision.confidence >= 0.5 && decision.confidence < 0.8 && "text-amber-600",
                    decision.confidence < 0.5 && "text-red-600"
                  )}>
                    {Math.round(decision.confidence * 100)}%
                  </span>
                </div>
                <Progress
                  value={decision.confidence * 100}
                  className="h-1.5"
                />
              </div>
            </div>
          </SheetHeader>
        </div>

        <Separator />

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          {/* Decision Statement */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Decision Statement
              </h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyStatement}
                className="h-7 text-xs"
              >
                <Copy className="h-3 w-3 mr-1.5" />
                Copy
              </Button>
            </div>
            <div className={cn(
              "p-4 rounded-lg border-2",
              isActive ? "border-purple-500/30 bg-purple-500/5" : "border-border bg-muted/30"
            )}>
              <p className={cn(
                "text-sm leading-relaxed",
                decision.supersededBy && "line-through opacity-60"
              )}>
                {decision.statement}
              </p>
            </div>
          </div>

          {/* Supersession Alert */}
          {decision.supersededBy && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    This decision has been superseded
                  </p>
                  <button
                    type="button"
                    onClick={() => onViewSupersession?.(decision.supersededBy!.id)}
                    className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 hover:underline"
                  >
                    <GitBranch className="h-4 w-4" />
                    View: {decision.supersededBy.title}
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rationale */}
          {decision.rationale && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5" />
                Rationale
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {decision.rationale}
              </p>
            </div>
          )}

          {/* Alternatives Considered */}
          {decision.alternatives && decision.alternatives.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <XCircle className="h-3.5 w-3.5" />
                Alternatives Considered
              </h4>
              <div className="space-y-2">
                {decision.alternatives.map((alt, index) => (
                  <div key={index} className="p-3 rounded-lg bg-muted/50 border-l-2 border-muted-foreground/30">
                    <p className="text-sm font-medium text-muted-foreground">
                      {alt.option}
                    </p>
                    {alt.reason && (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {alt.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decision Makers */}
          {decision.owners && decision.owners.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Decision Makers
              </h4>
              <div className="space-y-2">
                {decision.owners.map((owner) => (
                  <button
                    key={owner.id}
                    type="button"
                    onClick={() => onContactClick?.(owner.primaryEmail)}
                    className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-purple-500/10 text-purple-600 text-sm font-medium">
                        {getInitials(owner.displayName, owner.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {owner.displayName ?? owner.primaryEmail}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {owner.primaryEmail}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Evidence */}
          {(decision.evidence?.length || decision.metadata?.originalText) && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-3.5 w-3.5" />
                Evidence
              </h4>
              <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                <p className="text-sm italic text-muted-foreground leading-relaxed">
                  "{decision.metadata?.originalText || decision.evidence?.[0]}"
                </p>
                {decision.metadata?.extractedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Extracted {formatDistanceToNow(new Date(decision.metadata.extractedAt), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Decision Chain */}
          {decision.supersedes && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5" />
                Replaces Previous Decision
              </h4>
              <button
                type="button"
                onClick={() => onViewSupersession?.(decision.supersedes!.id)}
                className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-lg bg-gray-500/10 flex items-center justify-center">
                  <GitBranch className="h-5 w-5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate line-through opacity-60">
                    {decision.supersedes.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Made on {format(decision.supersedes.decidedAt, "MMMM d, yyyy")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Source Thread */}
          {decision.sourceThread && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Source
              </h4>
              <button
                type="button"
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
                className="flex items-center gap-3 w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left group"
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {decision.sourceThread.subject ?? "Email thread"}
                  </p>
                  {decision.sourceThread.snippet && (
                    <p className="text-xs text-muted-foreground truncate">
                      {decision.sourceThread.snippet}
                    </p>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
            </div>
          )}
        </div>

        <Separator />

        {/* Actions Footer */}
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCopyStatement}
              className="flex-1"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy Statement
            </Button>
            {decision.sourceThread && (
              <Button
                variant="outline"
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
                className="flex-1"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Source
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            {!decision.isUserVerified && onVerify && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onVerify(decision.id)}
                className="flex-1"
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                Verify
              </Button>
            )}
            {onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDismiss(decision.id)}
                className="flex-1 text-destructive hover:text-destructive"
              >
                <ThumbsDown className="h-3.5 w-3.5 mr-1.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
