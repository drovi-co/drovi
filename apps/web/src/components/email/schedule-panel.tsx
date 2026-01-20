"use client";

import { Link } from "@tanstack/react-router";
import { addDays, format, isToday, isTomorrow, startOfDay } from "date-fns";
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
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      )}
      onClick={() => onClick?.(event.id)}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "min-h-[40px] w-1 self-stretch rounded-full",
            event.type === "meeting" && "bg-blue-500",
            event.type === "task" && "bg-green-500",
            event.type === "commitment" && "bg-purple-500",
            event.type === "reminder" && "bg-amber-500"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{event.title}</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {formatTimeRange(event.startTime, event.endTime)}
          </p>

          {event.location && (
            <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {event.isVideoCall && (
            <div className="mt-1 flex items-center gap-1 text-blue-500 text-xs">
              <Video className="h-3 w-3" />
              <span>Video call</span>
              {event.conferenceUrl && (
                <a
                  className="ml-1 hover:underline"
                  href={event.conferenceUrl}
                  onClick={(e) => e.stopPropagation()}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {event.attendees && event.attendees.length > 0 && (
            <p className="mt-1 text-muted-foreground text-xs">
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
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {formatDateHeader(selectedDate)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!isViewingToday && (
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedDate(new Date())}
              size="sm"
              variant="ghost"
            >
              Today
            </Button>
          )}
          <Button
            aria-label="Previous day"
            className="h-7 w-7"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Next day"
            className="h-7 w-7"
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            size="icon"
            variant="ghost"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Events section */}
        {sortedEvents.length > 0 && (
          <div className="space-y-2 p-4">
            <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Schedule
            </h3>
            {sortedEvents.map((event) => (
              <EventCard event={event} key={event.id} onClick={onEventClick} />
            ))}
          </div>
        )}

        {/* Commitments section */}
        {dayCommitments.length > 0 && (
          <div className="space-y-2 border-t p-4">
            <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Due Today
            </h3>
            {dayCommitments.map((commitment) => (
              <button
                className={cn(
                  "w-full rounded-lg p-2.5 text-left transition-colors",
                  "flex items-center gap-2 hover:bg-accent/50",
                  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                )}
                key={commitment.id}
                onClick={() => onCommitmentClick?.(commitment.id)}
                type="button"
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
                    "truncate text-sm",
                    commitment.status === "completed" &&
                      "text-muted-foreground line-through"
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
          <div className="flex h-48 flex-col items-center justify-center p-4 text-center">
            <Clock className="mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">Nothing scheduled</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {isViewingToday ? "Your day is clear" : "No events for this day"}
            </p>
            {onCreateEvent && (
              <Button
                className="mt-3"
                onClick={onCreateEvent}
                size="sm"
                variant="outline"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add event
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Footer with calendar link */}
      <div className="space-y-2 border-t p-3">
        {upcomingCount > 0 && (
          <p className="text-center text-muted-foreground text-xs">
            {upcomingCount} event{upcomingCount !== 1 ? "s" : ""} this week
          </p>
        )}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  className="h-8 flex-1"
                  size="sm"
                  variant="outline"
                >
                  <Link to="/dashboard/calendar">
                    <Calendar className="mr-2 h-4 w-4" />
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
                    className="h-8 w-8 shrink-0"
                    onClick={onCreateEvent}
                    size="icon"
                    variant="default"
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
