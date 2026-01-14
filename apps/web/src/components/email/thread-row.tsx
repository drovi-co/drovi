"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
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
import { format, isToday, isYesterday } from "date-fns";
import { useState } from "react";

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
  const hasIntelligence = thread.commitmentCount > 0 || thread.decisionCount > 0 || thread.openQuestionCount > 0;

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors",
        "border-b border-border/40",
        thread.isUnread && !isSelected && !isHovered && "bg-primary/[0.02]",
        isHovered && !isSelected && "bg-accent/50",
        isSelected && "bg-accent"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onClick?.(thread.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick?.(thread.id);
      }}
      role="button"
      tabIndex={0}
    >
      {/* Priority indicator bar */}
      {thread.priority === "urgent" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-r" />
      )}
      {thread.priority === "high" && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500 rounded-r" />
      )}

      {/* Avatar */}
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={primaryParticipant?.avatarUrl} />
        <AvatarFallback className="text-xs bg-muted font-medium">
          {primaryParticipant?.name ? getInitials(primaryParticipant.name) : "?"}
        </AvatarFallback>
      </Avatar>

      {/* Sender name - more space */}
      <div className={cn(
        "w-48 shrink-0 truncate",
        thread.isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/80"
      )}>
        <span className="text-sm">
          {primaryParticipant?.name || primaryParticipant?.email || "Unknown"}
        </span>
        {thread.participants.length > 1 && (
          <span className="text-xs text-muted-foreground ml-1.5">
            +{thread.participants.length - 1}
          </span>
        )}
      </div>

      {/* AI Brief - the main content */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {/* Priority icon */}
        {thread.priority === "urgent" && (
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
        )}
        {thread.priority === "high" && (
          <Flag className="h-4 w-4 text-amber-500 shrink-0" />
        )}

        {/* AI indicator */}
        <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />

        {/* Brief text */}
        <span className={cn(
          "truncate text-sm",
          thread.isUnread ? "text-foreground" : "text-muted-foreground"
        )}>
          {thread.brief || thread.subject}
        </span>
      </div>

      {/* Intelligence badges */}
      {hasIntelligence && !isHovered && (
        <div className="flex items-center gap-1.5 shrink-0">
          {thread.commitmentCount > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-blue-600 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 className="h-3 w-3" />
              {thread.commitmentCount}
            </span>
          )}
          {thread.openQuestionCount > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
              <Clock className="h-3 w-3" />
              {thread.openQuestionCount}
            </span>
          )}
        </div>
      )}

      {/* Quick actions (on hover) or date */}
      <div className="w-28 shrink-0 flex items-center justify-end gap-1">
        {isHovered ? (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStar?.(thread.id, !thread.isStarred);
              }}
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <Star className={cn(
                "h-4 w-4",
                thread.isStarred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
              )} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive?.(thread.id);
              }}
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <Archive className="h-4 w-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(thread.id);
              }}
              className="p-1.5 rounded-md hover:bg-background transition-colors"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </>
        ) : (
          <>
            {thread.isStarred && (
              <Star className="h-4 w-4 fill-amber-400 text-amber-400 shrink-0" />
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">
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
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border/40">
      <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
      <div className="w-48 h-4 bg-muted rounded animate-pulse" />
      <div className="flex-1 h-4 bg-muted rounded animate-pulse" />
      <div className="w-20 h-4 bg-muted rounded animate-pulse" />
    </div>
  );
}
