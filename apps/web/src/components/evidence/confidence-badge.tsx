// =============================================================================
// CONFIDENCE BADGE
// =============================================================================
//
// A visual indicator of AI confidence that can be added to any intelligence card.
// Shows at-a-glance confidence with optional expandable explanation.
//

import { HelpCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ConfidenceFactorDisplay {
  name: string;
  score: number;
  explanation: string;
}

export interface ConfidenceBadgeProps {
  /** Confidence score from 0 to 1 */
  confidence: number;
  /** Whether user has verified this extraction */
  isUserVerified?: boolean;
  /** Whether user has dismissed this extraction */
  isUserDismissed?: boolean;
  /** Optional factors to show in popover */
  factors?: ConfidenceFactorDisplay[];
  /** Size variant */
  size?: "sm" | "default" | "lg";
  /** Show popover on hover/click */
  showDetails?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getConfidenceConfig(confidence: number) {
  if (confidence >= 0.9) {
    return {
      label: "Very High",
      color: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
      progressColor: "bg-green-500",
      description: "Strong indicators and clear context",
    };
  }
  if (confidence >= 0.75) {
    return {
      label: "High",
      color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
      progressColor: "bg-green-500",
      description: "Clear indicators with supporting context",
    };
  }
  if (confidence >= 0.5) {
    return {
      label: "Medium",
      color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
      progressColor: "bg-amber-500",
      description: "Likely correct but some ambiguity",
    };
  }
  return {
    label: "Low",
    color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800",
    progressColor: "bg-red-500",
    description: "Review recommended",
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ConfidenceBadge({
  confidence,
  isUserVerified,
  isUserDismissed,
  factors,
  size = "default",
  showDetails = true,
  className,
}: ConfidenceBadgeProps) {
  const config = getConfidenceConfig(confidence);
  const percentage = Math.round(confidence * 100);

  // User status overrides
  if (isUserVerified) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
          size === "sm" && "text-xs px-1.5 py-0",
          size === "lg" && "text-sm px-3 py-1",
          className
        )}
      >
        <Sparkles className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
        Verified
      </Badge>
    );
  }

  if (isUserDismissed) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "bg-gray-500/10 text-gray-500 border-gray-200 dark:border-gray-700 line-through",
          size === "sm" && "text-xs px-1.5 py-0",
          size === "lg" && "text-sm px-3 py-1",
          className
        )}
      >
        Dismissed
      </Badge>
    );
  }

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        config.color,
        size === "sm" && "text-xs px-1.5 py-0",
        size === "lg" && "text-sm px-3 py-1",
        showDetails && "cursor-help",
        className
      )}
    >
      <Sparkles className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
      {percentage}%
      {showDetails && <HelpCircle className={cn("ml-1 opacity-50", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />}
    </Badge>
  );

  if (!showDetails) {
    return badge;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        <div className="space-y-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">AI Confidence</span>
              <span className={cn("text-sm font-semibold", config.color.split(" ")[1])}>
                {percentage}% - {config.label}
              </span>
            </div>
            <Progress value={percentage} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{config.description}</p>
          </div>

          {/* Factors */}
          {factors && factors.length > 0 && (
            <div className="space-y-3 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Confidence Factors
              </p>
              {factors.map((factor, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs">{factor.name}</span>
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
                  <Progress value={factor.score * 100} className="h-0.5" />
                  <p className="text-xs text-muted-foreground">{factor.explanation}</p>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <p className="text-xs text-muted-foreground border-t pt-3">
            Click "Show me" for full evidence trail
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ConfidenceBadge;
