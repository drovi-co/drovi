// =============================================================================
// DECISION CARD COMPONENT
// =============================================================================
//
// Intelligence-first decision display with rationale, supersession chain,
// evidence links, and confidence indicators. Decisions aren't static - they
// evolve, and this component shows that history.
//

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

import { ConfidenceBadge } from "@/components/evidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getSourceConfig, getSourceColor, type SourceType } from "@/lib/source-config";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  TaskStatusDropdown,
  TaskPriorityDropdown,
  TaskAssigneeDropdown,
  type TaskStatus,
  type TaskPriority,
  type TaskAssignee,
} from "@/components/tasks";

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
  onContactClick,
  onViewSupersession,
  onShowEvidence,
  organizationId,
}: DecisionCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hasTaskData = decision.task && organizationId;

  const handleCopyStatement = () => {
    navigator.clipboard.writeText(decision.statement);
    toast.success("Decision statement copied");
  };

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors",
        "border-b border-border/40",
        decision.isSuperseded || decision.supersededBy ? "opacity-60" : "",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onSelect}
    >
      {/* Priority indicator bar */}
      {!decision.isSuperseded && !decision.supersededBy && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500" />
      )}

      {/* Avatar for first owner or decision icon */}
      {decision.owners && decision.owners.length > 0 ? (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs bg-muted font-medium">
            {getInitials(decision.owners[0]?.displayName, decision.owners[0]?.primaryEmail ?? "")}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-full bg-purple-500/10 flex items-center justify-center">
          <GitBranch className="h-4 w-4 text-purple-500" />
        </div>
      )}

      {/* Date */}
      <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">
        {formatDecisionDate(decision.decidedAt)}
      </span>

      {/* Title - main content with AI indicator and source */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* Source indicator */}
        {decision.sourceType && (() => {
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
          <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
        )}
        <span className={cn(
          "text-sm truncate text-muted-foreground",
          decision.supersededBy && "line-through opacity-60"
        )}>
          {decision.title}
        </span>
      </div>

      {/* Topics */}
      {decision.topics && decision.topics.length > 0 && !isHovered && (
        <div className="flex items-center gap-1 shrink-0">
          {decision.topics.slice(0, 2).map((topic) => (
            <Badge key={topic.id} variant="secondary" className="text-[10px]">
              {topic.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Quick actions - always visible */}
      <div className="shrink-0 flex items-center gap-1">
        {/* Task controls - shown if task data exists */}
        {hasTaskData && (
          <>
            <div onClick={(e) => e.stopPropagation()}>
              <TaskAssigneeDropdown
                taskId={decision.task!.id}
                organizationId={organizationId!}
                currentAssignee={decision.task!.assignee}
                compact
                align="end"
              />
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <TaskPriorityDropdown
                taskId={decision.task!.id}
                organizationId={organizationId!}
                currentPriority={decision.task!.priority}
                compact
                align="end"
              />
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <TaskStatusDropdown
                taskId={decision.task!.id}
                organizationId={organizationId!}
                currentStatus={decision.task!.status}
                compact
                align="end"
              />
            </div>
          </>
        )}

        {/* Confidence Badge */}
        <ConfidenceBadge
          confidence={decision.confidence}
          isUserVerified={decision.isUserVerified}
          size="sm"
          showDetails={false}
        />

        {/* Show Me - Evidence button */}
        {onShowEvidence && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowEvidence(decision.id);
            }}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="Show evidence"
          >
            <Eye className="h-4 w-4 text-purple-500" />
          </button>
        )}

        {/* Source thread link */}
        {decision.sourceThread && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onThreadClick?.(decision.sourceThread!.id);
            }}
            className="p-1.5 rounded-md hover:bg-background transition-colors"
            title="View source thread"
          >
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
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
                <DropdownMenuItem onClick={() => onShowEvidence(decision.id)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Show Evidence
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={handleCopyStatement}>
              <Copy className="h-4 w-4 mr-2" />
              Copy Statement
            </DropdownMenuItem>
            {decision.sourceThread && (
              <DropdownMenuItem
                onClick={() => onThreadClick?.(decision.sourceThread!.id)}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Source Thread
              </DropdownMenuItem>
            )}
            {onViewSupersession && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onViewSupersession(decision.id)}>
                  <GitBranch className="h-4 w-4 mr-2" />
                  View Decision History
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            {!decision.isUserVerified && onVerify && (
              <DropdownMenuItem onClick={() => onVerify(decision.id)}>
                <ThumbsUp className="h-4 w-4 mr-2" />
                Verify (Correct)
              </DropdownMenuItem>
            )}
            {onDismiss && (
              <DropdownMenuItem onClick={() => onDismiss(decision.id)} className="text-destructive">
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
