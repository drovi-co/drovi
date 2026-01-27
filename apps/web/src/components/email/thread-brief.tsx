"use client";

import { formatDistanceToNow } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  Bell,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  HelpCircle,
  MailOpen,
  MessageSquare,
  MoreHorizontal,
  Reply,
  ShieldAlert,
  Sparkles,
  Star,
  Tag,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface ThreadBriefData {
  id: string;
  subject: string;
  brief: string;
  lastMessageDate: Date;
  messageCount: number;
  isUnread: boolean;
  isStarred: boolean;
  isSnoozed?: boolean;
  snoozeUntil?: Date;

  // Participants
  participants: Array<{
    email: string;
    name: string;
    avatarUrl?: string;
    isVip?: boolean;
  }>;

  // Intelligence
  priority: "urgent" | "high" | "medium" | "low";
  suggestedAction?: {
    type: "respond" | "archive" | "delegate" | "follow_up" | "review";
    reason: string;
    confidence: number;
  };

  // Extracted intelligence counts
  commitmentCount: number;
  decisionCount: number;
  openQuestionCount: number;
  hasRiskWarning?: boolean;
  riskLevel?: "low" | "medium" | "high" | "critical";

  // Labels
  labels?: Array<{
    id: string;
    name: string;
    color: string;
  }>;

  // AI confidence
  briefConfidence: number;
}

interface ThreadBriefProps {
  thread: ThreadBriefData;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
  onClick?: (id: string) => void;
  onAction?: (id: string, action: ThreadAction) => void;
  className?: string;
}

type ThreadAction =
  | "archive"
  | "star"
  | "unstar"
  | "snooze"
  | "mark_read"
  | "mark_unread"
  | "delete"
  | "respond"
  | "delegate";

// =============================================================================
// THREAD BRIEF COMPONENT
// =============================================================================

export function ThreadBrief({
  thread,
  isSelected = false,
  onSelect,
  onClick,
  onAction,
  className,
}: ThreadBriefProps) {
  const [isHovered, setIsHovered] = useState(false);

  const priorityConfig = {
    urgent: {
      color: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      icon: AlertCircle,
      label: "Urgent",
    },
    high: {
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      icon: Flag,
      label: "High",
    },
    medium: {
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      border: "border-blue-500/30",
      icon: null,
      label: "Medium",
    },
    low: {
      color: "text-muted-foreground",
      bg: "bg-muted/50",
      border: "border-transparent",
      icon: null,
      label: "Low",
    },
  };

  const actionConfig = {
    respond: {
      icon: Reply,
      label: "Respond",
      color: "text-blue-500",
    },
    archive: {
      icon: Archive,
      label: "Archive",
      color: "text-muted-foreground",
    },
    delegate: {
      icon: UserCheck,
      label: "Delegate",
      color: "text-purple-500",
    },
    follow_up: {
      icon: Clock,
      label: "Follow up",
      color: "text-amber-500",
    },
    review: {
      icon: Eye,
      label: "Review",
      color: "text-green-500",
    },
  };

  const priority = priorityConfig[thread.priority];
  const suggestedAction = thread.suggestedAction
    ? actionConfig[thread.suggestedAction.type]
    : null;

  const primaryParticipant = thread.participants[0];
  const otherParticipantsCount = thread.participants.length - 1;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "group relative overflow-hidden rounded-lg border transition-all duration-200",
        "hover:border-foreground/20 hover:shadow-md",
        thread.isUnread && "border-accent bg-accent/30",
        isSelected && "border-primary ring-2 ring-primary",
        thread.priority === "urgent" && "border-red-500/30",
        className
      )}
      exit={{ opacity: 0, y: -10 }}
      initial={{ opacity: 0, y: 10 }}
      layout
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Urgency indicator bar */}
      {(thread.priority === "urgent" || thread.priority === "high") && (
        <div
          className={cn(
            "absolute top-0 bottom-0 left-0 w-1 rounded-l-lg",
            thread.priority === "urgent" ? "bg-red-500" : "bg-amber-500"
          )}
        />
      )}

      <div
        className="flex cursor-pointer items-start gap-3 p-3 pl-4"
        onClick={() => onClick?.(thread.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onClick?.(thread.id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {/* Selection checkbox */}
        <div className="pt-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            className="opacity-0 transition-opacity group-hover:opacity-100 data-[state=checked]:opacity-100"
            onCheckedChange={(checked) =>
              onSelect?.(thread.id, checked as boolean)
            }
          />
        </div>

        {/* Avatar */}
        <div className="relative shrink-0">
          <Avatar className="h-10 w-10">
            <AvatarImage src={primaryParticipant?.avatarUrl} />
            <AvatarFallback className="text-xs">
              {primaryParticipant?.name
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          {primaryParticipant?.isVip && (
            <div className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500">
              <Star className="h-2.5 w-2.5 fill-white text-white" />
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-1">
          {/* Header row */}
          <div className="flex items-center gap-2">
            {/* Sender name */}
            <span
              className={cn(
                "truncate text-sm",
                thread.isUnread ? "font-semibold" : "font-medium"
              )}
            >
              {primaryParticipant?.name}
            </span>

            {otherParticipantsCount > 0 && (
              <span className="text-muted-foreground text-xs">
                +{otherParticipantsCount}
              </span>
            )}

            {/* Priority badge */}
            {priority.icon && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <priority.icon className={cn("h-4 w-4", priority.color)} />
                  </TooltipTrigger>
                  <TooltipContent>{priority.label} priority</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Risk warning */}
            {thread.hasRiskWarning && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <ShieldAlert
                      className={cn(
                        "h-4 w-4",
                        thread.riskLevel === "critical"
                          ? "text-red-500"
                          : thread.riskLevel === "high"
                            ? "text-orange-500"
                            : "text-amber-500"
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    Risk detected ({thread.riskLevel})
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Timestamp */}
            <span className="ml-auto whitespace-nowrap text-muted-foreground text-xs">
              {formatDistanceToNow(thread.lastMessageDate, { addSuffix: true })}
            </span>
          </div>

          {/* Subject */}
          <p
            className={cn(
              "truncate text-sm",
              thread.isUnread ? "font-medium" : "text-foreground/90"
            )}
          >
            {thread.subject}
          </p>

          {/* AI Brief - THE STAR OF THE SHOW */}
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-500" />
            <p className="line-clamp-2 text-muted-foreground text-sm leading-relaxed">
              {thread.brief}
            </p>
          </div>

          {/* Intelligence indicators */}
          <div className="flex items-center gap-3 pt-1">
            {/* Commitments */}
            {thread.commitmentCount > 0 && (
              <IntelligenceBadge
                color="blue"
                count={thread.commitmentCount}
                icon={<CheckCircle2 className="h-3 w-3" />}
                label="commitments"
              />
            )}

            {/* Decisions */}
            {thread.decisionCount > 0 && (
              <IntelligenceBadge
                color="purple"
                count={thread.decisionCount}
                icon={<BookOpen className="h-3 w-3" />}
                label="decisions"
              />
            )}

            {/* Open questions */}
            {thread.openQuestionCount > 0 && (
              <IntelligenceBadge
                color="amber"
                count={thread.openQuestionCount}
                icon={<HelpCircle className="h-3 w-3" />}
                label="open questions"
              />
            )}

            {/* Message count */}
            {thread.messageCount > 1 && (
              <span className="flex items-center gap-1 text-muted-foreground text-xs">
                <MessageSquare className="h-3 w-3" />
                {thread.messageCount}
              </span>
            )}

            {/* Labels */}
            {thread.labels?.map((label) => (
              <Badge
                className="px-1.5 py-0 text-[10px]"
                key={label.id}
                style={{
                  borderColor: label.color,
                  color: label.color,
                }}
                variant="outline"
              >
                {label.name}
              </Badge>
            ))}

            {/* Snoozed */}
            {thread.isSnoozed && thread.snoozeUntil && (
              <span className="flex items-center gap-1 text-amber-500 text-xs">
                <Bell className="h-3 w-3" />
                {formatDistanceToNow(thread.snoozeUntil)}
              </span>
            )}
          </div>
        </div>

        {/* Suggested action */}
        <AnimatePresence>
          {suggestedAction && isHovered && (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="shrink-0"
              exit={{ opacity: 0, x: 10 }}
              initial={{ opacity: 0, x: 10 }}
            >
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className={cn(
                        "gap-1.5 font-medium",
                        suggestedAction.color
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAction?.(
                          thread.id,
                          thread.suggestedAction?.type as ThreadAction
                        );
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <suggestedAction.icon className="h-3.5 w-3.5" />
                      {suggestedAction.label}
                      <ChevronRight className="h-3 w-3 opacity-50" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">{thread.suggestedAction?.reason}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {Math.round(thread.suggestedAction!.confidence * 100)}%
                      confident
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick actions */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100",
            isHovered ? "opacity-100" : ""
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-8 w-8"
                  onClick={() =>
                    onAction?.(thread.id, thread.isStarred ? "unstar" : "star")
                  }
                  size="icon"
                  variant="ghost"
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      thread.isStarred && "fill-amber-400 text-amber-400"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {thread.isStarred ? "Remove star" : "Add star"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="h-8 w-8"
                  onClick={() => onAction?.(thread.id, "archive")}
                  size="icon"
                  variant="ghost"
                >
                  <Archive className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-8 w-8" size="icon" variant="ghost">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  onAction?.(
                    thread.id,
                    thread.isUnread ? "mark_read" : "mark_unread"
                  )
                }
              >
                <MailOpen className="mr-2 h-4 w-4" />
                Mark as {thread.isUnread ? "read" : "unread"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAction?.(thread.id, "snooze")}>
                <Clock className="mr-2 h-4 w-4" />
                Snooze
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Tag className="mr-2 h-4 w-4" />
                Add label
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-500 focus:text-red-500"
                onClick={() => onAction?.(thread.id, "delete")}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </motion.div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function IntelligenceBadge({
  icon,
  count,
  label,
  color,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  color: "blue" | "purple" | "amber" | "green" | "red";
}) {
  const colors = {
    blue: "text-blue-500 bg-blue-500/10",
    purple: "text-purple-500 bg-purple-500/10",
    amber: "text-amber-500 bg-amber-500/10",
    green: "text-green-500 bg-green-500/10",
    red: "text-red-500 bg-red-500/10",
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-xs",
              colors[color]
            )}
          >
            {icon}
            {count}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {count} {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

export function ThreadBriefSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-8 w-full animate-pulse rounded bg-muted" />
          <div className="flex items-center gap-2">
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}
