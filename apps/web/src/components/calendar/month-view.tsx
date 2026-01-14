"use client";

import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo } from "react";
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_VISIBLE_EVENTS = 3;

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
// TYPES
// =============================================================================

interface MonthViewProps {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: EventClickHandler;
  onSlotClick: TimeSlotClickHandler;
}

// =============================================================================
// DAY CELL COMPONENT
// =============================================================================

interface DayCellProps {
  day: Date;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
  onEventClick: EventClickHandler;
  onSlotClick: TimeSlotClickHandler;
}

function DayCell({
  day,
  events,
  isCurrentMonth,
  onEventClick,
  onSlotClick,
}: DayCellProps) {
  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
  const hiddenCount = events.length - MAX_VISIBLE_EVENTS;

  return (
    <button
      className={cn(
        "min-h-[100px] border-r border-b p-1 text-left transition-colors",
        "hover:bg-accent/30",
        !isCurrentMonth && "bg-muted/30"
      )}
      onClick={() => onSlotClick(day)}
      type="button"
    >
      {/* Day number */}
      <div
        className={cn(
          "mb-1 flex h-7 w-7 items-center justify-center rounded-full font-medium text-sm",
          isToday(day) && "bg-primary text-primary-foreground",
          !isCurrentMonth && "text-muted-foreground"
        )}
      >
        {format(day, "d")}
      </div>

      {/* Events */}
      <div className="space-y-0.5">
        {visibleEvents.map((event) => {
          const accentColor = event.backgroundColor || "#3b82f6";
          const subtleBgColor = hexToRgba(accentColor, 0.15);

          return (
            <button
              className={cn(
                "w-full truncate rounded px-1.5 py-0.5 text-left text-xs",
                "border-l-2 transition-colors",
                "text-foreground hover:opacity-80",
                event.status === "tentative" && "opacity-70",
                event.status === "cancelled" && "line-through opacity-50"
              )}
              key={event.id}
              onClick={(e) => {
                e.stopPropagation();
                onEventClick(event);
              }}
              style={{
                backgroundColor: subtleBgColor,
                borderLeftColor: accentColor,
              }}
              type="button"
            >
              {!event.isAllDay && (
                <span className="mr-1 text-muted-foreground">
                  {format(event.start, "h:mm")}
                </span>
              )}
              {event.title}
            </button>
          );
        })}

        {hiddenCount > 0 && (
          <div className="pl-1.5 text-muted-foreground text-xs">
            +{hiddenCount} more
          </div>
        )}
      </div>
    </button>
  );
}

// =============================================================================
// MONTH VIEW COMPONENT
// =============================================================================

export function MonthView({
  events,
  currentDate,
  onEventClick,
  onSlotClick,
}: MonthViewProps) {
  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate]);

  // Group events by day
  const eventsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const dayKey = format(event.start, "yyyy-MM-dd");
      const existing = grouped.get(dayKey) || [];
      grouped.set(dayKey, [...existing, event]);
    }

    // Sort events within each day
    for (const [key, dayEvents] of grouped) {
      grouped.set(
        key,
        dayEvents.sort((a, b) => {
          // All-day events first
          if (a.isAllDay && !b.isAllDay) {
            return -1;
          }
          if (!a.isAllDay && b.isAllDay) {
            return 1;
          }
          // Then by start time
          return a.start.getTime() - b.start.getTime();
        })
      );
    }

    return grouped;
  }, [events]);

  // Split into weeks
  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7));
    }
    return result;
  }, [calendarDays]);

  return (
    <div className="flex h-full flex-col">
      {/* Weekday headers */}
      <div className="grid shrink-0 grid-cols-7 border-b">
        {WEEKDAYS.map((day) => (
          <div
            className="border-r py-2 text-center font-medium text-muted-foreground text-xs uppercase last:border-r-0"
            key={day}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-7 grid-rows-[repeat(auto-fill,minmax(100px,1fr))]">
          {weeks.map((week, _weekIndex) =>
            week.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const dayEvents = eventsByDay.get(dayKey) || [];

              return (
                <DayCell
                  day={day}
                  events={dayEvents}
                  isCurrentMonth={isSameMonth(day, currentDate)}
                  key={day.toISOString()}
                  onEventClick={onEventClick}
                  onSlotClick={onSlotClick}
                />
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
