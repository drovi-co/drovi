"use client";

import {
  addDays,
  differenceInMinutes,
  format,
  isSameDay,
  isToday,
  setHours,
  setMinutes,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { MapPin, Video } from "lucide-react";
import { useMemo, useRef } from "react";
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
const HOUR_HEIGHT = 60; // pixels per hour
const MIN_EVENT_HEIGHT = 20;

// =============================================================================
// TYPES
// =============================================================================

interface WeekViewProps {
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
  column: number;
  totalColumns: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function getEventPosition(
  event: CalendarEvent,
  dayStart: Date
): { top: number; height: number } {
  const startMinutes = differenceInMinutes(event.start, dayStart);
  const endMinutes = differenceInMinutes(event.end, dayStart);
  const durationMinutes = endMinutes - startMinutes;

  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = Math.max(
    (durationMinutes / 60) * HOUR_HEIGHT,
    MIN_EVENT_HEIGHT
  );

  return { top, height };
}

function layoutEvents(
  events: CalendarEvent[],
  dayStart: Date
): PositionedEvent[] {
  if (events.length === 0) {
    return [];
  }

  // Sort by start time, then by duration (longer events first)
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
    const { top, height } = getEventPosition(event, dayStart);
    const eventEnd = top + height;

    // Find available column
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
      left: 0,
      width: 0,
      column,
      totalColumns: 0,
    });
  }

  // Calculate widths based on overlapping events
  const totalColumns = columns.length;
  for (const pos of positioned) {
    pos.totalColumns = totalColumns;
    pos.width = 100 / totalColumns;
    pos.left = pos.column * (100 / totalColumns);
  }

  return positioned;
}

// =============================================================================
// HELPERS - COLOR CONVERSION
// =============================================================================

/**
 * Convert hex color to rgba with opacity (Notion Calendar style)
 * Creates a subtle, muted background that's easy on the eyes
 */
function hexToRgba(hex: string, opacity: number): string {
  // Remove # if present
  const cleanHex = hex.replace("#", "");

  // Parse hex values
  const r = Number.parseInt(cleanHex.substring(0, 2), 16);
  const g = Number.parseInt(cleanHex.substring(2, 4), 16);
  const b = Number.parseInt(cleanHex.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(59, 130, 246, ${opacity})`; // Fallback to blue
  }

  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
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
  const isCompact = height < 40;

  // Use event colors if available, otherwise fall back to blue
  const accentColor = event.backgroundColor || "#3b82f6";
  // Notion-style: subtle background with 15-20% opacity + solid left border
  const subtleBgColor = hexToRgba(accentColor, 0.15);

  return (
    <button
      className={cn(
        "absolute rounded-md px-2 py-1 text-left transition-all",
        "hover:ring-2 hover:ring-ring hover:ring-offset-1",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "border-l-[3px]", // Solid left accent border
        event.status === "tentative" && "opacity-70",
        event.status === "cancelled" && "line-through opacity-50"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        backgroundColor: subtleBgColor,
        borderLeftColor: accentColor,
      }}
      type="button"
    >
      <div className="flex h-full flex-col overflow-hidden">
        <span
          className={cn(
            "truncate font-medium text-foreground",
            isCompact ? "text-xs" : "text-sm"
          )}
        >
          {event.title}
        </span>
        {!isCompact && (
          <span className="text-muted-foreground text-xs">
            {format(event.start, "h:mm a")}
            {event.conferenceData && (
              <Video className="ml-1 inline-block h-3 w-3" />
            )}
            {event.location && <MapPin className="ml-1 inline-block h-3 w-3" />}
          </span>
        )}
        {height >= 60 && event.location && (
          <span className="mt-1 truncate text-muted-foreground text-xs">
            {event.location}
          </span>
        )}
      </div>
    </button>
  );
}

// =============================================================================
// ALL-DAY EVENTS ROW
// =============================================================================

interface AllDayEventsProps {
  events: CalendarEvent[];
  weekDays: Date[];
  onEventClick: EventClickHandler;
}

function AllDayEvents({ events, weekDays, onEventClick }: AllDayEventsProps) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div className="border-b bg-muted/30">
      <div className="grid min-h-[32px] grid-cols-8">
        {/* Time gutter */}
        <div className="flex items-center justify-end border-r p-1 pr-2 text-muted-foreground text-xs">
          All day
        </div>
        {/* Day columns */}
        {weekDays.map((day) => {
          const dayEvents = events.filter((e) => isSameDay(e.start, day));
          return (
            <div
              className="space-y-0.5 border-r p-0.5 last:border-r-0"
              key={day.toISOString()}
            >
              {dayEvents.map((event) => {
                const accentColor = event.backgroundColor || "#3b82f6";
                const subtleBgColor = hexToRgba(accentColor, 0.15);

                return (
                  <button
                    className={cn(
                      "w-full truncate rounded px-1.5 py-0.5 text-left text-xs",
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
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// WEEK VIEW COMPONENT
// =============================================================================

export function WeekView({
  events,
  currentDate,
  onEventClick,
  onSlotClick,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });

  // Generate array of days in the week
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Separate all-day and timed events
  const { allDayEvents, timedEvents } = useMemo(() => {
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];

    for (const event of events) {
      if (event.isAllDay) {
        allDay.push(event);
      } else {
        timed.push(event);
      }
    }

    return { allDayEvents: allDay, timedEvents: timed };
  }, [events]);

  // Group timed events by day
  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, PositionedEvent[]>();

    for (const day of weekDays) {
      const dayKey = format(day, "yyyy-MM-dd");
      const dayEvents = timedEvents.filter((e) => isSameDay(e.start, day));
      grouped.set(dayKey, layoutEvents(dayEvents, startOfDay(day)));
    }

    return grouped;
  }, [weekDays, timedEvents]);

  // Handle slot click
  const handleSlotClick = (day: Date, hour: number) => {
    const clickedTime = setMinutes(setHours(day, hour), 0);
    onSlotClick(clickedTime, hour);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with day names */}
      <div className="grid shrink-0 grid-cols-8 border-b">
        {/* Time gutter header */}
        <div className="border-r p-2 text-muted-foreground text-xs">
          GMT{format(new Date(), "xxx")}
        </div>
        {/* Day headers */}
        {weekDays.map((day) => (
          <div
            className={cn(
              "border-r p-2 text-center last:border-r-0",
              isToday(day) && "bg-primary/5"
            )}
            key={day.toISOString()}
          >
            <div className="text-muted-foreground text-xs uppercase">
              {format(day, "EEE")}
            </div>
            <div
              className={cn(
                "mt-0.5 font-semibold text-lg",
                isToday(day) &&
                  "mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
              )}
            >
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>

      {/* All-day events */}
      <AllDayEvents
        events={allDayEvents}
        onEventClick={onEventClick}
        weekDays={weekDays}
      />

      {/* Scrollable time grid */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="relative grid grid-cols-8">
          {/* Time labels column */}
          <div className="relative border-r" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
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

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayKey = format(day, "yyyy-MM-dd");
            const dayEvents = eventsByDay.get(dayKey) || [];

            return (
              <div
                className={cn(
                  "relative border-r last:border-r-0",
                  isToday(day) && "bg-primary/[0.02]"
                )}
                key={day.toISOString()}
              >
                {/* Hour slots */}
                {HOURS.map((hour) => (
                  <button
                    aria-label={`Create event at ${format(setHours(day, hour), "h:mm a")}`}
                    className={cn(
                      "absolute h-[60px] w-full border-border/50 border-b",
                      "transition-colors hover:bg-accent/30"
                    )}
                    key={hour}
                    onClick={() => handleSlotClick(day, hour)}
                    style={{ top: `${hour * HOUR_HEIGHT}px` }}
                    type="button"
                  />
                ))}

                {/* Events */}
                {dayEvents.map((positioned) => (
                  <EventCard
                    key={positioned.event.id}
                    onClick={onEventClick}
                    positioned={positioned}
                  />
                ))}

                {/* Current time indicator */}
                {isToday(day) && <CurrentTimeIndicator />}
              </div>
            );
          })}
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
