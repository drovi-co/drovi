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

// Vercel-style confidence colors
function getConfidenceConfig(confidence: number) {
  if (confidence >= 0.9) {
    return {
      label: "Very High",
      color:
        "bg-[#ecfdf5] text-[#047857] dark:bg-[#022c22] dark:text-[#6ee7b7] border-[#a7f3d0] dark:border-[#064e3b]",
      progressColor: "bg-[#059669]",
      description: "Strong indicators and clear context",
    };
  }
  if (confidence >= 0.75) {
    return {
      label: "High",
      color:
        "bg-[#ecfdf5] text-[#047857] dark:bg-[#022c22] dark:text-[#6ee7b7] border-[#a7f3d0] dark:border-[#064e3b]",
      progressColor: "bg-[#059669]",
      description: "Clear indicators with supporting context",
    };
  }
  if (confidence >= 0.5) {
    return {
      label: "Medium",
      color:
        "bg-[#fffbeb] text-[#b45309] dark:bg-[#451a03] dark:text-[#fcd34d] border-[#fde68a] dark:border-[#78350f]",
      progressColor: "bg-[#d97706]",
      description: "Likely correct but some ambiguity",
    };
  }
  return {
    label: "Low",
    color:
      "bg-[#fef2f2] text-[#b91c1c] dark:bg-[#450a0a] dark:text-[#fca5a5] border-[#fecaca] dark:border-[#7f1d1d]",
    progressColor: "bg-[#dc2626]",
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

  // User status overrides - Vercel style
  if (isUserVerified) {
    return (
      <Badge
        className={cn(
          "border-[#a7f3d0] bg-[#ecfdf5] text-[#047857] dark:border-[#064e3b] dark:bg-[#022c22] dark:text-[#6ee7b7]",
          size === "sm" && "px-1.5 py-0 text-xs",
          size === "lg" && "px-3 py-1 text-sm",
          className
        )}
        variant="outline"
      >
        <Sparkles
          className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")}
        />
        Verified
      </Badge>
    );
  }

  if (isUserDismissed) {
    return (
      <Badge
        className={cn(
          "border-gray-200 bg-gray-500/10 text-gray-500 line-through dark:border-gray-700",
          size === "sm" && "px-1.5 py-0 text-xs",
          size === "lg" && "px-3 py-1 text-sm",
          className
        )}
        variant="outline"
      >
        Dismissed
      </Badge>
    );
  }

  const badge = (
    <Badge
      className={cn(
        config.color,
        size === "sm" && "px-1.5 py-0 text-xs",
        size === "lg" && "px-3 py-1 text-sm",
        showDetails && "cursor-help",
        className
      )}
      variant="outline"
    >
      <Sparkles
        className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")}
      />
      {percentage}%
      {showDetails && (
        <HelpCircle
          className={cn(
            "ml-1 opacity-50",
            size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"
          )}
        />
      )}
    </Badge>
  );

  if (!showDetails) {
    return badge;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">AI Confidence</span>
              <span
                className={cn(
                  "font-semibold text-sm",
                  config.color.split(" ")[1]
                )}
              >
                {percentage}% - {config.label}
              </span>
            </div>
            <Progress className="h-1.5" value={percentage} />
            <p className="text-muted-foreground text-xs">
              {config.description}
            </p>
          </div>

          {/* Factors */}
          {factors && factors.length > 0 && (
            <div className="space-y-3 border-t pt-3">
              <p className="font-medium text-muted-foreground text-xs">
                Confidence Factors
              </p>
              {factors.map((factor, index) => (
                <div className="space-y-1" key={index}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs">{factor.name}</span>
                    <span
                      className={cn(
                        "font-medium text-xs",
                        factor.score >= 0.7
                          ? "text-[#047857] dark:text-[#6ee7b7]"
                          : factor.score >= 0.5
                            ? "text-[#b45309] dark:text-[#fcd34d]"
                            : "text-[#b91c1c] dark:text-[#fca5a5]"
                      )}
                    >
                      {Math.round(factor.score * 100)}%
                    </span>
                  </div>
                  <Progress className="h-0.5" value={factor.score * 100} />
                  <p className="text-muted-foreground text-xs">
                    {factor.explanation}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <p className="border-t pt-3 text-muted-foreground text-xs">
            Click "Show me" for full evidence trail
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ConfidenceBadge;
