// =============================================================================
// COMMITMENT CARD COMPONENT
// =============================================================================
//
// Intelligence-first commitment display with evidence links, confidence
// indicators, and quick actions. Not just a task card - it's an accountability
// surface showing the full context of the promise.
//

import { format, formatDistanceToNow, isPast, isToday, isTomorrow, isThisWeek } from "date-fns";
import { motion } from "framer-motion";
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Pause,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentCardData {
  id: string;
  title: string;
  description?: string | null;
  status: "pending" | "in_progress" | "completed" | "cancelled" | "overdue" | "waiting" | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  confidence: number;
  isUserVerified?: boolean;
  evidence?: string[];
  debtor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  creditor?: {
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  } | null;
  sourceThread?: {
    id: string;
    subject?: string | null;
    snippet?: string | null;
  } | null;
  daysOverdue?: number;
}

interface CommitmentCardProps {
  commitment: CommitmentCardData;
  isSelected?: boolean;
  onSelect?: () => void;
  onComplete?: (commitmentId: string) => void;
  onSnooze?: (commitmentId: string, days: number) => void;
  onDismiss?: (commitmentId: string) => void;
  onVerify?: (commitmentId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onGenerateFollowUp?: (commitmentId: string) => void;
  compact?: boolean;
}

// =============================================================================
// URGENCY HELPERS
// =============================================================================

function getUrgencyLevel(dueDate: Date | null | undefined, status: string): "overdue" | "urgent" | "soon" | "normal" {
  if (status === "overdue") return "overdue";
  if (!dueDate) return "normal";

  if (isPast(dueDate)) return "overdue";
  if (isToday(dueDate) || isTomorrow(dueDate)) return "urgent";
  if (isThisWeek(dueDate)) return "soon";
  return "normal";
}

function getUrgencyStyles(urgency: "overdue" | "urgent" | "soon" | "normal"): string {
  switch (urgency) {
    case "overdue":
      return "border-l-red-500 bg-red-500/5";
    case "urgent":
      return "border-l-orange-500 bg-orange-500/5";
    case "soon":
      return "border-l-amber-500 bg-amber-500/5";
    default:
      return "border-l-border";
  }
}

function getPriorityBadge(priority: string): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  switch (priority) {
    case "urgent":
      return { variant: "destructive", label: "Urgent" };
    case "high":
      return { variant: "default", label: "High" };
    case "medium":
      return { variant: "secondary", label: "Medium" };
    default:
      return { variant: "outline", label: "Low" };
  }
}

function getStatusBadge(status: string): { variant: "default" | "secondary" | "destructive" | "outline"; label: string } {
  switch (status) {
    case "overdue":
      return { variant: "destructive", label: "Overdue" };
    case "in_progress":
      return { variant: "default", label: "In Progress" };
    case "waiting":
      return { variant: "secondary", label: "Waiting" };
    case "snoozed":
      return { variant: "outline", label: "Snoozed" };
    case "completed":
      return { variant: "outline", label: "Done" };
    case "cancelled":
      return { variant: "outline", label: "Cancelled" };
    default:
      return { variant: "secondary", label: "Pending" };
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CommitmentCard({
  commitment,
  isSelected = false,
  onSelect,
  onComplete,
  onSnooze,
  onDismiss,
  onVerify,
  onThreadClick,
  onContactClick,
  onGenerateFollowUp,
  compact = false,
}: CommitmentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const urgency = getUrgencyLevel(commitment.dueDate, commitment.status);
  const priorityBadge = getPriorityBadge(commitment.priority);
  const statusBadge = getStatusBadge(commitment.status);

  // The person responsible or expecting
  const otherPerson = commitment.direction === "owed_by_me"
    ? commitment.creditor
    : commitment.debtor;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={cn(
        "group relative border-l-4 rounded-lg bg-card transition-all",
        "hover:shadow-md cursor-pointer",
        getUrgencyStyles(urgency),
        isSelected && "ring-2 ring-primary",
        compact ? "p-3" : "p-4"
      )}
      onClick={onSelect}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Expand/Collapse Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>

          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className={cn(
              "font-medium text-foreground line-clamp-2",
              compact ? "text-sm" : "text-base"
            )}>
              {commitment.title}
            </h3>

            {/* Meta Row */}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Direction Indicator */}
              <span className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded",
                commitment.direction === "owed_by_me"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                  : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
              )}>
                {commitment.direction === "owed_by_me" ? "I owe" : "Owed to me"}
              </span>

              {/* Other Person */}
              {otherPerson && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onContactClick?.(otherPerson.primaryEmail);
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <User className="h-3 w-3" />
                  <span className="truncate max-w-[120px]">
                    {otherPerson.displayName ?? otherPerson.primaryEmail}
                  </span>
                </button>
              )}

              {/* Due Date */}
              {commitment.dueDate && (
                <span className={cn(
                  "flex items-center gap-1 text-xs",
                  urgency === "overdue" && "text-red-600 dark:text-red-400 font-medium",
                  urgency === "urgent" && "text-orange-600 dark:text-orange-400",
                  urgency === "soon" && "text-amber-600 dark:text-amber-400",
                  urgency === "normal" && "text-muted-foreground"
                )}>
                  <Calendar className="h-3 w-3" />
                  {isPast(commitment.dueDate)
                    ? `${commitment.daysOverdue ?? Math.floor((Date.now() - commitment.dueDate.getTime()) / (1000 * 60 * 60 * 24))}d overdue`
                    : isToday(commitment.dueDate)
                      ? "Today"
                      : isTomorrow(commitment.dueDate)
                        ? "Tomorrow"
                        : formatDistanceToNow(commitment.dueDate, { addSuffix: true })
                  }
                </span>
              )}

              {/* Confidence Indicator */}
              <span className={cn(
                "text-xs",
                commitment.confidence >= 0.8 && "text-green-600 dark:text-green-400",
                commitment.confidence >= 0.5 && commitment.confidence < 0.8 && "text-amber-600 dark:text-amber-400",
                commitment.confidence < 0.5 && "text-red-600 dark:text-red-400"
              )}>
                {Math.round(commitment.confidence * 100)}% confident
              </span>

              {/* User Verified Badge */}
              {commitment.isUserVerified && (
                <Badge variant="outline" className="text-xs h-5">
                  <Check className="h-3 w-3 mr-1" />
                  Verified
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Badges & Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={statusBadge.variant} className="text-xs">
            {statusBadge.label}
          </Badge>

          {commitment.priority !== "medium" && (
            <Badge variant={priorityBadge.variant} className="text-xs">
              {priorityBadge.label}
            </Badge>
          )}

          {/* Quick Complete Button */}
          {commitment.status !== "completed" && commitment.status !== "cancelled" && onComplete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onComplete(commitment.id);
              }}
              title="Mark complete"
            >
              <Check className="h-4 w-4 text-green-600" />
            </Button>
          )}

          {/* More Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {commitment.status !== "completed" && (
                <>
                  {onComplete && (
                    <DropdownMenuItem onClick={() => onComplete(commitment.id)}>
                      <Check className="h-4 w-4 mr-2" />
                      Mark Complete
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {onSnooze && (
                    <>
                      <DropdownMenuItem onClick={() => onSnooze(commitment.id, 1)}>
                        <Clock className="h-4 w-4 mr-2" />
                        Snooze 1 day
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSnooze(commitment.id, 3)}>
                        <Pause className="h-4 w-4 mr-2" />
                        Snooze 3 days
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSnooze(commitment.id, 7)}>
                        <Pause className="h-4 w-4 mr-2" />
                        Snooze 1 week
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                </>
              )}
              {commitment.direction === "owed_to_me" && urgency === "overdue" && onGenerateFollowUp && (
                <DropdownMenuItem onClick={() => onGenerateFollowUp(commitment.id)}>
                  <Mail className="h-4 w-4 mr-2" />
                  Generate Follow-up
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {!commitment.isUserVerified && onVerify && (
                <DropdownMenuItem onClick={() => onVerify(commitment.id)}>
                  <ThumbsUp className="h-4 w-4 mr-2" />
                  Verify (Correct)
                </DropdownMenuItem>
              )}
              {onDismiss && (
                <DropdownMenuItem onClick={() => onDismiss(commitment.id)} className="text-destructive">
                  <ThumbsDown className="h-4 w-4 mr-2" />
                  Dismiss (Incorrect)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-4 pt-4 border-t space-y-3"
        >
          {/* Description */}
          {commitment.description && (
            <p className="text-sm text-muted-foreground">
              {commitment.description}
            </p>
          )}

          {/* Source Thread */}
          {commitment.sourceThread && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onThreadClick?.(commitment.sourceThread!.id);
              }}
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="truncate">
                From: {commitment.sourceThread.subject ?? "Email thread"}
              </span>
            </button>
          )}

          {/* Evidence */}
          {commitment.evidence && commitment.evidence.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Evidence:</span>
              {commitment.evidence.map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground italic pl-2 border-l-2 border-muted">
                  "{e}"
                </p>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
