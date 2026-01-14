// =============================================================================
// TIMELINE VIEW COMPONENT
// =============================================================================
//
// Horizontal timeline showing today's commitments by due time.
// Visual urgency indicators and hover details.
//

import { motion } from "framer-motion";
import { format, isToday, isPast, differenceInHours } from "date-fns";
import { Clock, AlertCircle, CheckCircle2 } from "lucide-react";
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
  if (status === "completed") return "bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-400";
  if (!dueDate) return "bg-muted border-muted-foreground/30 text-muted-foreground";

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
  if (status === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (!dueDate) return <Clock className="h-3 w-3" />;
  if (isPast(dueDate)) return <AlertCircle className="h-3 w-3" />;
  return <Clock className="h-3 w-3" />;
}

export function TimelineView({ commitments, onCommitmentClick }: TimelineViewProps) {
  // Filter to today's commitments only
  const todayCommitments = commitments.filter((c) => {
    if (!c.dueDate) return false;
    return isToday(c.dueDate) || isPast(c.dueDate);
  });

  // Sort by due time
  const sortedCommitments = [...todayCommitments].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  if (sortedCommitments.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-muted/30 rounded-lg p-6 text-center"
      >
        <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-muted-foreground">No commitments due today</p>
        <p className="text-xs text-muted-foreground mt-1">
          You're all caught up!
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl border p-4"
    >
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Today's Timeline
        </h2>
        <span className="text-xs text-muted-foreground">
          ({sortedCommitments.length} item{sortedCommitments.length !== 1 ? "s" : ""})
        </span>
      </div>

      {/* Timeline container */}
      <div className="relative pt-2 pb-4">
        {/* Time labels row */}
        <div className="flex justify-between items-center mb-3 px-1">
          <span className="text-xs text-muted-foreground font-mono">NOW</span>
          <span className="text-xs text-muted-foreground font-mono">EOD</span>
        </div>

        {/* Timeline line */}
        <div className="relative h-0.5 bg-gradient-to-r from-primary/40 via-muted-foreground/20 to-muted rounded-full mb-4" />

        {/* Commitments row - positioned after the line */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <TooltipProvider>
            {sortedCommitments.map((commitment, index) => {
              const urgencyClass = getUrgencyClass(commitment.dueDate, commitment.status);
              const icon = getUrgencyIcon(commitment.dueDate, commitment.status);

              return (
                <Tooltip key={commitment.id}>
                  <TooltipTrigger asChild>
                    <motion.button
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      onClick={() => onCommitmentClick?.(commitment.id)}
                      className={`
                        flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border
                        transition-all hover:scale-105 hover:-translate-y-0.5 cursor-pointer
                        ${urgencyClass}
                      `}
                    >
                      {icon}
                      <span className="text-sm font-medium max-w-[150px] truncate">
                        {commitment.title}
                      </span>
                      {commitment.dueDate && (
                        <span className="text-xs opacity-70 font-mono">
                          {format(commitment.dueDate, "h:mm a")}
                        </span>
                      )}
                    </motion.button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1">
                      <p className="font-medium">{commitment.title}</p>
                      {commitment.dueDate && (
                        <p className="text-xs text-muted-foreground">
                          Due: {format(commitment.dueDate, "MMM d, h:mm a")}
                        </p>
                      )}
                      <p className="text-xs">
                        {commitment.direction === "owed_by_me" ? "You owe this" : "Owed to you"}
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
