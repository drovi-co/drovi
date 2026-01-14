// =============================================================================
// COMMITMENT HISTORY TIMELINE
// =============================================================================
//
// A beautiful timeline showing the complete lifecycle of a commitment:
// when it was created, status changes, snoozes, completions, and all events.
// This is the "story" of a promise - from extraction to resolution.
//

import { format, formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Flag,
  Mail,
  MessageSquare,
  Pause,
  Play,
  Sparkles,
  ThumbsUp,
  User,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { ConfidenceBadge } from "@/components/evidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export type TimelineEventType =
  | "created"
  | "extracted"
  | "status_change"
  | "snoozed"
  | "unsnoozed"
  | "completed"
  | "cancelled"
  | "overdue"
  | "verified"
  | "dismissed"
  | "follow_up_sent"
  | "reminder_sent"
  | "due_date_updated"
  | "note_added";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: Date;
  title: string;
  description?: string;
  metadata?: {
    previousStatus?: string;
    newStatus?: string;
    previousDueDate?: Date;
    newDueDate?: Date;
    snoozedUntil?: Date;
    actor?: {
      name?: string;
      email?: string;
    };
    note?: string;
    confidence?: number;
  };
}

export interface CommitmentHistoryTimelineProps {
  commitmentId: string;
  commitmentTitle: string;
  events: TimelineEvent[];
  confidence?: number;
  isUserVerified?: boolean;
  onShowEvidence?: () => void;
  onThreadClick?: (threadId: string) => void;
  sourceThreadId?: string;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function getEventIcon(type: TimelineEventType) {
  switch (type) {
    case "created":
    case "extracted":
      return Sparkles;
    case "status_change":
      return Flag;
    case "snoozed":
      return Pause;
    case "unsnoozed":
      return Play;
    case "completed":
      return CheckCircle2;
    case "cancelled":
      return XCircle;
    case "overdue":
      return AlertCircle;
    case "verified":
      return ThumbsUp;
    case "dismissed":
      return XCircle;
    case "follow_up_sent":
    case "reminder_sent":
      return Mail;
    case "due_date_updated":
      return Calendar;
    case "note_added":
      return MessageSquare;
    default:
      return FileText;
  }
}

function getEventColor(type: TimelineEventType): string {
  switch (type) {
    case "created":
    case "extracted":
      return "bg-purple-500";
    case "completed":
      return "bg-green-500";
    case "verified":
      return "bg-green-500";
    case "cancelled":
    case "dismissed":
      return "bg-gray-400";
    case "overdue":
      return "bg-red-500";
    case "snoozed":
      return "bg-amber-500";
    case "unsnoozed":
      return "bg-blue-500";
    case "follow_up_sent":
    case "reminder_sent":
      return "bg-blue-500";
    case "due_date_updated":
      return "bg-indigo-500";
    case "status_change":
      return "bg-blue-500";
    case "note_added":
      return "bg-gray-500";
    default:
      return "bg-gray-400";
  }
}

function getEventBgColor(type: TimelineEventType): string {
  switch (type) {
    case "created":
    case "extracted":
      return "bg-purple-50 dark:bg-purple-900/20";
    case "completed":
    case "verified":
      return "bg-green-50 dark:bg-green-900/20";
    case "cancelled":
    case "dismissed":
      return "bg-gray-50 dark:bg-gray-800/30";
    case "overdue":
      return "bg-red-50 dark:bg-red-900/20";
    case "snoozed":
      return "bg-amber-50 dark:bg-amber-900/20";
    default:
      return "bg-muted/30";
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CommitmentHistoryTimeline({
  commitmentId,
  commitmentTitle,
  events,
  confidence,
  isUserVerified,
  onShowEvidence,
  onThreadClick,
  sourceThreadId,
  className,
}: CommitmentHistoryTimelineProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const toggleEvent = (eventId: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  };

  // Sort events by timestamp (newest first for display, but we'll reverse for timeline)
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className={cn("relative", className)}>
      {/* Timeline Header */}
      <div className="mb-6 pb-4 border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold truncate">{commitmentTitle}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {events.length} event{events.length !== 1 ? "s" : ""} in history
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {confidence !== undefined && (
              <ConfidenceBadge
                confidence={confidence}
                isUserVerified={isUserVerified}
                size="sm"
              />
            )}
            {onShowEvidence && (
              <Button variant="outline" size="sm" onClick={onShowEvidence}>
                <Eye className="h-4 w-4 mr-1" />
                Evidence
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical Line */}
        <div className="absolute left-[18px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-purple-500 via-blue-500 to-green-500" />

        {/* Events */}
        <div className="space-y-0">
          {sortedEvents.map((event, index) => {
            const Icon = getEventIcon(event.type);
            const isExpanded = expandedEvents.has(event.id);
            const isFirst = index === 0;
            const isLast = index === sortedEvents.length - 1;

            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="relative"
              >
                {/* Event Node */}
                <div className="flex items-start gap-4 py-4">
                  {/* Icon Circle */}
                  <div
                    className={cn(
                      "relative z-10 flex items-center justify-center w-9 h-9 rounded-full shrink-0",
                      getEventColor(event.type),
                      "ring-4 ring-background"
                    )}
                  >
                    <Icon className="h-4 w-4 text-white" />
                  </div>

                  {/* Event Card */}
                  <motion.button
                    type="button"
                    onClick={() => toggleEvent(event.id)}
                    className={cn(
                      "flex-1 text-left rounded-lg p-4 transition-all",
                      "border hover:border-primary/50",
                      getEventBgColor(event.type),
                      isExpanded && "ring-2 ring-primary/30"
                    )}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    {/* Event Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm">{event.title}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(event.timestamp), "MMM d, yyyy 'at' h:mm a")}
                          <span className="mx-1">•</span>
                          {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                        </p>
                      </div>

                      {/* Status Badge for status changes */}
                      {event.type === "status_change" && event.metadata?.newStatus && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {event.metadata.newStatus}
                        </Badge>
                      )}

                      {/* Completed badge */}
                      {event.type === "completed" && (
                        <Badge variant="default" className="bg-green-500 text-[10px] shrink-0">
                          <Check className="h-3 w-3 mr-1" />
                          Done
                        </Badge>
                      )}
                    </div>

                    {/* Description */}
                    {event.description && (
                      <p className="text-sm text-muted-foreground mt-2">
                        {event.description}
                      </p>
                    )}

                    {/* Expanded Details */}
                    {isExpanded && event.metadata && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-border/50"
                      >
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {event.metadata.previousStatus && (
                            <div>
                              <span className="text-muted-foreground">Previous Status:</span>
                              <span className="ml-2 font-medium">{event.metadata.previousStatus}</span>
                            </div>
                          )}
                          {event.metadata.newStatus && (
                            <div>
                              <span className="text-muted-foreground">New Status:</span>
                              <span className="ml-2 font-medium">{event.metadata.newStatus}</span>
                            </div>
                          )}
                          {event.metadata.snoozedUntil && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Snoozed Until:</span>
                              <span className="ml-2 font-medium">
                                {format(new Date(event.metadata.snoozedUntil), "MMM d, yyyy")}
                              </span>
                            </div>
                          )}
                          {event.metadata.previousDueDate && event.metadata.newDueDate && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Due Date:</span>
                              <span className="ml-2">
                                <span className="line-through text-muted-foreground">
                                  {format(new Date(event.metadata.previousDueDate), "MMM d")}
                                </span>
                                <span className="mx-2">→</span>
                                <span className="font-medium">
                                  {format(new Date(event.metadata.newDueDate), "MMM d, yyyy")}
                                </span>
                              </span>
                            </div>
                          )}
                          {event.metadata.actor && (
                            <div className="col-span-2 flex items-center gap-2 mt-1">
                              <Avatar className="h-5 w-5">
                                <AvatarFallback className="text-[8px]">
                                  {event.metadata.actor.name?.[0] ?? event.metadata.actor.email?.[0] ?? "U"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-muted-foreground">
                                {event.metadata.actor.name ?? event.metadata.actor.email}
                              </span>
                            </div>
                          )}
                          {event.metadata.note && (
                            <div className="col-span-2 p-2 bg-background/50 rounded text-sm">
                              "{event.metadata.note}"
                            </div>
                          )}
                          {event.metadata.confidence !== undefined && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Extraction Confidence:</span>
                              <span className="ml-2 font-medium">
                                {Math.round(event.metadata.confidence * 100)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}

                    {/* Expand hint */}
                    {event.metadata && Object.keys(event.metadata).length > 0 && !isExpanded && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Click to see details
                      </p>
                    )}
                  </motion.button>
                </div>

                {/* Connector Lines for visual flow */}
                {!isLast && (
                  <div className="absolute left-[18px] top-[52px] bottom-[-16px] w-0.5">
                    <div className="h-full bg-gradient-to-b from-transparent via-border to-transparent" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Timeline End Marker */}
        <div className="relative flex items-center gap-4 pt-4">
          <div className="relative z-10 flex items-center justify-center w-9 h-9 rounded-full bg-muted ring-4 ring-background">
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 text-sm text-muted-foreground">
            {sourceThreadId ? (
              <button
                type="button"
                onClick={() => onThreadClick?.(sourceThreadId)}
                className="hover:text-foreground transition-colors underline"
              >
                View original email thread
              </button>
            ) : (
              <span>Timeline start</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPACT TIMELINE (for inline display)
// =============================================================================

interface CompactTimelineProps {
  events: TimelineEvent[];
  maxEvents?: number;
  className?: string;
}

export function CompactTimeline({
  events,
  maxEvents = 5,
  className,
}: CompactTimelineProps) {
  const sortedEvents = [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, maxEvents);

  return (
    <div className={cn("space-y-2", className)}>
      {sortedEvents.map((event) => {
        const Icon = getEventIcon(event.type);
        return (
          <div key={event.id} className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-6 h-6 rounded-full shrink-0",
                getEventColor(event.type)
              )}
            >
              <Icon className="h-3 w-3 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{event.title}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CommitmentHistoryTimeline;
