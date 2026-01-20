// =============================================================================
// SUPERSESSION CHAIN COMPONENT
// =============================================================================
//
// Visual representation of how a decision evolved over time.
// Shows the chain: Decision A → B → C with timestamps and ability to
// navigate to any version. Critical for understanding decision history.
//

import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  GitBranch,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface SupersessionChainItem {
  id: string;
  title: string;
  statement: string;
  decidedAt: Date;
  isCurrent: boolean;
  supersededAt?: Date;
  confidence?: number;
}

export interface SupersessionChainProps {
  /** The chain of decisions, ordered from oldest to newest */
  chain: SupersessionChainItem[];
  /** Currently selected decision ID */
  currentDecisionId: string;
  /** Callback when a decision is clicked */
  onDecisionClick: (decisionId: string) => void;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Optional class name */
  className?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SupersessionChain({
  chain,
  currentDecisionId,
  onDecisionClick,
  compact = false,
  className,
}: SupersessionChainProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  if (chain.length <= 1) {
    return null; // No chain to show
  }

  const currentIndex = chain.findIndex((d) => d.id === currentDecisionId);
  const activeDecision = chain.find((d) => d.isCurrent);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            className="h-auto w-full justify-between px-3 py-2"
            size="sm"
            variant="ghost"
          >
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-purple-500" />
              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
                Decision Evolution
              </span>
              <Badge className="text-[10px]" variant="secondary">
                {chain.length} versions
              </Badge>
            </div>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-0">
          {/* Visual Chain */}
          <div className="relative pt-2 pl-4">
            {/* Vertical line connecting all items */}
            <div className="absolute top-4 bottom-4 left-[1.375rem] w-0.5 bg-gradient-to-b from-muted-foreground/20 via-purple-500/40 to-muted-foreground/20" />

            {chain.map((item, index) => {
              const isSelected = item.id === currentDecisionId;
              const isCurrent = item.isCurrent;
              const isOlder = index < currentIndex;
              const isNewer = index > currentIndex;

              return (
                <div className="relative" key={item.id}>
                  {/* Chain Item */}
                  <button
                    className={cn(
                      "relative flex w-full items-start gap-3 rounded-lg p-3 text-left transition-all",
                      "hover:bg-accent/50",
                      isSelected && "bg-accent",
                      !isSelected && isCurrent && "bg-purple-500/5"
                    )}
                    onClick={() => onDecisionClick(item.id)}
                    type="button"
                  >
                    {/* Timeline Node */}
                    <div
                      className={cn(
                        "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isCurrent &&
                          "border-purple-500 bg-purple-500 text-white",
                        !isCurrent &&
                          isSelected &&
                          "border-purple-500 bg-background",
                        !(isCurrent || isSelected) &&
                          "border-muted-foreground/30 bg-background"
                      )}
                    >
                      {isCurrent ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate font-medium text-sm",
                            !isCurrent && "text-muted-foreground line-through"
                          )}
                        >
                          {item.title}
                        </span>
                        {isCurrent && (
                          <Badge
                            className="bg-purple-500 text-[10px]"
                            variant="default"
                          >
                            Current
                          </Badge>
                        )}
                        {isSelected && !isCurrent && (
                          <Badge className="text-[10px]" variant="outline">
                            Viewing
                          </Badge>
                        )}
                      </div>

                      {/* Date and confidence */}
                      <div className="flex items-center gap-3 text-muted-foreground text-xs">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(item.decidedAt, "MMM d, yyyy")}
                        </span>
                        {item.confidence !== undefined && (
                          <span className="flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            {Math.round(item.confidence * 100)}%
                          </span>
                        )}
                      </div>

                      {/* Statement preview */}
                      {!compact && (
                        <p
                          className={cn(
                            "line-clamp-2 text-muted-foreground text-xs leading-relaxed",
                            !isCurrent && "opacity-60"
                          )}
                        >
                          {item.statement}
                        </p>
                      )}

                      {/* Superseded info */}
                      {item.supersededAt && (
                        <p className="text-[10px] text-amber-600">
                          Superseded{" "}
                          {formatDistanceToNow(item.supersededAt, {
                            addSuffix: true,
                          })}
                        </p>
                      )}
                    </div>

                    {/* Arrow indicator for navigation hint */}
                    {!isSelected && (
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Collapsed summary */}
      {!isExpanded && activeDecision && (
        <div className="flex items-center gap-2 px-3 text-muted-foreground text-xs">
          <span>
            Latest: <span className="font-medium">{activeDecision.title}</span>
          </span>
          <span className="text-muted-foreground/50">•</span>
          <span>{format(activeDecision.decidedAt, "MMM d, yyyy")}</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// INLINE CHAIN (Compact horizontal version)
// =============================================================================

interface InlineSupersessionChainProps {
  chain: SupersessionChainItem[];
  currentDecisionId: string;
  onDecisionClick: (decisionId: string) => void;
}

/**
 * Compact horizontal chain display for use in cards and small spaces.
 * Shows: [Old] → [Old] → [Current]
 */
export function InlineSupersessionChain({
  chain,
  currentDecisionId,
  onDecisionClick,
}: InlineSupersessionChainProps) {
  if (chain.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto text-xs">
      {chain.map((item, index) => (
        <div className="flex shrink-0 items-center gap-1" key={item.id}>
          <button
            className={cn(
              "max-w-[120px] truncate rounded px-2 py-0.5 transition-colors",
              item.isCurrent
                ? "bg-purple-500/10 font-medium text-purple-600"
                : "bg-muted text-muted-foreground line-through hover:bg-muted/80",
              item.id === currentDecisionId && "ring-1 ring-purple-500"
            )}
            onClick={() => onDecisionClick(item.id)}
            type="button"
          >
            {item.title}
          </button>
          {index < chain.length - 1 && (
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
        </div>
      ))}
    </div>
  );
}

export default SupersessionChain;
