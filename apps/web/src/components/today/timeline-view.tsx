// =============================================================================
// TIMELINE VIEW COMPONENT
// =============================================================================
//
// Horizontal timeline showing today's commitments by due time.
// Visual urgency indicators and hover details.
//

import { differenceInHours, format, isPast, isToday } from "date-fns";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TimelineCommitment {
  id: string;
  title: string;
  dueDate: Date | null;
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  sourceThreadId?: string | null;
}

interface TimelineViewProps {
  commitments: TimelineCommitment[];
  onCommitmentClick?: (id: string) => void;
}

function getUrgencyClass(dueDate: Date | null, status: string): string {
  if (status === "completed") {
    return "bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-400";
  }
  if (!dueDate) {
    return "bg-muted border-muted-foreground/30 text-muted-foreground";
  }

  if (isPast(dueDate)) {
    return "bg-red-500/20 border-red-500/50 text-red-700 dark:text-red-400 shadow-red-500/20 shadow-lg";
  }

  const hoursUntil = differenceInHours(dueDate, new Date());
  if (hoursUntil <= 2) {
    return "bg-amber-500/20 border-amber-500/50 text-amber-700 dark:text-amber-400";
  }
  if (hoursUntil <= 6) {
    return "bg-yellow-500/20 border-yellow-500/50 text-yellow-700 dark:text-yellow-400";
  }

  return "bg-blue-500/20 border-blue-500/50 text-blue-700 dark:text-blue-400";
}

function getUrgencyIcon(dueDate: Date | null, status: string) {
  if (status === "completed") {
    return <CheckCircle2 className="h-3 w-3" />;
  }
  if (!dueDate) {
    return <Clock className="h-3 w-3" />;
  }
  if (isPast(dueDate)) {
    return <AlertCircle className="h-3 w-3" />;
  }
  return <Clock className="h-3 w-3" />;
}

export function TimelineView({
  commitments,
  onCommitmentClick,
}: TimelineViewProps) {
  // Filter to today's commitments only
  const todayCommitments = commitments.filter((c) => {
    if (!c.dueDate) {
      return false;
    }
    return isToday(c.dueDate) || isPast(c.dueDate);
  });

  // Sort by due time
  const sortedCommitments = [...todayCommitments].sort((a, b) => {
    if (!a.dueDate) {
      return 1;
    }
    if (!b.dueDate) {
      return -1;
    }
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  if (sortedCommitments.length === 0) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-muted/30 p-6 text-center"
        initial={{ opacity: 0, y: 10 }}
      >
        <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
        <p className="text-muted-foreground">No commitments due today</p>
        <p className="mt-1 text-muted-foreground text-xs">
          You're all caught up!
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border bg-card p-4"
      initial={{ opacity: 0, y: 10 }}
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-semibold text-muted-foreground text-sm uppercase tracking-wider">
          Today's Timeline
        </h2>
        <span className="text-muted-foreground text-xs">
          ({sortedCommitments.length} item
          {sortedCommitments.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Timeline container */}
      <div className="relative pt-2 pb-4">
        {/* Time labels row */}
        <div className="mb-3 flex items-center justify-between px-1">
          <span className="font-mono text-muted-foreground text-xs">NOW</span>
          <span className="font-mono text-muted-foreground text-xs">EOD</span>
        </div>

        {/* Timeline line */}
        <div className="relative mb-4 h-0.5 rounded-full bg-gradient-to-r from-primary/40 via-muted-foreground/20 to-muted" />

        {/* Commitments row - positioned after the line */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <TooltipProvider>
            {sortedCommitments.map((commitment, index) => {
              const urgencyClass = getUrgencyClass(
                commitment.dueDate,
                commitment.status
              );
              const icon = getUrgencyIcon(
                commitment.dueDate,
                commitment.status
              );

              return (
                <Tooltip key={commitment.id}>
                  <TooltipTrigger asChild>
                    <motion.button
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-all hover:-translate-y-0.5 hover:scale-105 ${urgencyClass}
                      `}
                      initial={{ opacity: 0, y: 10 }}
                      onClick={() => onCommitmentClick?.(commitment.id)}
                      transition={{ delay: index * 0.05 }}
                    >
                      {icon}
                      <span className="max-w-[150px] truncate font-medium text-sm">
                        {commitment.title}
                      </span>
                      {commitment.dueDate && (
                        <span className="font-mono text-xs opacity-70">
                          {format(commitment.dueDate, "h:mm a")}
                        </span>
                      )}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs" side="bottom">
                    <div className="space-y-1">
                      <p className="font-medium">{commitment.title}</p>
                      {commitment.dueDate && (
                        <p className="text-muted-foreground text-xs">
                          Due: {format(commitment.dueDate, "MMM d, h:mm a")}
                        </p>
                      )}
                      <p className="text-xs">
                        {commitment.direction === "owed_by_me"
                          ? "You owe this"
                          : "Owed to you"}
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
    </motion.div>
  );
}
