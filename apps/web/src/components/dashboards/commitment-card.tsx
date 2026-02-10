// =============================================================================
// COMMITMENT CARD COMPONENT
// =============================================================================
//
// Intelligence-first commitment display with evidence links, confidence
// indicators, and quick actions. Not just a task card - it's an accountability
// surface showing the full context of the promise.
//

import { format, isPast, isThisWeek, isToday, isTomorrow } from "date-fns";
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

import { ConfidenceBadge, EvidencePopover } from "@/components/evidence";
import {
  type TaskAssignee,
  type TaskPriority,
  TaskPriorityDropdown,
  type TaskStatus,
  TaskStatusDropdown,
} from "@/components/tasks";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { extractQuotedText, extractSourceMessage } from "@/lib/evidence-utils";
import {
  getSourceColor,
  getSourceConfig,
  type SourceType,
} from "@/lib/source-config";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface CommitmentCardData {
  id: string;
  title: string;
  description?: string | null;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "overdue"
    | "waiting"
    | "snoozed";
  priority: "low" | "medium" | "high" | "urgent";
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: Date | null;
  confidence: number;
  isUserVerified?: boolean;
  evidence?: string[];
  extractedAt?: Date | null;
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
  // Multi-source support
  sourceType?: SourceType;
  sourceAccountName?: string | null;
  /** Linked task data - if present, shows task controls */
  task?: {
    id: string;
    status: TaskStatus;
    priority: TaskPriority;
    assignee: TaskAssignee | null;
  };
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
  /** Organization ID - required if task controls should be editable */
  organizationId?: string;
}

// =============================================================================
// URGENCY HELPERS
// =============================================================================

function getUrgencyLevel(
  dueDate: Date | null | undefined,
  status: string
): "overdue" | "urgent" | "soon" | "normal" {
  if (status === "overdue") {
    return "overdue";
  }
  if (!dueDate) {
    return "normal";
  }

  if (isPast(dueDate)) {
    return "overdue";
  }
  if (isToday(dueDate) || isTomorrow(dueDate)) {
    return "urgent";
  }
  if (isThisWeek(dueDate)) {
    return "soon";
  }
  return "normal";
}

function getUrgencyStyles(
  urgency: "overdue" | "urgent" | "soon" | "normal"
): string {
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

function getPriorityBadge(priority: string): {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
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

function getStatusBadge(status: string): {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
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
  organizationId,
}: CommitmentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const urgency = getUrgencyLevel(commitment.dueDate, commitment.status);
  const statusBadge = getStatusBadge(commitment.status);
  const hasTaskData = commitment.task && organizationId;

  const quotedText = extractQuotedText(
    commitment.evidence?.[0],
    commitment.description ?? commitment.title
  );
  const evidencePopover = onShowEvidence
    ? {
        id: commitment.id,
        type: "commitment" as const,
        title: commitment.title,
        extractedText: commitment.description ?? commitment.title,
        quotedText,
        confidence: commitment.confidence,
        isUserVerified: commitment.isUserVerified,
        sourceMessage: extractSourceMessage(commitment.evidence?.[0]),
        threadId: commitment.sourceThread?.id ?? undefined,
        extractedAt: commitment.extractedAt ?? commitment.dueDate ?? new Date(),
      }
    : null;

  // The person responsible or expecting
  const otherPerson =
    commitment.direction === "owed_by_me"
      ? commitment.creditor
      : commitment.debtor;

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors",
        "border-border/40 border-b",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Priority indicator bar */}
      {urgency === "overdue" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-red-500" />
      )}
      {urgency === "urgent" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-orange-500" />
      )}
      {urgency === "soon" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-500" />
      )}

      {/* Avatar */}
      {otherPerson ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-muted font-medium text-xs">
            {getInitials(otherPerson.displayName, otherPerson.primaryEmail)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Check className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Direction badge */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 font-medium text-xs",
          commitment.direction === "owed_by_me"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
        )}
      >
        {commitment.direction === "owed_by_me" ? "I owe" : "Owed to me"}
      </span>

      {/* Other Person */}
      {otherPerson && (
        <button
          className="w-32 shrink-0 truncate text-left font-medium text-foreground/80 text-sm transition-colors hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onContactClick?.(otherPerson.primaryEmail);
          }}
          type="button"
        >
          {otherPerson.displayName ?? otherPerson.primaryEmail}
        </button>
      )}

      {/* Title - main content with AI indicator and source */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Source indicator */}
        {commitment.sourceType &&
          (() => {
            const config = getSourceConfig(commitment.sourceType);
            const color = getSourceColor(commitment.sourceType);
            const SourceIcon = config.icon;
            return (
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                style={{ backgroundColor: `${color}15` }}
                title={`From ${config.label}`}
              >
                <SourceIcon className="h-3 w-3" style={{ color }} />
              </div>
            );
          })()}
        {!commitment.sourceType && (
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        )}
        <span className="truncate text-muted-foreground text-sm">
          {commitment.title}
        </span>
      </div>

      {/* Due Date */}
      {commitment.dueDate && !isHovered && (
        <span
          className={cn(
            "shrink-0 text-xs",
            urgency === "overdue" &&
              "font-medium text-red-600 dark:text-red-400",
            urgency === "urgent" && "text-orange-600 dark:text-orange-400",
            urgency === "soon" && "text-amber-600 dark:text-amber-400",
            urgency === "normal" && "text-muted-foreground"
          )}
        >
          {isPast(commitment.dueDate)
            ? `${commitment.daysOverdue ?? Math.floor((Date.now() - commitment.dueDate.getTime()) / (1000 * 60 * 60 * 24))}d overdue`
            : isToday(commitment.dueDate)
              ? "Today"
              : isTomorrow(commitment.dueDate)
                ? "Tomorrow"
                : format(commitment.dueDate, "MMM d")}
        </span>
      )}

      {/* Quick actions - always visible */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Task controls - shown if task data exists */}
        {hasTaskData && (
          <>
            {commitment.task?.assignee && (
              <div
                className="flex items-center gap-1 rounded-full border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
                title={
                  commitment.task.assignee.name ??
                  commitment.task.assignee.email
                }
              >
                <Avatar className="h-4 w-4">
                  {commitment.task.assignee.image && (
                    <AvatarImage
                      alt={commitment.task.assignee.name ?? "Assignee"}
                      src={commitment.task.assignee.image}
                    />
                  )}
                  <AvatarFallback className="bg-secondary text-[8px] text-white">
                    {getInitials(
                      commitment.task.assignee.name,
                      commitment.task.assignee.email
                    )}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[72px] truncate">
                  {commitment.task.assignee.name ??
                    commitment.task.assignee.email}
                </span>
              </div>
            )}
            <div onClick={(e) => e.stopPropagation()}>
              <TaskPriorityDropdown
                align="end"
                compact
                currentPriority={commitment.task!.priority}
                organizationId={organizationId!}
                taskId={commitment.task!.id}
              />
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <TaskStatusDropdown
                align="end"
                compact
                currentStatus={commitment.task!.status}
                organizationId={organizationId!}
                taskId={commitment.task!.id}
              />
            </div>
          </>
        )}

        {/* Status badge - only show if no task controls */}
        {!hasTaskData && (
          <Badge className="shrink-0 text-[10px]" variant={statusBadge.variant}>
            {statusBadge.label}
          </Badge>
        )}

        {/* Confidence Badge */}
        <ConfidenceBadge
          confidence={commitment.confidence}
          isUserVerified={commitment.isUserVerified}
          size="sm"
        />

        {/* Show Me - Evidence button */}
        {onShowEvidence && evidencePopover && (
          <EvidencePopover
            evidence={evidencePopover}
            onShowFullEvidence={() => onShowEvidence(commitment.id)}
            side="left"
          >
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onShowEvidence(commitment.id);
              }}
              title="Show evidence"
              type="button"
            >
              <Eye className="h-4 w-4 text-purple-500" />
            </button>
          </EvidencePopover>
        )}

        {/* Complete button for active commitments */}
        {commitment.status !== "completed" &&
          commitment.status !== "cancelled" &&
          onComplete && (
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onComplete(commitment.id);
              }}
              title="Mark complete"
              type="button"
            >
              <Check className="h-4 w-4 text-green-600" />
            </button>
          )}

        {/* More actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => e.stopPropagation()}
              type="button"
            >
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onShowEvidence && (
              <>
                <DropdownMenuItem onClick={() => onShowEvidence(commitment.id)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Show Evidence
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {commitment.sourceThread && (
              <DropdownMenuItem
                onClick={() => onThreadClick?.(commitment.sourceThread!.id)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View Source Thread
              </DropdownMenuItem>
            )}
            {commitment.status !== "completed" && (
              <>
                {onComplete && (
                  <DropdownMenuItem onClick={() => onComplete(commitment.id)}>
                    <Check className="mr-2 h-4 w-4" />
                    Mark Complete
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {onSnooze && (
                  <>
                    <DropdownMenuItem
                      onClick={() => onSnooze(commitment.id, 1)}
                    >
                      <Clock className="mr-2 h-4 w-4" />
                      Snooze 1 day
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onSnooze(commitment.id, 3)}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Snooze 3 days
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onSnooze(commitment.id, 7)}
                    >
                      <Pause className="mr-2 h-4 w-4" />
                      Snooze 1 week
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
              </>
            )}
            {commitment.direction === "owed_to_me" &&
              urgency === "overdue" &&
              onGenerateFollowUp && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerateFollowUp(commitment.id);
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" />
                  Generate Follow-up
                </DropdownMenuItem>
              )}
            <DropdownMenuSeparator />
            {!commitment.isUserVerified && onVerify && (
              <DropdownMenuItem onClick={() => onVerify(commitment.id)}>
                <ThumbsUp className="mr-2 h-4 w-4" />
                Verify (Correct)
              </DropdownMenuItem>
            )}
            {onDismiss && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDismiss(commitment.id)}
              >
                <ThumbsDown className="mr-2 h-4 w-4" />
                Dismiss (Incorrect)
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
