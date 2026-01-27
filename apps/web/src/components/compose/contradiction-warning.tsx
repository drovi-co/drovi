// =============================================================================
// CONTRADICTION WARNING COMPONENT
// =============================================================================
//
// Pre-send safety barrier - shows contradictions detected in draft content
// before the user sends an email. This is the trust-building feature that
// prevents mistakes before they happen.
//

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Lightbulb,
  Shield,
  X,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export interface Contradiction {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  draftStatement: string;
  conflictingStatement: string;
  conflictingType: "commitment" | "decision";
  conflictingId: string;
  conflictingDate: Date;
  conflictingParty?: string;
  conflictingThreadId?: string | null;
  suggestion: string;
}

export interface ContradictionCheckResult {
  canSend: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  contradictions: Contradiction[];
  newCommitments: string[];
  checkedAgainst: {
    commitments: number;
    decisions: number;
  };
  timestamp: Date;
}

interface ContradictionWarningProps {
  result: ContradictionCheckResult | null;
  isLoading?: boolean;
  onDismiss?: () => void;
  onProceedAnyway?: () => void;
  onViewThread?: (threadId: string) => void;
  onEditDraft?: () => void;
}

// =============================================================================
// HELPERS
// =============================================================================

function getSeverityConfig(severity: string) {
  switch (severity) {
    case "critical":
      return {
        color:
          "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/50 dark:border-red-900",
        icon: AlertTriangle,
        label: "Critical",
        badgeVariant: "destructive" as const,
      };
    case "high":
      return {
        color:
          "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950/50 dark:border-orange-900",
        icon: AlertTriangle,
        label: "High",
        badgeVariant: "destructive" as const,
      };
    case "medium":
      return {
        color:
          "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:border-amber-900",
        icon: Info,
        label: "Medium",
        badgeVariant: "secondary" as const,
      };
    default:
      return {
        color:
          "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/50 dark:border-blue-900",
        icon: Info,
        label: "Low",
        badgeVariant: "outline" as const,
      };
  }
}

function getRiskLevelConfig(level: string) {
  switch (level) {
    case "critical":
      return {
        title: "Critical Risk Detected",
        description:
          "This message contradicts previous statements. Sending is blocked.",
        alertVariant: "destructive" as const,
        canSend: false,
      };
    case "high":
      return {
        title: "High Risk Detected",
        description:
          "Potential contradictions found. Please review before sending.",
        alertVariant: "destructive" as const,
        canSend: true,
      };
    case "medium":
      return {
        title: "Possible Inconsistency",
        description: "Some statements may need verification.",
        alertVariant: "default" as const,
        canSend: true,
      };
    default:
      return {
        title: "All Clear",
        description: "No contradictions detected.",
        alertVariant: "default" as const,
        canSend: true,
      };
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ContradictionWarning({
  result,
  isLoading = false,
  onDismiss,
  onProceedAnyway,
  onViewThread,
  onEditDraft,
}: ContradictionWarningProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (isLoading) {
    return (
      <Alert className="border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/50">
        <Shield className="h-4 w-4 animate-pulse text-purple-600" />
        <AlertTitle className="text-purple-800 dark:text-purple-200">
          Checking for contradictions...
        </AlertTitle>
        <AlertDescription className="text-purple-700 dark:text-purple-300">
          Analyzing your draft against{" "}
          {result?.checkedAgainst?.commitments ?? "..."} commitments and{" "}
          {result?.checkedAgainst?.decisions ?? "..."} decisions.
        </AlertDescription>
      </Alert>
    );
  }

  if (!result) {
    return null;
  }

  // No contradictions - show success state briefly
  if (result.contradictions.length === 0 && result.riskLevel === "low") {
    return (
      <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertTitle className="text-green-800 dark:text-green-200">
          No contradictions detected
        </AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          Checked against {result.checkedAgainst.commitments} commitments and{" "}
          {result.checkedAgainst.decisions} decisions.
        </AlertDescription>
      </Alert>
    );
  }

  const riskConfig = getRiskLevelConfig(result.riskLevel);
  const hasCritical = result.contradictions.some(
    (c) => c.severity === "critical"
  );

  return (
    <div className="space-y-3">
      {/* Main Warning Alert */}
      <Alert
        className={cn(
          hasCritical &&
            "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/50"
        )}
        variant={riskConfig.alertVariant}
      >
        <AlertTriangle
          className={cn(
            "h-4 w-4",
            hasCritical ? "text-red-600" : "text-amber-600"
          )}
        />
        <AlertTitle className="flex items-center justify-between">
          <span>{riskConfig.title}</span>
          {onDismiss && (
            <button
              className="rounded p-1 hover:bg-background/50"
              onClick={onDismiss}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </AlertTitle>
        <AlertDescription>
          <p className="mb-2">{riskConfig.description}</p>
          <p className="text-xs opacity-75">
            Found {result.contradictions.length} issue(s) from checking{" "}
            {result.checkedAgainst.commitments} commitments and{" "}
            {result.checkedAgainst.decisions} decisions.
          </p>
        </AlertDescription>
      </Alert>

      {/* Contradiction Details */}
      <Collapsible onOpenChange={setIsExpanded} open={isExpanded}>
        <CollapsibleTrigger asChild>
          <Button
            className="w-full justify-between px-3"
            size="sm"
            variant="ghost"
          >
            <span className="font-medium text-sm">
              {isExpanded ? "Hide details" : "Show details"}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-3 pt-2">
          {result.contradictions.map((contradiction) => {
            const config = getSeverityConfig(contradiction.severity);
            const SeverityIcon = config.icon;

            return (
              <div
                className={cn("space-y-3 rounded-lg border p-4", config.color)}
                key={contradiction.id}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SeverityIcon className="h-4 w-4 shrink-0" />
                    <Badge
                      className="text-[10px]"
                      variant={config.badgeVariant}
                    >
                      {config.label}
                    </Badge>
                    <Badge className="text-[10px] capitalize" variant="outline">
                      {contradiction.conflictingType}
                    </Badge>
                  </div>
                  {contradiction.conflictingThreadId && onViewThread && (
                    <Button
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        onViewThread(contradiction.conflictingThreadId!)
                      }
                      size="sm"
                      variant="ghost"
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View Source
                    </Button>
                  )}
                </div>

                {/* What you wrote */}
                <div>
                  <p className="mb-1 font-medium text-xs opacity-75">
                    In your draft:
                  </p>
                  <p className="font-medium text-sm">
                    {contradiction.draftStatement}
                  </p>
                </div>

                {/* Conflicting statement */}
                <div className="border-current/30 border-l-2 pl-3">
                  <p className="mb-1 font-medium text-xs opacity-75">
                    But previously (
                    {formatDistanceToNow(contradiction.conflictingDate, {
                      addSuffix: true,
                    })}
                    {contradiction.conflictingParty &&
                      ` with ${contradiction.conflictingParty}`}
                    ):
                  </p>
                  <p className="text-sm italic">
                    "{contradiction.conflictingStatement}"
                  </p>
                </div>

                {/* Suggestion */}
                <div className="flex items-start gap-2 pt-1">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p className="text-xs">{contradiction.suggestion}</p>
                </div>
              </div>
            );
          })}

          {/* New Commitments Warning */}
          {result.newCommitments.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
              <div className="mb-2 flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-800 text-sm dark:text-blue-200">
                  New commitments detected
                </span>
              </div>
              <p className="mb-2 text-blue-700 text-xs dark:text-blue-300">
                This message appears to make new promises. They will be tracked
                automatically.
              </p>
              <ul className="space-y-1">
                {result.newCommitments.map((commitment, i) => (
                  <li
                    className="rounded bg-blue-100 px-2 py-1 text-xs dark:bg-blue-900/50"
                    key={i}
                  >
                    "...{commitment}..."
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Actions */}
      <div className="flex gap-2">
        {onEditDraft && (
          <Button
            className="flex-1"
            onClick={onEditDraft}
            size="sm"
            variant="default"
          >
            Edit Draft
          </Button>
        )}
        {!hasCritical && onProceedAnyway && (
          <Button
            className="flex-1"
            onClick={onProceedAnyway}
            size="sm"
            variant="outline"
          >
            Send Anyway
          </Button>
        )}
        {hasCritical && (
          <p className="flex-1 self-center text-center text-red-600 text-xs dark:text-red-400">
            Sending is blocked. Please edit your draft.
          </p>
        )}
      </div>
    </div>
  );
}

export default ContradictionWarning;
