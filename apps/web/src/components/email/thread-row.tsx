"use client";

import { format, isToday, isYesterday } from "date-fns";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  Flag,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ThreadRowData {
  id: string;
  subject: string;
  brief: string;
  lastMessageDate: Date;
  messageCount: number;
  isUnread: boolean;
  isStarred: boolean;
  participants: Array<{
    email: string;
    name: string;
    avatarUrl?: string;
  }>;
  priority: "urgent" | "high" | "medium" | "low";
  commitmentCount: number;
  decisionCount: number;
  openQuestionCount: number;
}

interface ThreadRowProps {
  thread: ThreadRowData;
  isSelected?: boolean;
  onClick?: (id: string) => void;
  onStar?: (id: string, starred: boolean) => void;
  onArchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(date: Date): string {
  if (isToday(date)) {
    return format(date, "h:mm a");
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "MMM d");
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// =============================================================================
// THREAD ROW COMPONENT
// =============================================================================

export function ThreadRow({
  thread,
  isSelected = false,
  onClick,
  onStar,
  onArchive,
  onDelete,
}: ThreadRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const primaryParticipant = thread.participants[0];
  const hasIntelligence =
    thread.commitmentCount > 0 ||
    thread.decisionCount > 0 ||
    thread.openQuestionCount > 0;

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors",
        "border-border/40 border-b",
        thread.isUnread && !isSelected && !isHovered && "bg-primary/[0.02]",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={() => onClick?.(thread.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(thread.id);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
    >
      {/* Priority indicator bar */}
      {thread.priority === "urgent" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 rounded-r bg-red-500" />
      )}
      {thread.priority === "high" && (
        <div className="absolute top-0 bottom-0 left-0 w-1 rounded-r bg-amber-500" />
      )}

      {/* Avatar */}
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={primaryParticipant?.avatarUrl} />
        <AvatarFallback className="bg-muted font-medium text-xs">
          {primaryParticipant?.name
            ? getInitials(primaryParticipant.name)
            : "?"}
        </AvatarFallback>
      </Avatar>

      {/* Sender name - more space */}
      <div
        className={cn(
          "w-48 shrink-0 truncate",
          thread.isUnread
            ? "font-semibold text-foreground"
            : "font-medium text-foreground/80"
        )}
      >
        <span className="text-sm">
          {primaryParticipant?.name || primaryParticipant?.email || "Unknown"}
        </span>
        {thread.participants.length > 1 && (
          <span className="ml-1.5 text-muted-foreground text-xs">
            +{thread.participants.length - 1}
          </span>
        )}
      </div>

      {/* AI Brief - the main content */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {/* Priority icon */}
        {thread.priority === "urgent" && (
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
        )}
        {thread.priority === "high" && (
          <Flag className="h-4 w-4 shrink-0 text-amber-500" />
        )}

        {/* AI indicator */}
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-500" />

        {/* Brief text */}
        <span
          className={cn(
            "truncate text-sm",
            thread.isUnread ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {thread.brief || thread.subject}
        </span>
      </div>

      {/* Intelligence badges */}
      {hasIntelligence && !isHovered && (
        <div className="flex shrink-0 items-center gap-1.5">
          {thread.commitmentCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-blue-600 text-xs">
              <CheckCircle2 className="h-3 w-3" />
              {thread.commitmentCount}
            </span>
          )}
          {thread.openQuestionCount > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-600 text-xs">
              <Clock className="h-3 w-3" />
              {thread.openQuestionCount}
            </span>
          )}
        </div>
      )}

      {/* Quick actions (on hover) or date */}
      <div className="flex w-28 shrink-0 items-center justify-end gap-1">
        {isHovered ? (
          <>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onStar?.(thread.id, !thread.isStarred);
              }}
              type="button"
            >
              <Star
                className={cn(
                  "h-4 w-4",
                  thread.isStarred
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground"
                )}
              />
            </button>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onArchive?.(thread.id);
              }}
              type="button"
            >
              <Archive className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              className="rounded-md p-1.5 transition-colors hover:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(thread.id);
              }}
              type="button"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </>
        ) : (
          <>
            {thread.isStarred && (
              <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
            )}
            <span className="whitespace-nowrap font-medium text-muted-foreground text-xs">
              {formatDate(thread.lastMessageDate)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

export function ThreadRowSkeleton() {
  return (
    <div className="flex items-center gap-4 border-border/40 border-b px-4 py-3">
      <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
      <div className="h-4 w-20 animate-pulse rounded bg-muted" />
    </div>
  );
}
