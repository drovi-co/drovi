// =============================================================================
// SOURCE SELECTOR
// =============================================================================
//
// Allows users to select which messaging source to compose in.
// Supports Email, Slack, WhatsApp with visual indicators and keyboard shortcuts.
//

import { Mail, MessageSquare, Phone } from "lucide-react";
import { useCallback } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { type SourceType, useCompose } from "../compose-provider";

// =============================================================================
// TYPES
// =============================================================================

interface SourceConfig {
  type: SourceType;
  label: string;
  icon: typeof Mail;
  shortcut: string;
  color: string;
  bgColor: string;
  available: boolean;
  description: string;
}

// =============================================================================
// SOURCE CONFIGURATIONS
// =============================================================================

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    type: "email",
    label: "Email",
    icon: Mail,
    shortcut: "1",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10 hover:bg-blue-500/20",
    available: true,
    description: "Send via Gmail or Outlook",
  },
  {
    type: "slack",
    label: "Slack",
    icon: MessageSquare,
    shortcut: "2",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10 hover:bg-purple-500/20",
    available: false, // Not yet implemented
    description: "Post to a channel or DM",
  },
  {
    type: "whatsapp",
    label: "WhatsApp",
    icon: Phone,
    shortcut: "3",
    color: "text-green-500",
    bgColor: "bg-green-500/10 hover:bg-green-500/20",
    available: false, // Not yet implemented
    description: "Send a WhatsApp message",
  },
];

// =============================================================================
// COMPONENTS
// =============================================================================

interface SourceSelectorProps {
  /** Compact mode shows only icons */
  compact?: boolean;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
  /** Callback when source changes */
  onChange?: (source: SourceType) => void;
}

export function SourceSelector({
  compact = false,
  disabled = false,
  className,
  onChange,
}: SourceSelectorProps) {
  const { state, actions } = useCompose();
  const currentSource = state.sourceType;

  const handleSourceChange = useCallback(
    (source: SourceType) => {
      if (disabled) return;

      const config = SOURCE_CONFIGS.find((c) => c.type === source);
      if (!config?.available) return;

      actions.setSourceType(source);
      onChange?.(source);
    },
    [disabled, actions, onChange]
  );

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {SOURCE_CONFIGS.map((config) => {
          const Icon = config.icon;
          const isSelected = currentSource === config.type;
          const isDisabled = disabled || !config.available;

          return (
            <Tooltip key={config.type}>
              <TooltipTrigger asChild>
                <Button
                  className={cn(
                    "h-8 w-8",
                    isSelected && config.bgColor,
                    isSelected && config.color,
                    !isSelected && "text-muted-foreground",
                    isDisabled && "cursor-not-allowed opacity-50"
                  )}
                  disabled={isDisabled}
                  onClick={() => handleSourceChange(config.type)}
                  size="icon"
                  variant="ghost"
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="font-medium">{config.label}</p>
                <p className="text-muted-foreground text-xs">
                  {config.available ? config.description : "Coming soon"}
                </p>
                {config.available && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    Press <kbd className="rounded bg-muted px-1">⌘{config.shortcut}</kbd> to select
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", className)}>
      {SOURCE_CONFIGS.map((config) => {
        const Icon = config.icon;
        const isSelected = currentSource === config.type;
        const isDisabled = disabled || !config.available;

        return (
          <button
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg border p-3 transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? cn("border-2", config.color, config.bgColor, "border-current")
                : "border-border hover:border-border-hover hover:bg-muted/50",
              isDisabled && "cursor-not-allowed opacity-50"
            )}
            disabled={isDisabled}
            key={config.type}
            onClick={() => handleSourceChange(config.type)}
            type="button"
          >
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                isSelected ? config.bgColor : "bg-muted"
              )}
            >
              <Icon className={cn("h-5 w-5", isSelected ? config.color : "text-muted-foreground")} />
            </div>
            <div className="flex-1 text-left">
              <p className={cn("font-medium text-sm", isSelected && config.color)}>
                {config.label}
              </p>
              <p className="text-muted-foreground text-xs">
                {config.available ? config.description : "Coming soon"}
              </p>
            </div>
            {config.available && (
              <kbd className="hidden text-muted-foreground text-xs sm:block">
                ⌘{config.shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// SOURCE INDICATOR
// =============================================================================

interface SourceIndicatorProps {
  source: SourceType;
  accountLabel?: string;
  className?: string;
}

export function SourceIndicator({
  source,
  accountLabel,
  className,
}: SourceIndicatorProps) {
  const config = SOURCE_CONFIGS.find((c) => c.type === source);
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <div className={cn("flex items-center justify-center rounded", config.bgColor, "p-1")}>
        <Icon className={cn("h-3.5 w-3.5", config.color)} />
      </div>
      <span className="text-muted-foreground">
        Sending as:{" "}
        <span className="font-medium text-foreground">{accountLabel || config.label}</span>
      </span>
    </div>
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export { SOURCE_CONFIGS };
export type { SourceConfig };
