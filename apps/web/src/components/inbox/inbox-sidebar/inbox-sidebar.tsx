// =============================================================================
// INBOX SIDEBAR COMPONENT
// =============================================================================
//
// Beautiful, information-dense sidebar for the smart inbox.
// Orchestrates schedule, commitments, stats, and AI insights sections.
//

import { Link } from "@tanstack/react-router";
import { startOfDay } from "date-fns";
import { motion } from "framer-motion";
import { Calendar, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CommitmentsSection,
  type SidebarCommitment,
} from "./commitments-section";
import { InboxPulse, type InboxStats } from "./inbox-pulse";
import { QuickInsights, type Insight } from "./quick-insights";
import { ScheduleSection, type CalendarEvent } from "./schedule-section";
import { SidebarHeader } from "./sidebar-header";

// =============================================================================
// TYPES
// =============================================================================

export type { CalendarEvent } from "./schedule-section";
export type { SidebarCommitment } from "./commitments-section";
export type { InboxStats } from "./inbox-pulse";
export type { Insight } from "./quick-insights";

export interface InboxSidebarProps {
  // Data
  events?: CalendarEvent[];
  commitments?: SidebarCommitment[];
  stats?: InboxStats;
  insights?: Insight[];

  // Handlers
  onEventClick?: (id: string) => void;
  onCommitmentClick?: (id: string) => void;
  onCommitmentComplete?: (id: string) => void;
  onInsightClick?: (insight: Insight) => void;
  onCreateEvent?: () => void;

  // Config
  className?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function InboxSidebar({
  events = [],
  commitments = [],
  stats,
  insights = [],
  onEventClick,
  onCommitmentClick,
  onCommitmentComplete,
  onInsightClick,
  onCreateEvent,
  className,
}: InboxSidebarProps) {
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Filter events for selected date
  const dayEvents = events.filter(
    (e) =>
      startOfDay(e.startTime).getTime() === startOfDay(selectedDate).getTime()
  );

  // Filter commitments for selected date (or all due soon)
  const relevantCommitments = commitments.filter((c) => {
    if (!c.dueDate) return false;
    const dueDay = startOfDay(c.dueDate).getTime();
    const selectedDay = startOfDay(selectedDate).getTime();
    // Show if due on selected day or overdue
    return dueDay <= selectedDay;
  });

  // Default stats if not provided
  const displayStats: InboxStats = stats ?? {
    unread: 0,
    starred: 0,
    urgent: 0,
    avgResponseTimeHours: undefined,
    responseTrend: undefined,
  };

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "flex h-full w-80 flex-col border-l bg-background",
        className
      )}
      initial={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <SidebarHeader
        onDateChange={setSelectedDate}
        selectedDate={selectedDate}
      />

      {/* Scrollable content */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Schedule Section */}
        <ScheduleSection events={dayEvents} onEventClick={onEventClick} />

        {/* Commitments Section */}
        <CommitmentsSection
          commitments={relevantCommitments}
          onCommitmentClick={onCommitmentClick}
          onComplete={onCommitmentComplete}
        />

        {/* Inbox Pulse */}
        <InboxPulse stats={displayStats} />

        {/* Quick Insights */}
        {insights.length > 0 && (
          <QuickInsights insights={insights} onInsightClick={onInsightClick} />
        )}
      </div>

      {/* Footer actions */}
      <div className="border-t p-3">
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
                    Full Calendar
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
                <TooltipContent>Quick add event</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </motion.div>
  );
}
