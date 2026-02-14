// =============================================================================
// DECISION CARD COMPONENT
// =============================================================================
//
// Intelligence-first decision display with rationale, supersession chain,
// evidence links, and confidence indicators. Decisions aren't static - they
// evolve, and this component shows that history.
//

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@memorystack/ui-core/avatar";
import { Badge } from "@memorystack/ui-core/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@memorystack/ui-core/dropdown-menu";
import { format, isToday, isYesterday } from "date-fns";
import {
  Copy,
  ExternalLink,
  Eye,
  GitBranch,
  MoreHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfidenceBadge, EvidencePopover } from "@/components/evidence";
import {
  type TaskAssignee,
  type TaskPriority,
  TaskPriorityDropdown,
  type TaskStatus,
  TaskStatusDropdown,
} from "@/components/tasks";
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

export interface DecisionCardData {
  id: string;
  title: string;
  statement: string;
  rationale?: string | null;
  decidedAt: Date;
  confidence: number;
  isUserVerified?: boolean;
  isSuperseded?: boolean;
  evidence?: string[];
  extractedAt?: Date | null;
  owners?: Array<{
    id: string;
    displayName?: string | null;
    primaryEmail: string;
  }>;
  sourceThread?: {
    id: string;
    subject?: string | null;
    snippet?: string | null;
  } | null;
  supersededBy?: {
    id: string;
    title: string;
    decidedAt: Date;
  } | null;
  alternatives?: Array<{
    option: string;
    reason?: string;
  }>;
  topics?: Array<{
    id: string;
    name: string;
  }>;
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

interface DecisionCardProps {
  decision: DecisionCardData;
  isSelected?: boolean;
  onSelect?: () => void;
  onDismiss?: (decisionId: string) => void;
  onVerify?: (decisionId: string) => void;
  onThreadClick?: (threadId: string) => void;
  onContactClick?: (email: string) => void;
  onViewSupersession?: (decisionId: string) => void;
  onShowEvidence?: (decisionId: string) => void;
  compact?: boolean;
  /** Organization ID - required if task controls should be editable */
  organizationId?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDecisionDate(date: Date): string {
  if (isToday(date)) {
    return "Today";
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "MMM d");
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

export function DecisionCard({
  decision,
  isSelected = false,
  onSelect,
  onDismiss,
  onVerify,
  onThreadClick,
  onContactClick: _onContactClick,
  onViewSupersession,
  onShowEvidence,
  organizationId,
}: DecisionCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hasTaskData = decision.task && organizationId;

  const quotedText = extractQuotedText(
    decision.evidence?.[0],
    decision.statement
  );
  const evidencePopover = onShowEvidence
    ? {
        id: decision.id,
        type: "decision" as const,
        title: decision.title,
        extractedText: decision.statement,
        quotedText,
        confidence: decision.confidence,
        isUserVerified: decision.isUserVerified,
        sourceMessage: extractSourceMessage(decision.evidence?.[0]),
        threadId: decision.sourceThread?.id ?? undefined,
        extractedAt: decision.extractedAt ?? decision.decidedAt ?? new Date(),
      }
    : null;

  const handleCopyStatement = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success("Decision statement copied");
  };

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors",
        "border-border/40 border-b",
        decision.isSuperseded || decision.supersededBy ? "opacity-60" : "",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Priority indicator bar */}
      {!(decision.isSuperseded || decision.supersededBy) && (
        <div className="absolute top-0 bottom-0 left-0 w-1 bg-purple-500" />
      )}

      {/* Avatar for first owner or decision icon */}
      {decision.owners && decision.owners.length > 0 ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="bg-muted font-medium text-xs">
            {getInitials(
              decision.owners[0]?.displayName,
              decision.owners[0]?.primaryEmail ?? ""
            )}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-500/10">
          <GitBranch className="h-4 w-4 text-purple-500" />
        </div>
      )}

      {/* Date */}
      <span className="w-20 shrink-0 font-medium text-muted-foreground text-xs">
        {formatDecisionDate(decision.decidedAt)}
      </span>

      {/* Title - main content with AI indicator and source */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Source indicator */}
        {decision.sourceType &&
          (() => {
            const config = getSourceConfig(decision.sourceType);
            const color = getSourceColor(decision.sourceType);
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
        {!decision.sourceType && (
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        )}
        <span
          className={cn(
            "truncate text-muted-foreground text-sm",
            decision.supersededBy && "line-through opacity-60"
          )}
        >
          {decision.title}
        </span>
      </div>

      {/* Topics */}
      {decision.topics && decision.topics.length > 0 && !isHovered && (
        <div className="flex shrink-0 items-center gap-1">
          {decision.topics.slice(0, 2).map((topic) => (
            <Badge className="text-[10px]" key={topic.id} variant="secondary">
              {topic.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Quick actions - always visible */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Task controls - shown if task data exists */}
        {hasTaskData && (
          <>
            {decision.task?.assignee && (
              <div
                className="flex items-center gap-1 rounded-full border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                onClick={(e) => e.stopPropagation()}
                title={
                  decision.task.assignee.name ?? decision.task.assignee.email
                }
              >
                <Avatar className="h-4 w-4">
                  {decision.task.assignee.image && (
                    <AvatarImage
                      alt={decision.task.assignee.name ?? "Assignee"}
                      src={decision.task.assignee.image}
                    />
                  )}
                  <AvatarFallback className="bg-secondary text-[8px] text-white">
                    {getInitials(
                      decision.task.assignee.name,
                      decision.task.assignee.email
                    )}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[72px] truncate">
                  {decision.task.assignee.name ?? decision.task.assignee.email}
                </span>
              </div>
            )}
            <div onClick={(e) => e.stopPropagation()}>
              <TaskPriorityDropdown
                align="end"
                compact
                currentPriority={decision.task!.priority}
                organizationId={organizationId!}
                taskId={decision.task!.id}
              />
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <TaskStatusDropdown
                align="end"
                compact
                currentStatus={decision.task!.status}
                organizationId={organizationId!}
                taskId={decision.task!.id}
              />
            </div>
          </>
        )}

        {/* Confidence Badge */}
        <ConfidenceBadge
          confidence={decision.confidence}
          isUserVerified={decision.isUserVerified}
          size="sm"
        />

        {/* Show Me - Evidence button */}
        {onShowEvidence && evidencePopover && (
          <EvidencePopover
            evidence={evidencePopover}
            onShowFullEvidence={() => onShowEvidence(decision.id)}
            side="left"
          >
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onShowEvidence(decision.id);
              }}
              title="Show evidence"
              type="button"
            >
              <Eye className="h-4 w-4 text-purple-500" />
            </button>
          </EvidencePopover>
        )}

        {/* Source thread link */}
        {decision.sourceThread && (
          <button
            className="rounded-md p-1.5 transition-colors hover:bg-background"
            onClick={(e) => {
              e.stopPropagation();
              onThreadClick?.(decision.sourceThread!.id);
            }}
            title="View source thread"
            type="button"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
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
                <DropdownMenuItem onClick={() => onShowEvidence(decision.id)}>
                  <Eye className="mr-2 h-4 w-4" />
                  Show Evidence
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleCopyStatement}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Statement
            </DropdownMenuItem>
            {decision.sourceThread && (
              <DropdownMenuItem
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View Source Thread
              </DropdownMenuItem>
            )}
            {onViewSupersession && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onViewSupersession(decision.id)}
                >
                  <GitBranch className="mr-2 h-4 w-4" />
                  View Decision History
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            {!decision.isUserVerified && onVerify && (
              <DropdownMenuItem onClick={() => onVerify(decision.id)}>
                <ThumbsUp className="mr-2 h-4 w-4" />
                Verify (Correct)
              </DropdownMenuItem>
            )}
            {onDismiss && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDismiss(decision.id)}
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
