// =============================================================================
// CONVERSATION HEADER COMPONENT
// =============================================================================
//
// Header for the conversation detail panel showing:
// - Source icon + account name
// - Subject/title
// - Participant avatars with names
// - Actions: Star, Archive, Mark Read, Close

"use client";

import { Archive, MailCheck, MailOpen, Star, X } from "lucide-react";

import { AvatarStack } from "@/components/ui/avatar-stack";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getSourceColor,
  getSourceIcon,
  getSourceLabel,
  type SourceType,
} from "@/lib/source-config";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ConversationHeaderParticipant {
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface ConversationHeaderProps {
  sourceType: SourceType;
  sourceAccountName?: string;
  title: string;
  participants: ConversationHeaderParticipant[];
  isStarred: boolean;
  isRead: boolean;
  isArchived: boolean;
  onStar: () => void;
  onArchive: () => void;
  onMarkRead: () => void;
  onClose: () => void;
  className?: string;
}

// =============================================================================
// CONVERSATION HEADER COMPONENT
// =============================================================================

export function ConversationHeader({
  sourceType,
  sourceAccountName,
  title,
  participants,
  isStarred,
  isRead,
  isArchived,
  onStar,
  onArchive,
  onMarkRead,
  onClose,
  className,
}: ConversationHeaderProps) {
  const SourceIcon = getSourceIcon(sourceType);
  const sourceColor = getSourceColor(sourceType);
  const sourceLabel = getSourceLabel(sourceType);

  // Format participant names for display
  const participantNames = participants
    .slice(0, 3)
    .map((p) => p.name ?? p.email?.split("@")[0] ?? "Unknown")
    .join(", ");
  const overflowCount = participants.length > 3 ? participants.length - 3 : 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b bg-card px-4 py-3",
        className
      )}
    >
      {/* Top row: Source + Actions */}
      <div className="flex items-center justify-between">
        {/* Source badge */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded"
            style={{ backgroundColor: `${sourceColor}20` }}
          >
            <SourceIcon
              className="h-3.5 w-3.5"
              style={{ color: sourceColor }}
            />
          </div>
          <span className="text-muted-foreground text-xs">
            {sourceAccountName ?? sourceLabel}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-7 w-7"
                onClick={onStar}
                size="icon"
                variant="ghost"
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    isStarred && "fill-yellow-500 text-yellow-500"
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isStarred ? "Remove star" : "Add star"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-7 w-7"
                onClick={onMarkRead}
                size="icon"
                variant="ghost"
              >
                {isRead ? (
                  <MailOpen className="h-4 w-4" />
                ) : (
                  <MailCheck className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isRead ? "Mark as unread" : "Mark as read"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className={cn("h-7 w-7", isArchived && "text-muted-foreground")}
                onClick={onArchive}
                size="icon"
                variant="ghost"
              >
                <Archive className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {isArchived ? "Unarchive" : "Archive"}
            </TooltipContent>
          </Tooltip>

          <div className="mx-1 h-4 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="h-7 w-7"
                onClick={onClose}
                size="icon"
                variant="ghost"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Title */}
      <h1 className="font-semibold text-lg leading-tight">
        {title || "No subject"}
      </h1>

      {/* Participants */}
      <div className="flex items-center gap-2">
        <AvatarStack maxVisible={4} participants={participants} size="sm" />
        <span className="text-muted-foreground text-xs">
          {participantNames}
          {overflowCount > 0 && ` and ${overflowCount} more`}
        </span>
      </div>
    </div>
  );
}
