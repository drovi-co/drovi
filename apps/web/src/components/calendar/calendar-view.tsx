"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Loader2,
} from "lucide-react";
import {
  format,
  addMonths,
  addWeeks,
  addDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/utils/trpc";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { DayView } from "./day-view";
import { AgendaView } from "./agenda-view";
import { EventModal } from "./event-modal";
import type { CalendarEvent, ViewType, CalendarViewProps } from "./types";

// =============================================================================
// HELPERS
// =============================================================================

function getDateRange(date: Date, view: ViewType): { timeMin: Date; timeMax: Date } {
  switch (view) {
    case "month": {
      // Get extra days for padding (show days from prev/next month in grid)
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      return {
        timeMin: startOfWeek(monthStart, { weekStartsOn: 0 }),
        timeMax: endOfWeek(monthEnd, { weekStartsOn: 0 }),
      };
    }
    case "week":
      return {
        timeMin: startOfWeek(date, { weekStartsOn: 0 }),
        timeMax: endOfWeek(date, { weekStartsOn: 0 }),
      };
    case "day":
      return {
        timeMin: startOfDay(date),
        timeMax: endOfDay(date),
      };
    case "agenda":
      // Show next 30 days
      return {
        timeMin: startOfDay(date),
        timeMax: addDays(date, 30),
      };
  }
}

function formatDateHeader(date: Date, view: ViewType): string {
  switch (view) {
    case "month":
      return format(date, "MMMM yyyy");
    case "week": {
      const weekStart = startOfWeek(date, { weekStartsOn: 0 });
      const weekEnd = endOfWeek(date, { weekStartsOn: 0 });
      if (format(weekStart, "MMMM") === format(weekEnd, "MMMM")) {
        return `${format(weekStart, "MMMM d")} - ${format(weekEnd, "d, yyyy")}`;
      }
      return `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`;
    }
    case "day":
      return format(date, "EEEE, MMMM d, yyyy");
    case "agenda":
      return "Upcoming";
  }
}

// =============================================================================
// CALENDAR VIEW COMPONENT
// =============================================================================

export function CalendarView({ accountId, className }: CalendarViewProps) {
  const trpc = useTRPC();
  const [view, setView] = useState<ViewType>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showEventModal, setShowEventModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ date: Date; hour?: number } | null>(null);

  // Calculate date range based on view
  const { timeMin, timeMax } = useMemo(
    () => getDateRange(currentDate, view),
    [currentDate, view]
  );

  // Fetch events
  const {
    data: eventsData,
    isLoading,
    error,
  } = useQuery(
    trpc.calendar.listEvents.queryOptions({
      accountId,
      timeMin,
      timeMax,
      singleEvents: true,
    })
  );

  // Parse dates from API response
  const events: CalendarEvent[] = useMemo(() => {
    if (!eventsData?.items) return [];

    return eventsData.items.map((e: Record<string, unknown>) => ({
      ...e,
      start: new Date(e.start as string | number | Date),
      end: new Date(e.end as string | number | Date),
      created: new Date(e.created as string | number | Date),
      updated: new Date(e.updated as string | number | Date),
    })) as CalendarEvent[];
  }, [eventsData]);

  // Navigation
  const navigate = (direction: "prev" | "next" | "today") => {
    if (direction === "today") {
      setCurrentDate(new Date());
      return;
    }
    setCurrentDate((prev) => {
      const delta = direction === "prev" ? -1 : 1;
      switch (view) {
        case "month":
          return addMonths(prev, delta);
        case "week":
          return addWeeks(prev, delta);
        case "day":
        case "agenda":
          return addDays(prev, delta);
      }
    });
  };

  // Event handlers
  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setSelectedSlot(null);
    setShowEventModal(true);
  };

  const handleSlotClick = (date: Date, hour?: number) => {
    setSelectedEvent(null);
    setSelectedSlot({ date, hour });
    setShowEventModal(true);
  };

  const handleCreateClick = () => {
    setSelectedEvent(null);
    setSelectedSlot({ date: new Date() });
    setShowEventModal(true);
  };

  const handleModalClose = () => {
    setShowEventModal(false);
    setSelectedEvent(null);
    setSelectedSlot(null);
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("today")}
            className="text-sm"
          >
            Today
          </Button>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("prev")}
              aria-label="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate("next")}
              aria-label="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="text-lg font-semibold ml-2">
            {formatDateHeader(currentDate, view)}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {/* View switcher */}
          <div className="flex border rounded-lg overflow-hidden">
            {(["day", "week", "month", "agenda"] as ViewType[]).map((v) => (
              <Button
                key={v}
                variant={view === v ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setView(v)}
                className={cn(
                  "capitalize rounded-none border-0",
                  view === v && "bg-accent"
                )}
              >
                {v}
              </Button>
            ))}
          </div>

          <Button onClick={handleCreateClick} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      </div>

      {/* Calendar Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <CalendarIcon className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              Failed to load calendar events
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {error.message}
            </p>
          </div>
        ) : (
          <>
            {view === "month" && (
              <MonthView
                events={events}
                currentDate={currentDate}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "week" && (
              <WeekView
                events={events}
                currentDate={currentDate}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "day" && (
              <DayView
                events={events}
                currentDate={currentDate}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "agenda" && (
              <AgendaView
                events={events}
                currentDate={currentDate}
                onEventClick={handleEventClick}
              />
            )}
          </>
        )}
      </div>

      {/* Event Modal */}
      <EventModal
        open={showEventModal}
        onOpenChange={handleModalClose}
        event={selectedEvent}
        defaultDate={selectedSlot?.date}
        defaultHour={selectedSlot?.hour}
        accountId={accountId}
      />
    </div>
  );
}
