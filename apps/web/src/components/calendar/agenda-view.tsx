"use client";

import { useMemo } from "react";
import {
  format,
  isToday,
  isTomorrow,
  startOfDay,
  compareAsc,
} from "date-fns";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Video, MapPin, Users, Calendar } from "lucide-react";
import type { CalendarEvent, EventClickHandler } from "./types";

// =============================================================================
// TYPES
// =============================================================================

interface AgendaViewProps {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: EventClickHandler;
}

interface GroupedEvents {
  date: Date;
  events: CalendarEvent[];
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDayHeader(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEEE, MMMM d");
}

function getResponseColor(status: string): string {
  switch (status) {
    case "accepted":
      return "text-green-600";
    case "declined":
      return "text-red-600";
    case "tentative":
      return "text-amber-600";
    default:
      return "text-muted-foreground";
  }
}

// =============================================================================
// EVENT ITEM COMPONENT
// =============================================================================

interface EventItemProps {
  event: CalendarEvent;
  onClick: EventClickHandler;
}

function EventItem({ event, onClick }: EventItemProps) {
  const selfAttendee = event.attendees.find((a) => a.self);
  const otherAttendees = event.attendees.filter((a) => !a.self && !a.organizer);

  return (
    <button
      type="button"
      onClick={() => onClick(event)}
      className={cn(
        "w-full text-left p-4 rounded-lg border transition-all",
        "hover:bg-accent/50 hover:border-accent",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        event.status === "cancelled" && "opacity-50"
      )}
    >
      <div className="flex gap-4">
        {/* Time column */}
        <div className="w-20 shrink-0 text-sm">
          {event.isAllDay ? (
            <span className="text-muted-foreground">All day</span>
          ) : (
            <>
              <div className="font-medium">{format(event.start, "h:mm a")}</div>
              <div className="text-muted-foreground">
                {format(event.end, "h:mm a")}
              </div>
            </>
          )}
        </div>

        {/* Event content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h3
            className={cn(
              "font-medium text-base",
              event.status === "cancelled" && "line-through"
            )}
          >
            {event.title}
          </h3>

          {/* Status badge for tentative */}
          {event.status === "tentative" && (
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Tentative
            </span>
          )}

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {/* Video call */}
          {event.conferenceData && (
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-blue-600">
              <Video className="h-4 w-4 shrink-0" />
              <span>
                {event.conferenceData.type === "hangoutsMeet"
                  ? "Google Meet"
                  : event.conferenceData.type === "teams"
                    ? "Microsoft Teams"
                    : "Video call"}
              </span>
            </div>
          )}

          {/* Attendees */}
          {event.attendees.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span>
                {otherAttendees.length > 0
                  ? `${otherAttendees[0]?.name || otherAttendees[0]?.email || "Attendee"}${
                      otherAttendees.length > 1
                        ? ` and ${otherAttendees.length - 1} other${otherAttendees.length > 2 ? "s" : ""}`
                        : ""
                    }`
                  : "You"}
              </span>
            </div>
          )}

          {/* Your response status */}
          {selfAttendee && selfAttendee.responseStatus !== "accepted" && (
            <div
              className={cn(
                "mt-2 text-xs font-medium",
                getResponseColor(selfAttendee.responseStatus)
              )}
            >
              {selfAttendee.responseStatus === "needsAction"
                ? "Awaiting your response"
                : selfAttendee.responseStatus === "tentative"
                  ? "You tentatively accepted"
                  : "You declined"}
            </div>
          )}

          {/* Description preview */}
          {event.description && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
              {event.description}
            </p>
          )}
        </div>

        {/* Color indicator */}
        <div
          className="w-1 rounded-full shrink-0"
          style={{
            backgroundColor: event.backgroundColor || "hsl(var(--primary))",
          }}
        />
      </div>
    </button>
  );
}

// =============================================================================
// DAY GROUP COMPONENT
// =============================================================================

interface DayGroupProps {
  date: Date;
  events: CalendarEvent[];
  onEventClick: EventClickHandler;
}

function DayGroup({ date, events, onEventClick }: DayGroupProps) {
  return (
    <div className="mb-6">
      {/* Day header */}
      <div
        className={cn(
          "sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 mb-3",
          "flex items-center gap-2"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2",
            isToday(date) && "text-primary"
          )}
        >
          <span className="font-semibold">{formatDayHeader(date)}</span>
          {!isToday(date) && !isTomorrow(date) && (
            <span className="text-muted-foreground text-sm">
              {format(date, "yyyy")}
            </span>
          )}
        </div>
      </div>

      {/* Events */}
      <div className="space-y-2">
        {events.map((event) => (
          <EventItem key={event.id} event={event} onClick={onEventClick} />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// AGENDA VIEW COMPONENT
// =============================================================================

export function AgendaView({
  events,
  currentDate: _currentDate,
  onEventClick,
}: AgendaViewProps) {
  // Group events by day
  const groupedEvents: GroupedEvents[] = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>();

    // Sort events by start time
    const sorted = [...events].sort((a, b) =>
      compareAsc(a.start, b.start)
    );

    for (const event of sorted) {
      const dayKey = format(startOfDay(event.start), "yyyy-MM-dd");
      const existing = groups.get(dayKey) || [];
      groups.set(dayKey, [...existing, event]);
    }

    // Convert to array and sort by date
    return Array.from(groups.entries())
      .map(([dateStr, evts]) => ({
        date: new Date(dateStr),
        events: evts,
      }))
      .sort((a, b) => compareAsc(a.date, b.date));
  }, [events]);

  // Empty state
  if (groupedEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Calendar className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-medium text-lg mb-1">No upcoming events</h3>
        <p className="text-sm text-muted-foreground">
          Your schedule is clear for the next 30 days
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        {groupedEvents.map((group) => (
          <DayGroup
            key={group.date.toISOString()}
            date={group.date}
            events={group.events}
            onEventClick={onEventClick}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
