// =============================================================================
// ACTION REQUIRED CARD COMPONENT
// =============================================================================
//
// Shows urgent commitments that need immediate action.
// Sorted by urgency with quick action buttons.
//

import { motion } from "framer-motion";
import { format, formatDistanceToNow, isPast } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MoreHorizontal,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ActionCommitment {
  id: string;
  title: string;
  dueDate: Date | null;
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  daysOverdue?: number;
  debtor?: { displayName?: string | null; primaryEmail?: string } | null;
  creditor?: { displayName?: string | null; primaryEmail?: string } | null;
  sourceThread?: { id: string; subject?: string | null } | null;
}

interface ActionRequiredCardProps {
  commitments: ActionCommitment[];
  onComplete?: (id: string) => void;
  onSnooze?: (id: string, days: number) => void;
  onViewThread?: (threadId: string) => void;
}

function getUrgencyBadge(dueDate: Date | null, daysOverdue?: number) {
  if (daysOverdue && daysOverdue > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        {daysOverdue}d overdue
      </span>
    );
  }

  if (dueDate && isPast(dueDate)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        Overdue
      </span>
    );
  }

  if (dueDate) {
    const distance = formatDistanceToNow(dueDate, { addSuffix: true });
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-700 dark:text-amber-400">
        <Clock className="h-3 w-3" />
        {distance}
      </span>
    );
  }

  return null;
}

export function ActionRequiredCard({
  commitments,
  onComplete,
  onSnooze,
  onViewThread,
}: ActionRequiredCardProps) {
  // Show only action-required (overdue or due soon)
  const actionItems = commitments
    .filter((c) => c.direction === "owed_by_me" && c.status !== "completed")
    .slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-card rounded-xl border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-500/10">
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </div>
          <h3 className="font-semibold text-sm">Action Required</h3>
          {actionItems.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-700 dark:text-red-400">
              {actionItems.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/commitments">
          <Button variant="ghost" size="sm" className="text-xs h-7">
            View All
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {actionItems.length === 0 ? (
          <div className="p-6 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <p className="text-sm text-muted-foreground">No pending actions</p>
            <p className="text-xs text-muted-foreground mt-1">You're all caught up!</p>
          </div>
        ) : (
          actionItems.map((commitment, index) => (
            <motion.div
              key={commitment.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-3 hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-start gap-3">
                {/* Status indicator */}
                <div
                  className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                    commitment.daysOverdue && commitment.daysOverdue > 0
                      ? "bg-red-500 shadow-lg shadow-red-500/50"
                      : "bg-amber-500"
                  }`}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-sm truncate">{commitment.title}</p>
                    {getUrgencyBadge(commitment.dueDate, commitment.daysOverdue)}
                  </div>

                  {commitment.creditor && (
                    <p className="text-xs text-muted-foreground truncate">
                      Owed to{" "}
                      {commitment.creditor.displayName ||
                        commitment.creditor.primaryEmail ||
                        "Unknown"}
                    </p>
                  )}

                  {commitment.sourceThread?.subject && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      Re: {commitment.sourceThread.subject}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onComplete?.(commitment.id)}
                  >
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onSnooze?.(commitment.id, 1)}>
                        Snooze 1 day
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSnooze?.(commitment.id, 3)}>
                        Snooze 3 days
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSnooze?.(commitment.id, 7)}>
                        Snooze 1 week
                      </DropdownMenuItem>
                      {commitment.sourceThread?.id && (
                        <DropdownMenuItem
                          onClick={() => onViewThread?.(commitment.sourceThread!.id)}
                        >
                          View thread
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  );
}
