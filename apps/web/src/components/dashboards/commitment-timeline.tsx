// =============================================================================
// COMMITMENT TIMELINE COMPONENT
// =============================================================================
//
// Visual timeline of commitments organized by due date, showing the flow of
// obligations over time. This isn't just a calendar - it's a visual map of
// your accountability landscape.
//

import { format, isSameDay, startOfWeek, addDays, isToday, isPast } from "date-fns";
import { motion } from "framer-motion";
import { AlertCircle, Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CommitmentCardData } from "./commitment-card";

// =============================================================================
// TYPES
// =============================================================================

interface CommitmentTimelineProps {
  commitments: CommitmentCardData[];
  onCommitmentClick?: (commitment: CommitmentCardData) => void;
  onDateClick?: (date: Date) => void;
  className?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CommitmentTimeline({
  commitments,
  onCommitmentClick,
  onDateClick,
  className,
}: CommitmentTimelineProps) {
  const [weekOffset, setWeekOffset] = useState(0);

  // Get the start of the current view week
  const viewWeekStart = useMemo(() => {
    const today = new Date();
    const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
    return addDays(weekStart, weekOffset * 7);
  }, [weekOffset]);

  // Generate days for the week
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(viewWeekStart, i));
  }, [viewWeekStart]);

  // Group commitments by day
  const commitmentsByDay = useMemo(() => {
    const grouped = new Map<string, CommitmentCardData[]>();

    for (const c of commitments) {
      if (!c.dueDate) continue;
      const dayKey = format(c.dueDate, "yyyy-MM-dd");
      const existing = grouped.get(dayKey) ?? [];
      existing.push(c);
      grouped.set(dayKey, existing);
    }

    return grouped;
  }, [commitments]);

  // Commitments without due dates
  const noDueDate = commitments.filter((c) => !c.dueDate);

  // Navigate
  const goToPrevWeek = () => setWeekOffset((o) => o - 1);
  const goToNextWeek = () => setWeekOffset((o) => o + 1);
  const goToToday = () => setWeekOffset(0);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPrevWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">
          {format(viewWeekStart, "MMMM d")} - {format(addDays(viewWeekStart, 6), "MMMM d, yyyy")}
        </span>
      </div>

      {/* Week Grid */}
      <div className="grid grid-cols-7 gap-2">
        {weekDays.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const dayCommitments = commitmentsByDay.get(dayKey) ?? [];
          const hasOverdue = dayCommitments.some((c) => c.status === "overdue" || (c.dueDate && isPast(c.dueDate)));
          const isDayToday = isToday(day);
          const isDayPast = isPast(day) && !isDayToday;

          return (
            <motion.div
              key={dayKey}
              layout
              className={cn(
                "min-h-[120px] rounded-lg border p-2 transition-colors",
                isDayToday && "border-primary bg-primary/5",
                isDayPast && "opacity-60",
                hasOverdue && "border-red-300 bg-red-50 dark:bg-red-900/10"
              )}
            >
              {/* Day Header */}
              <button
                type="button"
                onClick={() => onDateClick?.(day)}
                className={cn(
                  "w-full flex items-center justify-between mb-2 pb-1 border-b",
                  "hover:bg-muted/50 rounded transition-colors"
                )}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  {format(day, "EEE")}
                </span>
                <span className={cn(
                  "text-sm font-semibold",
                  isDayToday && "bg-primary text-primary-foreground px-1.5 rounded-full"
                )}>
                  {format(day, "d")}
                </span>
              </button>

              {/* Commitments */}
              <div className="space-y-1.5">
                {dayCommitments.slice(0, 3).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onCommitmentClick?.(c)}
                    className={cn(
                      "w-full text-left p-1.5 rounded text-xs transition-colors",
                      "hover:bg-muted/80 truncate",
                      c.direction === "owed_by_me" && "bg-blue-100/50 dark:bg-blue-900/20",
                      c.direction === "owed_to_me" && "bg-purple-100/50 dark:bg-purple-900/20",
                      c.status === "overdue" && "bg-red-100 dark:bg-red-900/30"
                    )}
                  >
                    <div className="flex items-center gap-1">
                      {(c.status === "overdue" || (c.dueDate && isPast(c.dueDate))) && (
                        <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
                      )}
                      <span className="truncate">{c.title}</span>
                    </div>
                  </button>
                ))}

                {/* More indicator */}
                {dayCommitments.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onDateClick?.(day)}
                    className="w-full text-xs text-muted-foreground hover:text-foreground text-center"
                  >
                    +{dayCommitments.length - 3} more
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* No Due Date Section */}
      {noDueDate.length > 0 && (
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-muted-foreground">
              No Due Date ({noDueDate.length})
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {noDueDate.slice(0, 5).map((c) => (
              <Badge
                key={c.id}
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80"
                onClick={() => onCommitmentClick?.(c)}
              >
                {c.title.slice(0, 30)}
                {c.title.length > 30 && "..."}
              </Badge>
            ))}
            {noDueDate.length > 5 && (
              <Badge variant="outline">+{noDueDate.length - 5} more</Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
