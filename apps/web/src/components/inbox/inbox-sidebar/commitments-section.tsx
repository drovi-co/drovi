// =============================================================================
// COMMITMENTS SECTION COMPONENT
// =============================================================================
//
// Shows due commitments with urgency indicators.
// Red = overdue, Amber = due soon. Max 2 visible with "view all" link.
//

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow, isPast, isToday } from "date-fns";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SidebarCommitment {
  id: string;
  title: string;
  dueDate: Date | null;
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  daysOverdue?: number;
  creditor?: { displayName?: string | null; primaryEmail?: string } | null;
}

interface CommitmentsSectionProps {
  commitments: SidebarCommitment[];
  onCommitmentClick?: (id: string) => void;
  onComplete?: (id: string) => void;
  maxVisible?: number;
  className?: string;
}

function getUrgencyStatus(
  dueDate: Date | null,
  daysOverdue?: number
): {
  label: string;
  color: "red" | "amber" | "blue" | "gray";
  icon: typeof AlertTriangle | typeof Clock;
} {
  if (daysOverdue && daysOverdue > 0) {
    return {
      label: `${daysOverdue}d overdue`,
      color: "red",
      icon: AlertTriangle,
    };
  }

  if (dueDate) {
    if (isPast(dueDate) && !isToday(dueDate)) {
      return { label: "Overdue", color: "red", icon: AlertTriangle };
    }
    if (isToday(dueDate)) {
      return { label: "Due today", color: "amber", icon: Clock };
    }
    return {
      label: formatDistanceToNow(dueDate, { addSuffix: true }),
      color: "blue",
      icon: Clock,
    };
  }

  return { label: "No due date", color: "gray", icon: Clock };
}

function CommitmentItem({
  commitment,
  onClick,
  onComplete,
  index,
}: {
  commitment: SidebarCommitment;
  onClick?: (id: string) => void;
  onComplete?: (id: string) => void;
  index: number;
}) {
  const urgency = getUrgencyStatus(commitment.dueDate, commitment.daysOverdue);
  const UrgencyIcon = urgency.icon;

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      className="group relative"
      initial={{ opacity: 0, x: -10 }}
      transition={{ delay: index * 0.03 }}
    >
      <button
        className={cn(
          "w-full px-3 py-2.5 text-left transition-colors",
          "flex items-start gap-3 hover:bg-muted/50",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        onClick={() => onClick?.(commitment.id)}
        type="button"
      >
        {/* Urgency dot */}
        <div
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            urgency.color === "red" &&
              "bg-rose-500/80 shadow-rose-500/30 shadow-sm",
            urgency.color === "amber" && "bg-amber-500/70",
            urgency.color === "blue" && "bg-indigo-500/70",
            urgency.color === "gray" && "bg-muted-foreground/40"
          )}
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{commitment.title}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                urgency.color === "red" &&
                  "text-rose-600/80 dark:text-rose-400/80",
                urgency.color === "amber" &&
                  "text-amber-600/80 dark:text-amber-400/80",
                urgency.color === "blue" &&
                  "text-indigo-600/80 dark:text-indigo-400/80",
                urgency.color === "gray" && "text-muted-foreground"
              )}
            >
              <UrgencyIcon className="h-3 w-3" />
              {urgency.label}
            </span>
            {commitment.creditor && (
              <span className="truncate text-muted-foreground text-xs">
                ·{" "}
                {commitment.creditor.displayName ||
                  commitment.creditor.primaryEmail}
              </span>
            )}
          </div>
        </div>

        {/* Complete button (shows on hover) */}
        {onComplete && (
          <Button
            className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onComplete(commitment.id);
            }}
            size="icon"
            variant="ghost"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600/70 dark:text-emerald-400/70" />
          </Button>
        )}
      </button>
    </motion.div>
  );
}

export function CommitmentsSection({
  commitments,
  onCommitmentClick,
  onComplete,
  maxVisible = 2,
  className,
}: CommitmentsSectionProps) {
  // Filter to show only active commitments owed by me
  const activeCommitments = commitments
    .filter((c) => c.direction === "owed_by_me" && c.status !== "completed")
    .slice(0, maxVisible);

  const totalActive = commitments.filter(
    (c) => c.direction === "owed_by_me" && c.status !== "completed"
  ).length;

  const hasMore = totalActive > maxVisible;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.15 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1">
            <Target className="h-3.5 w-3.5 text-primary-foreground/60" />
          </div>
          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Commitments
          </h4>
        </div>
        {totalActive > 0 && (
          <span className="rounded-full bg-primary/20 px-1.5 py-0.5 font-medium text-[10px] text-foreground/70">
            {totalActive}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="divide-y divide-border/50">
        {activeCommitments.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <div className="mb-2 rounded-full bg-primary/10 p-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600/70 dark:text-emerald-400/70" />
            </div>
            <p className="font-medium text-muted-foreground text-sm">
              All caught up!
            </p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              No pending commitments
            </p>
          </div>
        ) : (
          <>
            {activeCommitments.map((commitment, index) => (
              <CommitmentItem
                commitment={commitment}
                index={index}
                key={commitment.id}
                onClick={onCommitmentClick}
                onComplete={onComplete}
              />
            ))}

            {/* View all link */}
            {hasMore && (
              <Link
                className="flex h-8 w-full items-center justify-center gap-1 text-muted-foreground text-xs transition-colors hover:bg-muted/50 hover:text-foreground"
                to="/dashboard/commitments"
              >
                View all {totalActive} commitments
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
