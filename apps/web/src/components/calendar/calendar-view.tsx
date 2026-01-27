"use client";

import { useQuery } from "@tanstack/react-query";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";
import { AgendaView } from "./agenda-view";
import { DayView } from "./day-view";
import { EventModal } from "./event-modal";
import { MonthView } from "./month-view";
import type { CalendarEvent, CalendarViewProps, ViewType } from "./types";
import { WeekView } from "./week-view";

// =============================================================================
// HELPERS
// =============================================================================

function getDateRange(
  date: Date,
  view: ViewType
): { timeMin: Date; timeMax: Date } {
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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null
  );
  const [selectedSlot, setSelectedSlot] = useState<{
    date: Date;
    hour?: number;
  } | null>(null);

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
    if (!eventsData?.items) {
      return [];
    }

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
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            className="text-sm"
            onClick={() => navigate("today")}
            size="sm"
            variant="outline"
          >
            Today
          </Button>
          <div className="flex items-center">
            <Button
              aria-label="Previous"
              onClick={() => navigate("prev")}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              aria-label="Next"
              onClick={() => navigate("next")}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h2 className="ml-2 font-semibold text-lg">
            {formatDateHeader(currentDate, view)}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {/* View switcher */}
          <div className="flex overflow-hidden rounded-lg border">
            {(["day", "week", "month", "agenda"] as ViewType[]).map((v) => (
              <Button
                className={cn(
                  "rounded-none border-0 capitalize",
                  view === v && "bg-accent"
                )}
                key={v}
                onClick={() => setView(v)}
                size="sm"
                variant={view === v ? "secondary" : "ghost"}
              >
                {v}
              </Button>
            ))}
          </div>

          <Button onClick={handleCreateClick} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Create
          </Button>
        </div>
      </div>

      {/* Calendar Content */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <CalendarIcon className="mb-3 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">
              Failed to load calendar events
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              {error.message}
            </p>
          </div>
        ) : (
          <>
            {view === "month" && (
              <MonthView
                currentDate={currentDate}
                events={events}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "week" && (
              <WeekView
                currentDate={currentDate}
                events={events}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "day" && (
              <DayView
                currentDate={currentDate}
                events={events}
                onEventClick={handleEventClick}
                onSlotClick={handleSlotClick}
              />
            )}
            {view === "agenda" && (
              <AgendaView
                currentDate={currentDate}
                events={events}
                onEventClick={handleEventClick}
              />
            )}
          </>
        )}
      </div>

      {/* Event Modal */}
      <EventModal
        accountId={accountId}
        defaultDate={selectedSlot?.date}
        defaultHour={selectedSlot?.hour}
        event={selectedEvent}
        onOpenChange={handleModalClose}
        open={showEventModal}
      />
    </div>
  );
}
