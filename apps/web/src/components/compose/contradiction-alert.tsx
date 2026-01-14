// =============================================================================
// CONTRADICTION ALERT COMPONENT
// =============================================================================
//
// Real-time contradiction detection in compose. This is a P0 feature per the
// strategic plan - catching contradictions before they're sent is crucial for
// trust and accountability.
//

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  GitCompare,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface Contradiction {
  id: string;
  type: "commitment" | "decision" | "statement";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  originalStatement: string;
  originalSource: {
    type: "commitment" | "decision" | "message";
    id: string;
    title?: string;
    threadSubject?: string;
    date?: Date;
  };
  conflictingText: string;
  confidence: number;
  suggestion?: string;
}

export interface ContradictionAlertProps {
  /** Current draft content */
  draftContent: string;
  /** Subject line if available */
  subject?: string;
  /** Recipients */
  recipients?: Array<{ email: string; name?: string }>;
  /** Thread ID if replying */
  threadId?: string;
  /** Account ID */
  accountId?: string;
  /** Organization ID */
  organizationId: string;
  /** Callback when user wants to view evidence */
  onViewEvidence?: (sourceId: string, sourceType: string) => void;
  /** Callback when user acknowledges contradiction */
  onAcknowledge?: (contradictionId: string) => void;
  /** Callback when contradictions change */
  onContradictionsChange?: (contradictions: Contradiction[]) => void;
  /** Minimum content length to trigger analysis */
  minContentLength?: number;
  /** Debounce delay in ms */
  debounceMs?: number;
}

// =============================================================================
// HOOK: USE DEBOUNCED VALUE
// =============================================================================

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// =============================================================================
// MOCK CONTRADICTION CHECK (TO BE REPLACED WITH REAL API)
// =============================================================================

async function checkContradictions(
  draftContent: string,
  _context: {
    threadId?: string;
    recipients?: Array<{ email: string; name?: string }>;
    organizationId: string;
  }
): Promise<Contradiction[]> {
  // This is a placeholder - in production this would call the API
  // The actual contradiction detection happens in the risk analysis task

  // For demo purposes, check for some common contradiction patterns
  const contradictions: Contradiction[] = [];
  const lowerContent = draftContent.toLowerCase();

  // Example: Check for delivery date conflicts
  if (
    (lowerContent.includes("deliver") || lowerContent.includes("ship")) &&
    (lowerContent.includes("next week") ||
      lowerContent.includes("friday") ||
      lowerContent.includes("monday"))
  ) {
    // Mock contradiction - in reality this would be detected by the AI
    // based on actual previous commitments
  }

  return contradictions;
}

// =============================================================================
// SEVERITY CONFIG
// =============================================================================

const severityConfig = {
  low: {
    color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    icon: AlertTriangle,
    label: "Minor inconsistency",
  },
  medium: {
    color: "text-orange-600 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800",
    icon: AlertTriangle,
    label: "Potential conflict",
  },
  high: {
    color: "text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
    icon: AlertTriangle,
    label: "Significant contradiction",
  },
  critical: {
    color: "text-red-700 bg-red-100 dark:bg-red-950/50 border-red-300 dark:border-red-700",
    icon: AlertTriangle,
    label: "Critical contradiction",
  },
};

// =============================================================================
// COMPONENT
// =============================================================================

export function ContradictionAlert({
  draftContent,
  subject,
  recipients,
  threadId,
  accountId,
  organizationId,
  onViewEvidence,
  onAcknowledge,
  onContradictionsChange,
  minContentLength = 50,
  debounceMs = 1500,
}: ContradictionAlertProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  // Debounce the draft content
  const debouncedContent = useDebouncedValue(draftContent, debounceMs);

  // Check if we should analyze
  const shouldAnalyze = useMemo(() => {
    return (
      debouncedContent.length >= minContentLength &&
      accountId &&
      organizationId &&
      !dismissed
    );
  }, [debouncedContent.length, minContentLength, accountId, organizationId, dismissed]);

  // Query for contradictions
  const { data: analysisData, isLoading } = useQuery({
    queryKey: ["contradiction-check", debouncedContent, threadId],
    enabled: Boolean(shouldAnalyze),
    queryFn: async (): Promise<{ contradictions: Contradiction[] }> => {
      if (!accountId) return { contradictions: [] };

      // Use the local mock for now - replace with actual API call
      const contradictions = await checkContradictions(debouncedContent, {
        threadId,
        recipients,
        organizationId,
      });

      return { contradictions };
    },
    staleTime: 30_000, // Cache for 30 seconds
    gcTime: 60_000, // Keep in cache for 1 minute
    retry: false,
  });

  const contradictions = useMemo((): Contradiction[] => {
    if (!analysisData?.contradictions) return [];
    return analysisData.contradictions.filter((c: Contradiction) => !acknowledged.has(c.id));
  }, [analysisData?.contradictions, acknowledged]);

  // Notify parent of contradictions
  useEffect(() => {
    onContradictionsChange?.(contradictions);
  }, [contradictions, onContradictionsChange]);

  const handleAcknowledge = useCallback(
    (id: string) => {
      setAcknowledged((prev) => new Set([...prev, id]));
      onAcknowledge?.(id);
      toast.success("Contradiction acknowledged");
    },
    [onAcknowledge]
  );

  const handleDismissAll = useCallback(() => {
    setDismissed(true);
    toast.info("Contradiction checking paused for this draft");
  }, []);

  // Don't render if no content or dismissed
  if (draftContent.length < minContentLength || dismissed) {
    return null;
  }

  // Don't render if no contradictions and not loading
  if (!isLoading && contradictions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Header */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full flex items-center justify-between px-4 py-2 text-left transition-colors",
              contradictions.length > 0
                ? "bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50"
                : "bg-muted/50 hover:bg-muted"
            )}
          >
            <div className="flex items-center gap-2">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Checking for contradictions...
                  </span>
                </>
              ) : contradictions.length > 0 ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {contradictions.length} potential contradiction
                    {contradictions.length > 1 ? "s" : ""} found
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-300">
                    No contradictions detected
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {contradictions.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismissAll();
                  }}
                  className="h-6 px-2 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Dismiss
                </Button>
              )}
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {contradictions.length > 0 && (
            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-2">
                {contradictions.map((contradiction: Contradiction) => (
                  <ContradictionItem
                    key={contradiction.id}
                    contradiction={contradiction}
                    onViewEvidence={onViewEvidence}
                    onAcknowledge={() => handleAcknowledge(contradiction.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// =============================================================================
// CONTRADICTION ITEM
// =============================================================================

interface ContradictionItemProps {
  contradiction: Contradiction;
  onViewEvidence?: (sourceId: string, sourceType: string) => void;
  onAcknowledge: () => void;
}

function ContradictionItem({
  contradiction,
  onViewEvidence,
  onAcknowledge,
}: ContradictionItemProps) {
  const [showComparison, setShowComparison] = useState(false);
  const config = severityConfig[contradiction.severity];
  const Icon = config.icon;

  return (
    <div className={cn("rounded-lg border p-3 space-y-3", config.color)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">{contradiction.description}</p>
            <p className="text-xs opacity-70 mt-0.5">{config.label}</p>
          </div>
        </div>
        <span
          className={cn(
            "text-xs font-medium px-1.5 py-0.5 rounded",
            contradiction.confidence >= 0.8
              ? "bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-200"
              : contradiction.confidence >= 0.5
                ? "bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200"
                : "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
          )}
        >
          {Math.round(contradiction.confidence * 100)}% confident
        </span>
      </div>

      {/* Source Reference */}
      <div className="text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>Conflicts with</span>
          {contradiction.originalSource.type === "commitment" && (
            <span className="font-medium text-blue-600 dark:text-blue-400">
              Commitment
            </span>
          )}
          {contradiction.originalSource.type === "decision" && (
            <span className="font-medium text-purple-600 dark:text-purple-400">
              Decision
            </span>
          )}
          {contradiction.originalSource.type === "message" && (
            <span className="font-medium">Previous message</span>
          )}
          {contradiction.originalSource.date && (
            <span className="text-muted-foreground">
              from {format(contradiction.originalSource.date, "MMM d, yyyy")}
            </span>
          )}
        </div>
        {contradiction.originalSource.title && (
          <p className="font-medium mt-1">{contradiction.originalSource.title}</p>
        )}
      </div>

      {/* Toggle Comparison */}
      <button
        type="button"
        onClick={() => setShowComparison(!showComparison)}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <GitCompare className="h-3 w-3" />
        {showComparison ? "Hide comparison" : "Show comparison"}
      </button>

      {/* Side-by-side comparison */}
      {showComparison && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-background/50 border">
            <p className="font-medium text-muted-foreground mb-1">
              Your draft says:
            </p>
            <p className="text-red-600 dark:text-red-400">
              "{contradiction.conflictingText}"
            </p>
          </div>
          <div className="p-2 rounded bg-background/50 border">
            <p className="font-medium text-muted-foreground mb-1">
              Previously stated:
            </p>
            <p className="text-green-600 dark:text-green-400">
              "{contradiction.originalStatement}"
            </p>
          </div>
        </div>
      )}

      {/* Suggestion */}
      {contradiction.suggestion && (
        <div className="text-xs p-2 rounded bg-background/50 border">
          <p className="font-medium text-muted-foreground mb-1">Suggestion:</p>
          <p>{contradiction.suggestion}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onViewEvidence && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onViewEvidence(
                contradiction.originalSource.id,
                contradiction.originalSource.type
              )
            }
          >
            <Eye className="h-3 w-3 mr-1" />
            View evidence
          </Button>
        )}
        {contradiction.originalSource.threadSubject && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onViewEvidence?.(
                contradiction.originalSource.id,
                "thread"
              )
            }
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            View thread
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs ml-auto"
          onClick={onAcknowledge}
        >
          <CheckCircle className="h-3 w-3 mr-1" />
          Acknowledge & proceed
        </Button>
      </div>
    </div>
  );
}

export default ContradictionAlert;
