// =============================================================================
// SHOW ME BUTTON
// =============================================================================
//
// A consistent "Show Me" button that can be added to any intelligence card.
// This is the one-click path to evidence for any AI extraction.
//

import { Eye, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export interface ShowMeButtonProps {
  /** Callback when button is clicked */
  onClick: () => void;
  /** Optional confidence score to display */
  confidence?: number;
  /** Variant of the button */
  variant?: "default" | "ghost" | "outline" | "secondary";
  /** Size of the button */
  size?: "sm" | "default" | "lg" | "icon";
  /** Additional CSS classes */
  className?: string;
  /** Show text label or just icon */
  showLabel?: boolean;
  /** Custom label text */
  label?: string;
  /** Disabled state */
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ShowMeButton({
  onClick,
  confidence,
  variant = "ghost",
  size = "sm",
  className,
  showLabel = true,
  label = "Show me",
  disabled = false,
}: ShowMeButtonProps) {
  const confidenceColor =
    confidence !== undefined
      ? confidence >= 0.75
        ? "text-green-600"
        : confidence >= 0.5
          ? "text-amber-600"
          : "text-red-600"
      : undefined;

  const buttonContent = (
    <Button
      variant={variant}
      size={size}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={cn("gap-1.5", className)}
    >
      <Eye className={cn("h-3.5 w-3.5", confidenceColor)} />
      {showLabel && <span className="text-xs font-medium">{label}</span>}
      {confidence !== undefined && showLabel && (
        <span className={cn("text-xs font-semibold", confidenceColor)}>
          {Math.round(confidence * 100)}%
        </span>
      )}
    </Button>
  );

  if (!showLabel && confidence !== undefined) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-purple-500" />
              <span>
                AI Confidence: {Math.round(confidence * 100)}% - Click to see
                evidence
              </span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return buttonContent;
}

// =============================================================================
// INLINE EVIDENCE LINK
// =============================================================================

interface EvidenceLinkProps {
  onClick: () => void;
  className?: string;
}

/**
 * An inline "evidence" link that can be placed within text.
 * Useful for adding provenance links to inline content.
 */
export function EvidenceLink({ onClick, className }: EvidenceLinkProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex items-center gap-0.5 text-xs text-primary/80 hover:text-primary underline underline-offset-2 decoration-dashed",
        className
      )}
    >
      <FileText className="h-3 w-3" />
      <span>evidence</span>
    </button>
  );
}

export default ShowMeButton;
