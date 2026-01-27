// =============================================================================
// SCHEDULE SECTION COMPONENT
// =============================================================================
//
// Compact calendar events display with max 3 visible items.
// Shows video call badges, duration, and collapsible overflow.
//

import { differenceInMinutes, format } from "date-fns";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  MapPin,
  Video,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  type?: "meeting" | "task" | "commitment" | "reminder";
  location?: string;
  isVideoCall?: boolean;
  conferenceUrl?: string;
  attendees?: string[];
}

interface ScheduleSectionProps {
  events: CalendarEvent[];
  onEventClick?: (id: string) => void;
  maxVisible?: number;
  className?: string;
}

function formatEventTime(start: Date): string {
  return format(start, "h:mm a");
}

function formatDuration(start: Date, end: Date): string {
  const mins = differenceInMinutes(end, start);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  if (remainingMins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMins}m`;
}

function EventItem({
  event,
  onClick,
  index,
}: {
  event: CalendarEvent;
  onClick?: (id: string) => void;
  index: number;
}) {
  const duration = formatDuration(event.startTime, event.endTime);
  const isLongMeeting =
    differenceInMinutes(event.endTime, event.startTime) > 60;

  return (
    <motion.button
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "group w-full px-3 py-2 text-left transition-colors",
        "flex items-center gap-3 hover:bg-muted/50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      initial={{ opacity: 0, x: -10 }}
      onClick={() => onClick?.(event.id)}
      transition={{ delay: index * 0.03 }}
      type="button"
    >
      {/* Time */}
      <div className="w-16 shrink-0 text-right">
        <span className="font-medium text-xs">
          {formatEventTime(event.startTime)}
        </span>
      </div>

      {/* Color indicator */}
      <div
        className={cn(
          "h-8 w-1 shrink-0 rounded-full",
          event.type === "meeting" && "bg-indigo-400/70 dark:bg-indigo-500/60",
          event.type === "task" && "bg-emerald-400/70 dark:bg-emerald-500/60",
          event.type === "commitment" &&
            "bg-violet-400/70 dark:bg-violet-500/60",
          event.type === "reminder" && "bg-amber-400/70 dark:bg-amber-500/60",
          !event.type && "bg-indigo-400/70 dark:bg-indigo-500/60"
        )}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{event.title}</p>
        <div className="flex items-center gap-2">
          {event.isVideoCall && (
            <span className="inline-flex items-center gap-1 text-indigo-600/70 text-xs dark:text-indigo-400/70">
              <Video className="h-3 w-3" />
              Video
            </span>
          )}
          {event.location && !event.isVideoCall && (
            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
              <MapPin className="h-3 w-3" />
              <span className="max-w-[80px] truncate">{event.location}</span>
            </span>
          )}
          {isLongMeeting && (
            <span className="text-muted-foreground text-xs">{duration}</span>
          )}
        </div>
      </div>

      {/* Join button for video calls */}
      {event.isVideoCall && event.conferenceUrl && (
        <a
          className="flex h-6 w-6 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
          href={event.conferenceUrl}
          onClick={(e) => e.stopPropagation()}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-3 w-3 text-indigo-600/70 dark:text-indigo-400/70" />
        </a>
      )}
    </motion.button>
  );
}

export function ScheduleSection({
  events,
  onEventClick,
  maxVisible = 3,
  className,
}: ScheduleSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const sortedEvents = [...events].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  const visibleEvents = expanded
    ? sortedEvents
    : sortedEvents.slice(0, maxVisible);
  const hasMore = sortedEvents.length > maxVisible;
  const hiddenCount = sortedEvents.length - maxVisible;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.1 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1">
            <Clock className="h-3.5 w-3.5 text-primary-foreground/60" />
          </div>
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Schedule
          </h4>
        </div>
        {events.length > 0 && (
          <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-medium text-[10px] text-foreground/70">
            {events.length}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="divide-y divide-border/50">
        {sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <div className="mb-2 rounded-full bg-primary/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600/70 dark:text-emerald-400/70" />
            </div>
            <p className="font-medium text-muted-foreground text-sm">
              Clear schedule
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              No meetings today
            </p>
          </div>
        ) : (
          <>
            {visibleEvents.map((event, index) => (
              <EventItem
                event={event}
                index={index}
                key={event.id}
                onClick={onEventClick}
              />
            ))}

            {/* Expand/Collapse button */}
            {hasMore && (
              <Button
                className="h-8 w-full justify-center gap-1 rounded-none text-xs"
                onClick={() => setExpanded(!expanded)}
                variant="ghost"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />+{hiddenCount} more event
                    {hiddenCount !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
