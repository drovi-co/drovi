"use client";

import { Badge } from "@memorystack/ui-core/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@memorystack/ui-core/tooltip";
import {
  Calendar,
  FileText,
  Github,
  Hash,
  type LucideIcon,
  Mail,
  MessageSquare,
  Video,
} from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

// =============================================================================
// SOURCE BREADCRUMBS COMPONENT
// =============================================================================
//
// Displays badges showing which sources contributed to a UIO.
// Example: [Slack] [Email] [Calendar]
//
// Each badge shows the source type with a count if there are multiple
// references from that source.
//

export interface SourceBreadcrumb {
  sourceType: string;
  count: number;
  sourceName: string;
}

interface SourceBreadcrumbsProps extends React.HTMLAttributes<HTMLDivElement> {
  sources: SourceBreadcrumb[];
  variant?: "default" | "compact" | "minimal";
  maxVisible?: number;
}

// Source type to icon mapping
const sourceIcons: Record<string, LucideIcon> = {
  email: Mail,
  slack: MessageSquare,
  calendar: Calendar,
  notion: FileText,
  google_docs: FileText,
  google_sheets: FileText,
  meeting_transcript: Video,
  teams: MessageSquare,
  discord: Hash,
  github: Github,
  linear: Hash,
  whatsapp: MessageSquare,
};

// Source type to color mapping
const sourceColors: Record<string, string> = {
  email:
    "bg-blue-500/10 text-blue-600 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800",
  slack:
    "bg-purple-500/10 text-purple-600 border-purple-200 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-800",
  calendar:
    "bg-green-500/10 text-green-600 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800",
  notion:
    "bg-gray-500/10 text-gray-600 border-gray-200 dark:bg-gray-500/20 dark:text-gray-400 dark:border-gray-700",
  google_docs:
    "bg-blue-500/10 text-blue-600 border-blue-200 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-800",
  google_sheets:
    "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-800",
  meeting_transcript:
    "bg-orange-500/10 text-orange-600 border-orange-200 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-800",
  teams:
    "bg-indigo-500/10 text-indigo-600 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-400 dark:border-indigo-800",
  discord:
    "bg-violet-500/10 text-violet-600 border-violet-200 dark:bg-violet-500/20 dark:text-violet-400 dark:border-violet-800",
  github:
    "bg-gray-500/10 text-gray-700 border-gray-300 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-600",
  linear:
    "bg-indigo-500/10 text-indigo-600 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-400 dark:border-indigo-800",
  whatsapp:
    "bg-green-500/10 text-green-600 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800",
};

export function SourceBreadcrumbs({
  sources,
  variant = "default",
  maxVisible = 5,
  className,
  ...props
}: SourceBreadcrumbsProps) {
  const visibleSources = sources.slice(0, maxVisible);
  const hiddenCount = sources.length - maxVisible;

  return (
    <TooltipProvider>
      <div className={cn("flex items-center gap-1", className)} {...props}>
        {visibleSources.map((source) => {
          const Icon = sourceIcons[source.sourceType] ?? FileText;
          const colorClass =
            sourceColors[source.sourceType] ??
            "bg-muted text-muted-foreground border-border";

          if (variant === "minimal") {
            return (
              <Tooltip key={source.sourceType}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded",
                      colorClass
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="text-xs" side="bottom">
                  <p>
                    {source.sourceName}
                    {source.count > 1 && ` (${source.count} references)`}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          }

          if (variant === "compact") {
            return (
              <Tooltip key={source.sourceType}>
                <TooltipTrigger asChild>
                  <Badge
                    className={cn(
                      "h-5 gap-1 border px-1.5 py-0 font-medium text-[10px]",
                      colorClass
                    )}
                    variant="outline"
                  >
                    <Icon className="h-3 w-3" />
                    {source.count > 1 && (
                      <span className="text-[9px]">{source.count}</span>
                    )}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="text-xs" side="bottom">
                  <p>
                    {source.sourceName}
                    {source.count > 1 && ` (${source.count} references)`}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          }

          // Default variant
          return (
            <Tooltip key={source.sourceType}>
              <TooltipTrigger asChild>
                <Badge
                  className={cn(
                    "h-6 gap-1.5 border px-2 py-0.5 font-medium text-xs",
                    colorClass
                  )}
                  variant="outline"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{source.sourceName}</span>
                  {source.count > 1 && (
                    <span className="text-[10px] opacity-70">
                      {source.count}
                    </span>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {source.count} reference{source.count > 1 ? "s" : ""} from{" "}
                  {source.sourceName}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {hiddenCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
                +{hiddenCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">
                {hiddenCount} more source{hiddenCount > 1 ? "s" : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
