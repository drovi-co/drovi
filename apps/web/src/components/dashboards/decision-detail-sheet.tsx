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

  const isActive = !(decision.isSuperseded || decision.supersededBy);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="flex w-[480px] flex-col p-0 sm:w-[540px]">
        {/* Header with purple gradient for decisions */}
        <div
          className={cn(
            "px-6 pt-6 pb-4",
            isActive
              ? "bg-gradient-to-b from-purple-500/10 to-transparent"
              : "bg-gradient-to-b from-gray-500/5 to-transparent"
          )}
        >
          <SheetHeader className="space-y-4">
            {/* Status badges */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {decision.supersededBy ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-amber-600 text-xs">
                    <AlertTriangle className="h-3 w-3" />
                    Superseded
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-1 text-purple-600 text-xs">
                    <Lightbulb className="h-3 w-3" />
                    Active Decision
                  </span>
                )}
                {decision.isUserVerified && (
                  <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-1 text-green-600 text-xs">
                    <ThumbsUp className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>
              <span className="text-muted-foreground text-xs">
                {format(decision.decidedAt, "MMMM d, yyyy")}
              </span>
            </div>

            {/* Title */}
            <SheetTitle
              className={cn(
                "pr-8 font-semibold text-xl leading-tight",
                decision.supersededBy && "line-through opacity-60"
              )}
            >
              {decision.title}
            </SheetTitle>

            {/* Topics */}
            {decision.topics && decision.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {decision.topics.map((topic) => (
                  <Badge className="text-xs" key={topic.id} variant="secondary">
                    {topic.name}
                  </Badge>
                ))}
              </div>
            )}

            {/* AI Confidence */}
            <div className="flex items-center gap-3">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">AI Confidence</span>
                  <span
                    className={cn(
                      "font-medium",
                      decision.confidence >= 0.8 && "text-green-600",
                      decision.confidence >= 0.5 &&
                        decision.confidence < 0.8 &&
                        "text-amber-600",
                      decision.confidence < 0.5 && "text-red-600"
                    )}
                  >
                    {Math.round(decision.confidence * 100)}%
                  </span>
                </div>
                <Progress className="h-1.5" value={decision.confidence * 100} />
              </div>
            </div>
          </SheetHeader>
        </div>

        <Separator />

        {/* Content */}
        <div className="flex-1 space-y-6 overflow-auto px-6 py-4">
          {/* Decision Statement */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Decision Statement
              </h4>
              <Button
                className="h-7 text-xs"
                onClick={handleCopyStatement}
                size="sm"
                variant="ghost"
              >
                <Copy className="mr-1.5 h-3 w-3" />
                Copy
              </Button>
            </div>
            <div
              className={cn(
                "rounded-lg border-2 p-4",
                isActive
                  ? "border-purple-500/30 bg-purple-500/5"
                  : "border-border bg-muted/30"
              )}
            >
              <p
                className={cn(
                  "text-sm leading-relaxed",
                  decision.supersededBy && "line-through opacity-60"
                )}
              >
                {decision.statement}
              </p>
            </div>
          </div>

          {/* Supersession Alert */}
          {decision.supersededBy && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="space-y-2">
                  <p className="font-medium text-amber-800 text-sm dark:text-amber-200">
                    This decision has been superseded
                  </p>
                  <button
                    className="flex items-center gap-2 text-amber-700 text-sm hover:underline dark:text-amber-300"
                    onClick={() =>
                      onViewSupersession?.(decision.supersededBy!.id)
                    }
                    type="button"
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
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <Lightbulb className="h-3.5 w-3.5" />
                Rationale
              </h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {decision.rationale}
              </p>
            </div>
          )}

          {/* Alternatives Considered */}
          {decision.alternatives && decision.alternatives.length > 0 && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <XCircle className="h-3.5 w-3.5" />
                Alternatives Considered
              </h4>
              <div className="space-y-2">
                {decision.alternatives.map((alt, index) => (
                  <div
                    className="rounded-lg border-muted-foreground/30 border-l-2 bg-muted/50 p-3"
                    key={index}
                  >
                    <p className="font-medium text-muted-foreground text-sm">
                      {alt.option}
                    </p>
                    {alt.reason && (
                      <p className="mt-1 text-muted-foreground/70 text-xs">
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
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <Users className="h-3.5 w-3.5" />
                Decision Makers
              </h4>
              <div className="space-y-2">
                {decision.owners.map((owner) => (
                  <button
                    className="flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                    key={owner.id}
                    onClick={() => onContactClick?.(owner.primaryEmail)}
                    type="button"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-purple-500/10 font-medium text-purple-600 text-sm">
                        {getInitials(owner.displayName, owner.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {owner.displayName ?? owner.primaryEmail}
                      </p>
                      <p className="truncate text-muted-foreground text-xs">
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
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <FileText className="h-3.5 w-3.5" />
                Evidence
              </h4>
              <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
                <p className="text-muted-foreground text-sm italic leading-relaxed">
                  "{decision.metadata?.originalText || decision.evidence?.[0]}"
                </p>
                {decision.metadata?.extractedAt && (
                  <p className="mt-2 text-muted-foreground text-xs">
                    Extracted{" "}
                    {formatDistanceToNow(
                      new Date(decision.metadata.extractedAt),
                      { addSuffix: true }
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Decision Chain */}
          {decision.supersedes && (
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                <GitBranch className="h-3.5 w-3.5" />
                Replaces Previous Decision
              </h4>
              <button
                className="group flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                onClick={() => onViewSupersession?.(decision.supersedes!.id)}
                type="button"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-500/10">
                  <GitBranch className="h-5 w-5 text-gray-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm line-through opacity-60">
                    {decision.supersedes.title}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Made on{" "}
                    {format(decision.supersedes.decidedAt, "MMMM d, yyyy")}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Source Thread */}
          {decision.sourceThread && (
            <div className="space-y-3">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Source
              </h4>
              <button
                className="group flex w-full items-center gap-3 rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
                type="button"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">
                    {decision.sourceThread.subject ?? "Email thread"}
                  </p>
                  {decision.sourceThread.snippet && (
                    <p className="truncate text-muted-foreground text-xs">
                      {decision.sourceThread.snippet}
                    </p>
                  )}
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </button>
            </div>
          )}
        </div>

        <Separator />

        {/* Actions Footer */}
        <div className="space-y-3 p-4">
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleCopyStatement}
              variant="outline"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Statement
            </Button>
            {decision.sourceThread && (
              <Button
                className="flex-1"
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
                variant="outline"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View Source
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            {!decision.isUserVerified && onVerify && (
              <Button
                className="flex-1"
                onClick={() => onVerify(decision.id)}
                size="sm"
                variant="outline"
              >
                <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
                Verify
              </Button>
            )}
            {onDismiss && (
              <Button
                className="flex-1 text-destructive hover:text-destructive"
                onClick={() => onDismiss(decision.id)}
                size="sm"
                variant="ghost"
              >
                <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
