"use client";

import { cn } from "@/lib/utils";
import { format, isToday, isTomorrow, addDays, startOfDay } from "date-fns";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
  Video,
} from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// =============================================================================
// TYPES
// =============================================================================

interface ScheduleEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  type: "meeting" | "task" | "commitment" | "reminder";
  attendees?: string[];
  location?: string;
  isVideoCall?: boolean;
  conferenceUrl?: string;
}

interface Commitment {
  id: string;
  title: string;
  dueDate: Date;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

interface SchedulePanelProps {
  events?: ScheduleEvent[];
  commitments?: Commitment[];
  onEventClick?: (id: string) => void;
  onCommitmentClick?: (id: string) => void;
  onCreateEvent?: () => void;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatTimeRange(start: Date, end: Date): string {
  return `${format(start, "h:mm a")} - ${format(end, "h:mm a")}`;
}

function formatDateHeader(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEEE, MMM d");
}

// =============================================================================
// EVENT CARD COMPONENT
// =============================================================================

interface EventCardProps {
  event: ScheduleEvent;
  onClick?: (id: string) => void;
}

function EventCard({ event, onClick }: EventCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(event.id)}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-1 min-h-[40px] rounded-full self-stretch",
            event.type === "meeting" && "bg-blue-500",
            event.type === "task" && "bg-green-500",
            event.type === "commitment" && "bg-purple-500",
            event.type === "reminder" && "bg-amber-500"
          )}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{event.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatTimeRange(event.startTime, event.endTime)}
          </p>

          {event.location && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {event.isVideoCall && (
            <div className="flex items-center gap-1 mt-1 text-xs text-blue-500">
              <Video className="h-3 w-3" />
              <span>Video call</span>
              {event.conferenceUrl && (
                <a
                  href={event.conferenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="ml-1 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {event.attendees && event.attendees.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {event.attendees.length} attendee
              {event.attendees.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// SCHEDULE PANEL COMPONENT
// =============================================================================

export function SchedulePanel({
  events = [],
  commitments = [],
  onEventClick,
  onCommitmentClick,
  onCreateEvent,
  className,
}: SchedulePanelProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const today = startOfDay(new Date());
  const isViewingToday = startOfDay(selectedDate).getTime() === today.getTime();

  // Filter events and commitments for selected date
  const dayEvents = events.filter(
    (e) =>
      startOfDay(e.startTime).getTime() === startOfDay(selectedDate).getTime()
  );
  const dayCommitments = commitments.filter(
    (c) =>
      startOfDay(c.dueDate).getTime() === startOfDay(selectedDate).getTime()
  );

  // Sort events by time
  const sortedEvents = [...dayEvents].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  // Count upcoming events (next 7 days including today)
  const upcomingCount = events.filter((e) => {
    const eventDay = startOfDay(e.startTime).getTime();
    const weekFromNow = startOfDay(addDays(today, 7)).getTime();
    return eventDay >= today.getTime() && eventDay <= weekFromNow;
  }).length;

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {formatDateHeader(selectedDate)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isViewingToday && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedDate(new Date())}
              className="text-xs h-7 px-2"
            >
              Today
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Events section */}
        {sortedEvents.length > 0 && (
          <div className="p-4 space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Schedule
            </h3>
            {sortedEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onClick={onEventClick}
              />
            ))}
          </div>
        )}

        {/* Commitments section */}
        {dayCommitments.length > 0 && (
          <div className="p-4 space-y-2 border-t">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Due Today
            </h3>
            {dayCommitments.map((commitment) => (
              <button
                key={commitment.id}
                type="button"
                onClick={() => onCommitmentClick?.(commitment.id)}
                className={cn(
                  "w-full text-left p-2.5 rounded-lg transition-colors",
                  "hover:bg-accent/50 flex items-center gap-2",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                )}
              >
                <CheckCircle2
                  className={cn(
                    "h-4 w-4 shrink-0",
                    commitment.status === "completed"
                      ? "text-green-500"
                      : commitment.priority === "high"
                        ? "text-red-500"
                        : "text-blue-500"
                  )}
                />
                <span
                  className={cn(
                    "text-sm truncate",
                    commitment.status === "completed" && "line-through text-muted-foreground"
                  )}
                >
                  {commitment.title}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Empty state */}
        {sortedEvents.length === 0 && dayCommitments.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center p-4">
            <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              Nothing scheduled
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isViewingToday ? "Your day is clear" : "No events for this day"}
            </p>
            {onCreateEvent && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onCreateEvent}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add event
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer with calendar link */}
      <div className="border-t p-3 space-y-2">
        {upcomingCount > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {upcomingCount} event{upcomingCount !== 1 ? "s" : ""} this week
          </p>
        )}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8"
                  asChild
                >
                  <Link to="/dashboard/calendar">
                    <Calendar className="h-4 w-4 mr-2" />
                    Open Calendar
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>View full calendar (G then C)</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {onCreateEvent && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={onCreateEvent}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Create event</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  );
}
