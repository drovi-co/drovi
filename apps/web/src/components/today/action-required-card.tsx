// =============================================================================
// ACTION REQUIRED CARD COMPONENT
// =============================================================================
//
// Shows urgent commitments that need immediate action.
// Sorted by urgency with quick action buttons.
//

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow, isPast } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  MoreHorizontal,
} from "lucide-react";
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
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-red-700 text-xs dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        {daysOverdue}d overdue
      </span>
    );
  }

  if (dueDate && isPast(dueDate)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-red-700 text-xs dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        Overdue
      </span>
    );
  }

  if (dueDate) {
    const distance = formatDistanceToNow(dueDate, { addSuffix: true });
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 font-medium text-amber-700 text-xs dark:text-amber-400">
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
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border bg-card"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.1 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-red-500/10 p-1.5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </div>
          <h3 className="font-semibold text-sm">Action Required</h3>
          {actionItems.length > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-red-700 text-xs dark:text-red-400">
              {actionItems.length}
            </span>
          )}
        </div>
        <Link to="/dashboard/commitments">
          <Button className="h-7 text-xs" size="sm" variant="ghost">
            View All
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {actionItems.length === 0 ? (
          <div className="p-6 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
            <p className="text-muted-foreground text-sm">No pending actions</p>
            <p className="mt-1 text-muted-foreground text-xs">
              You're all caught up!
            </p>
          </div>
        ) : (
          actionItems.map((commitment, index) => (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="group p-3 transition-colors hover:bg-muted/30"
              initial={{ opacity: 0, x: -10 }}
              key={commitment.id}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start gap-3">
                {/* Status indicator */}
                <div
                  className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${
                    commitment.daysOverdue && commitment.daysOverdue > 0
                      ? "bg-red-500 shadow-lg shadow-red-500/50"
                      : "bg-amber-500"
                  }`}
                />

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <p className="truncate font-medium text-sm">
                      {commitment.title}
                    </p>
                    {getUrgencyBadge(
                      commitment.dueDate,
                      commitment.daysOverdue
                    )}
                  </div>

                  {commitment.creditor && (
                    <p className="truncate text-muted-foreground text-xs">
                      Owed to{" "}
                      {commitment.creditor.displayName ||
                        commitment.creditor.primaryEmail ||
                        "Unknown"}
                    </p>
                  )}

                  {commitment.sourceThread?.subject && (
                    <p className="mt-0.5 truncate text-muted-foreground text-xs">
                      Re: {commitment.sourceThread.subject}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    className="h-7 w-7"
                    onClick={() => onComplete?.(commitment.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="h-7 w-7" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onSnooze?.(commitment.id, 1)}
                      >
                        Snooze 1 day
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onSnooze?.(commitment.id, 3)}
                      >
                        Snooze 3 days
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onSnooze?.(commitment.id, 7)}
                      >
                        Snooze 1 week
                      </DropdownMenuItem>
                      {commitment.sourceThread?.id && (
                        <DropdownMenuItem
                          onClick={() =>
                            onViewThread?.(commitment.sourceThread!.id)
                          }
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
