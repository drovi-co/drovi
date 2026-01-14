// =============================================================================
// COMMITMENT CARD COMPONENT
// =============================================================================
//
// Intelligence-first commitment display with evidence links, confidence
// indicators, and quick actions. Not just a task card - it's an accountability
// surface showing the full context of the promise.
//

import { format, isPast, isToday, isTomorrow, isThisWeek } from "date-fns";
import {
  Check,
  Clock,
  ExternalLink,
  Eye,
  Mail,
  MoreHorizontal,
  Pause,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";

import { ConfidenceBadge } from "@/components/evidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
  onShowEvidence?: (commitmentId: string) => void;
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

function getInitials(name: string | null | undefined, email: string): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
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
  onShowEvidence,
}: CommitmentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const urgency = getUrgencyLevel(commitment.dueDate, commitment.status);
  const statusBadge = getStatusBadge(commitment.status);

  // The person responsible or expecting
  const otherPerson = commitment.direction === "owed_by_me"
    ? commitment.creditor
    : commitment.debtor;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors",
        "border-b border-border/40",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      {/* Priority indicator bar */}
      {urgency === "overdue" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
      )}
      {urgency === "urgent" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
      )}
      {urgency === "soon" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
      )}

      {/* Avatar */}
      {otherPerson ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs bg-muted font-medium">
            {getInitials(otherPerson.displayName, otherPerson.primaryEmail)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-full bg-muted flex items-center justify-center">
          <Check className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Direction badge */}
      <span className={cn(
        "text-xs font-medium px-1.5 py-0.5 rounded shrink-0",
        commitment.direction === "owed_by_me"
          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
          : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
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
          className="w-32 shrink-0 truncate text-sm font-medium text-foreground/80 hover:text-foreground transition-colors text-left"
        >
          {otherPerson.displayName ?? otherPerson.primaryEmail}
        </button>
      )}

      {/* Title - main content with AI indicator */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        <span className="text-sm truncate text-muted-foreground">
          {commitment.title}
        </span>
      </div>

      {/* Due Date */}
      {commitment.dueDate && !isHovered && (
        <span className={cn(
          "text-xs shrink-0",
          urgency === "overdue" && "text-red-600 dark:text-red-400 font-medium",
          urgency === "urgent" && "text-orange-600 dark:text-orange-400",
          urgency === "soon" && "text-amber-600 dark:text-amber-400",
          urgency === "normal" && "text-muted-foreground"
        )}>
          {isPast(commitment.dueDate)
            ? `${commitment.daysOverdue ?? Math.floor((Date.now() - commitment.dueDate.getTime()) / (1000 * 60 * 60 * 24))}d overdue`
            : isToday(commitment.dueDate)
              ? "Today"
              : isTomorrow(commitment.dueDate)
                ? "Tomorrow"
                : format(commitment.dueDate, "MMM d")
          }
        </span>
      )}

      {/* Quick actions - always visible */}
      <div className="shrink-0 flex items-center gap-1">
        {/* Status badge */}
        <Badge variant={statusBadge.variant} className="text-[10px] shrink-0">
          {statusBadge.label}
        </Badge>

        {/* Confidence Badge */}
        <ConfidenceBadge
          confidence={commitment.confidence}
          isUserVerified={commitment.isUserVerified}
          size="sm"
          showDetails={false}
        />

        {/* Show Me - Evidence button */}
        {onShowEvidence && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowEvidence(commitment.id);
            }}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="Show evidence"
          >
            <Eye className="h-4 w-4 text-purple-500" />
          </button>
        )}

        {/* Complete button for active commitments */}
        {commitment.status !== "completed" && commitment.status !== "cancelled" && onComplete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onComplete(commitment.id);
            }}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="Mark complete"
          >
            <Check className="h-4 w-4 text-green-600" />
          </button>
        )}

        {/* More actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onShowEvidence && (
              <>
                <DropdownMenuItem onClick={() => onShowEvidence(commitment.id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Evidence
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {commitment.sourceThread && (
              <DropdownMenuItem onClick={() => onThreadClick?.(commitment.sourceThread!.id)}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Source Thread
              </DropdownMenuItem>
            )}
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
              <DropdownMenuItem onClick={(e) => {
                e.stopPropagation();
                onGenerateFollowUp(commitment.id);
              }}>
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
  );
}
