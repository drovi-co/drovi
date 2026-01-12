// =============================================================================
// DECISION CARD COMPONENT
// =============================================================================
//
// Intelligence-first decision display with rationale, supersession chain,
// evidence links, and confidence indicators. Decisions aren't static - they
// evolve, and this component shows that history.
//

import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  ThumbsDown,
  ThumbsUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface DecisionCardData {
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
  alternatives?: Array<{
    option: string;
    reason?: string;
  }>;
  topics?: Array<{
    id: string;
    name: string;
  }>;
}

interface DecisionCardProps {
  decision: DecisionCardData;
  isSelected?: boolean;
  onSelect?: () => void;
  onDismiss?: (decisionId: string) => void;
  onVerify?: (decisionId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onViewSupersession?: (decisionId: string) => void;
  compact?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function DecisionCard({
  decision,
  isSelected = false,
  onSelect,
  onDismiss,
  onVerify,
  onThreadClick,
  onContactClick,
  onViewSupersession,
  compact = false,
}: DecisionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopyStatement = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success("Decision statement copied");
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "group relative border-l-4 rounded-lg bg-card transition-all",
        "hover:shadow-md cursor-pointer",
        decision.isSuperseded || decision.supersededBy
          ? "border-l-muted opacity-70"
          : "border-l-purple-500",
        isSelected && "ring-2 ring-primary",
        compact ? "p-3" : "p-4"
      )}
      onClick={onSelect}
    >
      {/* Superseded Warning */}
      {decision.supersededBy && (
        <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded flex items-center gap-2 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          <span className="text-amber-700 dark:text-amber-400">
            Superseded by: {decision.supersededBy.title}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 ml-auto text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onViewSupersession?.(decision.id);
            }}
          >
            View chain
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      )}

      {/* Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Expand/Collapse Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className={cn(
              "font-medium text-foreground",
              compact ? "text-sm" : "text-base",
              decision.supersededBy && "line-through opacity-75"
            )}>
              {decision.title}
            </h3>

            {/* Statement */}
            <p className={cn(
              "text-sm text-muted-foreground mt-1 line-clamp-2",
              decision.supersededBy && "line-through"
            )}>
              {decision.statement}
            </p>

            {/* Meta Row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {/* Date */}
              <span className="text-xs text-muted-foreground">
                {format(decision.decidedAt, "MMM d, yyyy")}
              </span>

              <span className="text-muted-foreground">•</span>

              {/* Owners */}
              {decision.owners && decision.owners.length > 0 && (
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  {decision.owners.slice(0, 2).map((owner, i) => (
                    <button
                      key={owner.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onContactClick?.(owner.primaryEmail);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {owner.displayName ?? owner.primaryEmail.split("@")[0]}
                      {i < Math.min(decision.owners!.length - 1, 1) && ", "}
                    </button>
                  ))}
                  {decision.owners.length > 2 && (
                    <span className="text-xs text-muted-foreground">
                      +{decision.owners.length - 2}
                    </span>
                  )}
                </div>
              )}

              {/* Confidence */}
              <span className={cn(
                "text-xs",
                decision.confidence >= 0.8 && "text-green-600 dark:text-green-400",
                decision.confidence >= 0.5 && decision.confidence < 0.8 && "text-amber-600 dark:text-amber-400",
                decision.confidence < 0.5 && "text-red-600 dark:text-red-400"
              )}>
                {Math.round(decision.confidence * 100)}%
              </span>

              {/* User Verified Badge */}
              {decision.isUserVerified && (
                <Badge variant="outline" className="text-xs h-5">
                  <Check className="h-3 w-3 mr-1" />
                  Verified
                </Badge>
              )}
            </div>

            {/* Topics */}
            {decision.topics && decision.topics.length > 0 && (
              <div className="flex items-center gap-1 mt-2">
                {decision.topics.map((topic) => (
                  <Badge key={topic.id} variant="secondary" className="text-xs">
                    {topic.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Supersession indicator */}
          {(decision.supersededBy || decision.isSuperseded) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onViewSupersession?.(decision.id);
              }}
              title="View decision evolution"
            >
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}

          {/* Copy */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              handleCopyStatement();
            }}
            title="Copy statement"
          >
            <Copy className="h-4 w-4" />
          </Button>

          {/* More Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyStatement}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Statement
              </DropdownMenuItem>
              {decision.sourceThread && (
                <DropdownMenuItem
                  onClick={() => onThreadClick?.(decision.sourceThread!.id)}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Source Thread
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!decision.isUserVerified && onVerify && (
                <DropdownMenuItem onClick={() => onVerify(decision.id)}>
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Verify (Correct)
                </DropdownMenuItem>
              )}
              {onDismiss && (
                <DropdownMenuItem onClick={() => onDismiss(decision.id)} className="text-destructive">
                  <ThumbsDown className="h-4 w-4 mr-2" />
                  Dismiss (Incorrect)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-4 pt-4 border-t space-y-4"
        >
          {/* Rationale */}
          {decision.rationale && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Rationale:</span>
              <p className="text-sm text-foreground">
                {decision.rationale}
              </p>
            </div>
          )}

          {/* Alternatives Considered */}
          {decision.alternatives && decision.alternatives.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Alternatives Considered:
              </span>
              <div className="space-y-1.5">
                {decision.alternatives.map((alt, i) => (
                  <div
                    key={i}
                    className="text-sm pl-3 border-l-2 border-muted"
                  >
                    <span className="font-medium">{alt.option}</span>
                    {alt.reason && (
                      <span className="text-muted-foreground">
                        {" - "}{alt.reason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Thread */}
          {decision.sourceThread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onThreadClick?.(decision.sourceThread!.id);
              }}
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="truncate">
                From: {decision.sourceThread.subject ?? "Email thread"}
              </span>
            </button>
          )}

          {/* Evidence */}
          {decision.evidence && decision.evidence.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Evidence:</span>
              {decision.evidence.map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground italic pl-2 border-l-2 border-muted">
                  "{e}"
                </p>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
