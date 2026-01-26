// =============================================================================
// CONVERSATION LIST ITEM COMPONENT
// =============================================================================
//
// Clean conversation item showing subject + brief/snippet.
// Checkbox marks as done (strikethrough, moves to Done folder).

import { format } from "date-fns";
import { Star } from "lucide-react";
import { useCallback } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IssueCheckbox } from "@/components/ui/issue-checkbox";
import { cn } from "@/lib/utils";
import {
  getSourceColor,
  type SourceType,
} from "@/lib/source-config";

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationParticipant {
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface ConversationListItemData {
  id: string;
  sourceType: SourceType;
  sourceAccountName?: string;
  title: string;
  snippet: string;
  brief?: string | null;
  participants: ConversationParticipant[];
  messageCount: number;
  lastMessageAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
  isDone?: boolean;
  priorityTier: string | null;
  hasOpenLoops: boolean | null;
  openLoopCount: number | null;
  hasCommitments: boolean;
  hasDecisions: boolean;
}

export interface ConversationListItemProps {
  conversation: ConversationListItemData;
  selected: boolean;
  onClick: () => void;
  onToggleDone?: (conversationId: string) => void;
  onToggleStar?: (conversationId: string) => void;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatRelativeDate(date: Date | null): string {
  if (!date) return "";
  return format(new Date(date), "MMM d");
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
  if (email) {
    return email.slice(0, 2).toUpperCase();
  }
  return "?";
}

function getParticipantName(p: ConversationParticipant): string {
  return p.name ?? p.email?.split("@")[0] ?? "Unknown";
}

function truncateName(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  return `${name.slice(0, maxLength - 1)}…`;
}

// =============================================================================
// SOURCE BADGE COMPONENT
// =============================================================================

function SourceBadge({ sourceType, name }: { sourceType: SourceType; name?: string }) {
  const color = getSourceColor(sourceType);
  const displayName = name ?? sourceType.charAt(0).toUpperCase() + sourceType.slice(1);

  return (
    <div
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color}15`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {displayName}
    </div>
  );
}

// =============================================================================
// CONVERSATION LIST ITEM COMPONENT
// =============================================================================

export function ConversationListItem({
  conversation,
  selected,
  onClick,
  onToggleDone,
  onToggleStar,
  className,
}: ConversationListItemProps) {
  const isDone = conversation.isDone ?? false;
  const firstParticipant = conversation.participants[0];
  const displayText = conversation.brief ?? conversation.snippet;

  // Truncate participant name to reasonable length
  const participantDisplayName = firstParticipant
    ? truncateName(getParticipantName(firstParticipant), 20)
    : null;

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleDone?.(conversation.id);
  }, [conversation.id, onToggleDone]);

  const handleStarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleStar?.(conversation.id);
  }, [conversation.id, onToggleStar]);

  return (
    <div
      className={cn(
        "group relative cursor-pointer",
        "border-b border-border/40",
        "transition-colors duration-75",
        selected && "bg-muted/60 border-l-2 border-l-primary",
        !selected && "hover:bg-muted/30",
        isDone && "opacity-60",
        className
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "px-3 py-3",
          selected && "pl-[calc(0.75rem-2px)]"
        )}
      >
        {/* Row 1: Checkbox + Subject + Date */}
        <div className="mb-1 flex items-center gap-2">
          {/* Checkbox - inline with subject */}
          <div
            className="shrink-0"
            onClick={handleCheckboxClick}
          >
            <IssueCheckbox
              checked={isDone}
              size="sm"
            />
          </div>

          {/* Subject/Title - truncated */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-tight",
              isDone && "line-through text-muted-foreground",
              !isDone && !conversation.isRead && "font-semibold text-foreground",
              !isDone && conversation.isRead && "font-medium text-foreground"
            )}
            title={conversation.title || "No subject"}
          >
            {conversation.title || "No subject"}
          </span>

          {/* Date */}
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeDate(conversation.lastMessageAt)}
          </span>
        </div>

        {/* Row 2: Brief/Snippet */}
        <p
          className={cn(
            "mb-2 line-clamp-2 text-[12px] leading-relaxed",
            isDone ? "text-muted-foreground/60" : "text-muted-foreground"
          )}
        >
          {displayText || "No preview available"}
        </p>

        {/* Row 3: Source + Person + Indicators */}
        <div className="flex items-center gap-2">
          <SourceBadge
            sourceType={conversation.sourceType}
            name={conversation.sourceAccountName?.split("@")[0]}
          />

          {firstParticipant && (
            <div className="flex min-w-0 items-center gap-1.5">
              <Avatar className="h-4 w-4 shrink-0">
                {firstParticipant.avatarUrl && (
                  <AvatarImage
                    alt={participantDisplayName ?? ""}
                    src={firstParticipant.avatarUrl}
                  />
                )}
                <AvatarFallback className="bg-emerald-500 text-white text-[8px] font-medium">
                  {getInitials(firstParticipant.name, firstParticipant.email)}
                </AvatarFallback>
              </Avatar>
              <span
                className="truncate text-[11px] text-muted-foreground"
                title={getParticipantName(firstParticipant)}
              >
                {participantDisplayName}
              </span>
            </div>
          )}

          <div className="flex-1" />

          {/* Unread indicator */}
          {!conversation.isRead && !isDone && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          )}

          {/* Star */}
          <button
            className={cn(
              "shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
              conversation.isStarred && "opacity-100 text-yellow-500",
              !conversation.isStarred && "text-muted-foreground hover:text-foreground"
            )}
            onClick={handleStarClick}
            type="button"
          >
            <Star className={cn("h-3.5 w-3.5", conversation.isStarred && "fill-current")} />
          </button>
        </div>
      </div>
    </div>
  );
}
