"use client";

import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  Edit,
  ExternalLink,
  type LucideIcon,
  Merge,
  Plus,
  Users,
} from "lucide-react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// TIMELINE VIEW COMPONENT
// =============================================================================
//
// Shows chronological history of a UIO across sources:
// "Created from Slack" -> "Due date updated from Email" -> "Confirmed in Docs"
//
// Each event shows:
// - Event type icon
// - Description
// - Source badge
// - Timestamp
// - Optional quoted evidence
//

export interface TimelineEvent {
  id: string;
  eventType:
    | "created"
    | "status_changed"
    | "due_date_changed"
    | "due_date_confirmed"
    | "participant_added"
    | "source_added"
    | "merged"
    | "user_verified"
    | "user_corrected"
    | "auto_completed";
  eventDescription: string;
  sourceType?: string | null;
  sourceName?: string | null;
  messageId?: string | null;
  quotedText?: string | null;
  confidence?: number | null;
  triggeredBy?: string | null;
  eventAt: Date;
}

interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  events: TimelineEvent[];
  onViewSource?: (messageId: string) => void;
  loading?: boolean;
  emptyMessage?: string;
}

// Event type to icon mapping
const eventIcons: Record<string, LucideIcon> = {
  created: Plus,
  status_changed: AlertCircle,
  due_date_changed: Calendar,
  due_date_confirmed: Check,
  participant_added: Users,
  source_added: Plus,
  merged: Merge,
  user_verified: Check,
  user_corrected: Edit,
  auto_completed: Clock,
};

// Event type to color mapping
const eventColors: Record<string, string> = {
  created: "bg-green-500 text-white",
  status_changed: "bg-yellow-500 text-white",
  due_date_changed: "bg-blue-500 text-white",
  due_date_confirmed: "bg-green-500 text-white",
  participant_added: "bg-purple-500 text-white",
  source_added: "bg-indigo-500 text-white",
  merged: "bg-orange-500 text-white",
  user_verified: "bg-emerald-500 text-white",
  user_corrected: "bg-amber-500 text-white",
  auto_completed: "bg-gray-500 text-white",
};

export function Timeline({
  events,
  onViewSource,
  loading = false,
  emptyMessage = "No events yet",
  className,
  ...props
}: TimelineProps) {
  if (loading) {
    return (
      <div className={cn("space-y-4", className)} {...props}>
        {[1, 2, 3].map((i) => (
          <div className="flex gap-3" key={i}>
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              {i < 3 && (
                <div className="mt-2 h-12 w-0.5 animate-pulse bg-muted" />
              )}
            </div>
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className={cn(
          "py-8 text-center text-muted-foreground text-sm",
          className
        )}
        {...props}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className={cn("space-y-0", className)} {...props}>
        {events.map((event, index) => {
          const Icon = eventIcons[event.eventType] ?? AlertCircle;
          const colorClass =
            eventColors[event.eventType] ?? "bg-gray-500 text-white";
          const isLast = index === events.length - 1;

          return (
            <div className="flex gap-3" key={event.id}>
              {/* Timeline track */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    colorClass
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                {!isLast && (
                  <div className="mt-2 min-h-[24px] w-0.5 flex-1 bg-border" />
                )}
              </div>

              {/* Event content */}
              <div className="flex-1 pt-1 pb-6">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-medium text-sm leading-tight">
                      {event.eventDescription}
                    </p>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      {event.sourceName && (
                        <Badge className="h-5 px-1.5 py-0" variant="secondary">
                          {event.sourceName}
                        </Badge>
                      )}
                      <span>
                        {formatDistanceToNow(event.eventAt, {
                          addSuffix: true,
                        })}
                      </span>
                      {event.confidence && event.confidence < 0.8 && (
                        <Tooltip>
                          <TooltipTrigger>
                            <span className="text-amber-500">
                              {Math.round(event.confidence * 100)}% confident
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            AI confidence score for this detection
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <Tooltip>
                    <TooltipTrigger>
                      <span className="whitespace-nowrap text-muted-foreground text-xs">
                        {format(event.eventAt, "MMM d")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {format(event.eventAt, "MMMM d, yyyy 'at' h:mm a")}
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Quoted evidence */}
                {event.quotedText && (
                  <div className="mt-2 border-muted border-l-2 pl-3">
                    <p className="line-clamp-2 text-muted-foreground text-xs italic">
                      "{event.quotedText}"
                    </p>
                    {event.messageId && onViewSource && (
                      <Button
                        className="mt-1 h-auto p-0 text-xs"
                        onClick={() => onViewSource(event.messageId!)}
                        size="sm"
                        variant="link"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        View source
                      </Button>
                    )}
                  </div>
                )}

                {/* User attribution */}
                {event.triggeredBy && event.triggeredBy !== "system" && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    by {event.triggeredBy}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
