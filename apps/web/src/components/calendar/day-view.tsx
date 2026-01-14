"use client";

import {
  differenceInMinutes,
  format,
  isSameDay,
  isToday,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import { MapPin, Users, Video } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  CalendarEvent,
  EventClickHandler,
  TimeSlotClickHandler,
} from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 60;
const MIN_EVENT_HEIGHT = 24;

// =============================================================================
// TYPES
// =============================================================================

interface DayViewProps {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: EventClickHandler;
  onSlotClick: TimeSlotClickHandler;
}

interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
}

// =============================================================================
// HELPERS - COLOR CONVERSION
// =============================================================================

/**
 * Convert hex color to rgba with opacity (Notion Calendar style)
 */
function hexToRgba(hex: string, opacity: number): string {
  const cleanHex = hex.replace("#", "");
  const r = Number.parseInt(cleanHex.substring(0, 2), 16);
  const g = Number.parseInt(cleanHex.substring(2, 4), 16);
  const b = Number.parseInt(cleanHex.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(59, 130, 246, ${opacity})`;
  }

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// =============================================================================
// HELPERS
// =============================================================================

function layoutEvents(
  events: CalendarEvent[],
  dayStart: Date
): PositionedEvent[] {
  if (events.length === 0) {
    return [];
  }

  const sorted = [...events].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) {
      return startDiff;
    }
    return (
      b.end.getTime() -
      b.start.getTime() -
      (a.end.getTime() - a.start.getTime())
    );
  });

  const positioned: PositionedEvent[] = [];
  const columns: { end: number }[] = [];

  for (const event of sorted) {
    const startMinutes = differenceInMinutes(event.start, dayStart);
    const endMinutes = differenceInMinutes(event.end, dayStart);
    const durationMinutes = endMinutes - startMinutes;

    const top = (startMinutes / 60) * HOUR_HEIGHT;
    const height = Math.max(
      (durationMinutes / 60) * HOUR_HEIGHT,
      MIN_EVENT_HEIGHT
    );
    const eventEnd = top + height;

    let column = 0;
    while (column < columns.length && columns[column].end > top) {
      column++;
    }

    if (column >= columns.length) {
      columns.push({ end: eventEnd });
    } else {
      columns[column].end = eventEnd;
    }

    positioned.push({
      event,
      top,
      height,
      left: column * (100 / Math.max(columns.length, 1)),
      width: 100 / Math.max(columns.length, 1),
    });
  }

  // Recalculate widths after knowing total columns
  const totalColumns = columns.length;
  for (const pos of positioned) {
    pos.width = 100 / totalColumns;
    pos.left = (positioned.indexOf(pos) % totalColumns) * (100 / totalColumns);
  }

  return positioned;
}

// =============================================================================
// ALL DAY SECTION
// =============================================================================

interface AllDaySectionProps {
  events: CalendarEvent[];
  onEventClick: EventClickHandler;
}

function AllDaySection({ events, onEventClick }: AllDaySectionProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-muted/30 p-2">
      <div className="mb-1 text-muted-foreground text-xs">All day</div>
      <div className="space-y-1">
        {events.map((event) => {
          const accentColor = event.backgroundColor || "#3b82f6";
          const subtleBgColor = hexToRgba(accentColor, 0.15);

          return (
            <button
              className={cn(
                "w-full rounded px-2 py-1.5 text-left text-sm",
                "border-l-2 transition-colors",
                "text-foreground hover:opacity-80"
              )}
              key={event.id}
              onClick={() => onEventClick(event)}
              style={{
                backgroundColor: subtleBgColor,
                borderLeftColor: accentColor,
              }}
              type="button"
            >
              {event.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// EVENT CARD COMPONENT
// =============================================================================

interface EventCardProps {
  positioned: PositionedEvent;
  onClick: EventClickHandler;
}

function EventCard({ positioned, onClick }: EventCardProps) {
  const { event, top, height, left, width } = positioned;
  const isLarge = height >= 80;

  // Notion-style: subtle background with solid left border
  const accentColor = event.backgroundColor || "#3b82f6";
  const subtleBgColor = hexToRgba(accentColor, 0.15);

  return (
    <button
      className={cn(
        "absolute overflow-hidden rounded-lg px-3 py-2 text-left transition-all",
        "hover:ring-2 hover:ring-ring hover:ring-offset-1",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "border-l-[3px]", // Solid left accent border
        event.status === "tentative" && "opacity-70",
        event.status === "cancelled" && "opacity-50"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${left}% + 4px)`,
        width: `calc(${width}% - 8px)`,
        backgroundColor: subtleBgColor,
        borderLeftColor: accentColor,
      }}
      type="button"
    >
      <div className="flex h-full flex-col">
        <div className="truncate font-medium text-foreground text-sm">
          {event.title}
        </div>
        <div className="text-muted-foreground text-xs">
          {format(event.start, "h:mm a")} - {format(event.end, "h:mm a")}
        </div>

        {isLarge && (
          <>
            {event.location && (
              <div className="mt-2 flex items-center gap-1 text-muted-foreground text-xs">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{event.location}</span>
              </div>
            )}

            {event.conferenceData && (
              <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
                <Video className="h-3 w-3" />
                <span>Join video call</span>
              </div>
            )}

            {event.attendees.length > 0 && (
              <div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
                <Users className="h-3 w-3" />
                <span>
                  {event.attendees.length} attendee
                  {event.attendees.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </button>
  );
}

// =============================================================================
// DAY VIEW COMPONENT
// =============================================================================

export function DayView({
  events,
  currentDate,
  onEventClick,
  onSlotClick,
}: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayStart = startOfDay(currentDate);

  // Scroll to current time on mount
  useEffect(() => {
    if (isToday(currentDate) && scrollRef.current) {
      const now = new Date();
      const scrollPosition = (now.getHours() - 1) * HOUR_HEIGHT;
      scrollRef.current.scrollTop = Math.max(0, scrollPosition);
    }
  }, [currentDate]);

  // Separate all-day and timed events
  const { allDayEvents, timedEvents } = useMemo(() => {
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];

    for (const event of events) {
      if (isSameDay(event.start, currentDate)) {
        if (event.isAllDay) {
          allDay.push(event);
        } else {
          timed.push(event);
        }
      }
    }

    return { allDayEvents: allDay, timedEvents: timed };
  }, [events, currentDate]);

  // Layout timed events
  const positionedEvents = useMemo(
    () => layoutEvents(timedEvents, dayStart),
    [timedEvents, dayStart]
  );

  // Handle slot click
  const handleSlotClick = (hour: number) => {
    const clickedTime = setMinutes(setHours(currentDate, hour), 0);
    onSlotClick(clickedTime, hour);
  };

  return (
    <div className="flex h-full flex-col">
      {/* All-day events */}
      <AllDaySection events={allDayEvents} onEventClick={onEventClick} />

      {/* Time grid */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="flex">
          {/* Time labels */}
          <div className="relative w-16 shrink-0 border-r" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
            {HOURS.map((hour) => (
              <div
                className="absolute right-0 pr-2 text-right text-muted-foreground text-xs"
                key={hour}
                style={{ top: `${hour * HOUR_HEIGHT - 8}px` }}
              >
                {hour === 0 ? "" : format(setHours(new Date(), hour), "h a")}
              </div>
            ))}
          </div>

          {/* Event area */}
          <div
            className={cn(
              "relative flex-1",
              isToday(currentDate) && "bg-primary/[0.02]"
            )}
          >
            {/* Hour slots */}
            {HOURS.map((hour) => (
              <button
                aria-label={`Create event at ${format(setHours(new Date(), hour), "h:mm a")}`}
                className={cn(
                  "absolute h-[60px] w-full border-border/50 border-b",
                  "transition-colors hover:bg-accent/30"
                )}
                key={hour}
                onClick={() => handleSlotClick(hour)}
                style={{ top: `${hour * HOUR_HEIGHT}px` }}
                type="button"
              />
            ))}

            {/* Events */}
            {positionedEvents.map((positioned) => (
              <EventCard
                key={positioned.event.id}
                onClick={onEventClick}
                positioned={positioned}
              />
            ))}

            {/* Current time indicator */}
            {isToday(currentDate) && <CurrentTimeIndicator />}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// CURRENT TIME INDICATOR
// =============================================================================

function CurrentTimeIndicator() {
  const now = new Date();
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const top = (minutesSinceMidnight / 60) * HOUR_HEIGHT;

  return (
    <div
      className="pointer-events-none absolute right-0 left-0 z-20"
      style={{ top: `${top}px` }}
    >
      <div className="relative">
        <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-red-500" />
        <div className="h-[2px] bg-red-500" />
      </div>
    </div>
  );
}
