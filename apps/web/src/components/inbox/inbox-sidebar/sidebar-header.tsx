// =============================================================================
// SIDEBAR HEADER COMPONENT
// =============================================================================
//
// Date navigation header for the inbox sidebar.
// Shows current date with prev/next navigation.
//

import { addDays, format, isToday, isTomorrow, isYesterday } from "date-fns";
import { motion } from "framer-motion";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SidebarHeaderProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  className?: string;
}

function formatDateLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE");
}

export function SidebarHeader({
  selectedDate,
  onDateChange,
  className,
}: SidebarHeaderProps) {
  const dateLabel = formatDateLabel(selectedDate);
  const dateFormatted = format(selectedDate, "MMM d");
  const isViewingToday = isToday(selectedDate);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("px-4 py-3", className)}
      initial={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between">
        {/* Date display */}
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Calendar className="h-4 w-4 text-primary-foreground/60" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">{dateLabel}</h2>
            <p className="text-muted-foreground text-xs">{dateFormatted}</p>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          {!isViewingToday && (
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => onDateChange(new Date())}
              size="sm"
              variant="ghost"
            >
              Today
            </Button>
          )}
          <Button
            aria-label="Previous day"
            className="h-7 w-7"
            onClick={() => onDateChange(addDays(selectedDate, -1))}
            size="icon"
            variant="ghost"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            aria-label="Next day"
            className="h-7 w-7"
            onClick={() => onDateChange(addDays(selectedDate, 1))}
            size="icon"
            variant="ghost"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
