"use client";

import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  Mail,
  MoreHorizontal,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

interface Notification {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  priority: string | null;
  entityId: string | null;
  entityType: string | null;
  actionRequired: boolean | null;
  actionType: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date | string;
}

interface NotificationCardProps {
  notification: Notification;
  onClick: () => void;
  onDelete: () => void;
}

// =============================================================================
// CATEGORY CONFIG
// =============================================================================

const categoryConfig: Record<
  string,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  commitment: {
    icon: CheckCircle2,
    color: "text-blue-500 bg-blue-50 dark:bg-blue-950/50",
    label: "Commitment",
  },
  decision: {
    icon: BookOpen,
    color: "text-purple-500 bg-purple-50 dark:bg-purple-950/50",
    label: "Decision",
  },
  calendar: {
    icon: Calendar,
    color: "text-orange-500 bg-orange-50 dark:bg-orange-950/50",
    label: "Calendar",
  },
  email: {
    icon: Mail,
    color: "text-green-500 bg-green-50 dark:bg-green-950/50",
    label: "Email",
  },
  system: {
    icon: Settings,
    color: "text-gray-500 bg-gray-50 dark:bg-gray-950/50",
    label: "System",
  },
};

const typeIcons: Record<string, typeof CheckCircle> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
  system: Settings,
};

// =============================================================================
// HELPERS
// =============================================================================

function formatTimeAgo(date: Date | string): string {
  const now = new Date();
  const d = new Date(date);
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return d.toLocaleDateString();
}

function getPriorityBorder(priority: string | null): string {
  switch (priority) {
    case "urgent":
      return "border-l-red-500";
    case "high":
      return "border-l-amber-500";
    default:
      return "border-l-transparent";
  }
}

// =============================================================================
// NOTIFICATION CARD COMPONENT
// =============================================================================

export function NotificationCard({
  notification,
  onClick,
  onDelete,
}: NotificationCardProps) {
  const config = categoryConfig[notification.category] ?? categoryConfig.system;
  const Icon = config.icon;
  const TypeIcon = typeIcons[notification.type] ?? Info;
  const confidence = notification.metadata?.confidence as number | undefined;

  const content = (
    <div
      className={cn(
        "group relative flex gap-3 border-l-2 px-4 py-3 transition-colors",
        getPriorityBorder(notification.priority),
        !notification.read && "bg-muted/50",
        "hover:bg-muted/30"
      )}
    >
      {/* Category Icon */}
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          config.color
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  "truncate text-sm",
                  !notification.read && "font-medium"
                )}
              >
                {notification.title}
              </p>
              {!notification.read && (
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
              {notification.message}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {formatTimeAgo(notification.createdAt)}
            </span>
            {confidence !== undefined && <ConfidenceBadge value={confidence} />}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {notification.link && (
              <Button
                asChild
                className="h-6 w-6"
                onClick={(e) => e.stopPropagation()}
                size="icon"
                variant="ghost"
              >
                <Link to={notification.link}>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="h-6 w-6"
                  onClick={(e) => e.stopPropagation()}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Action Required Badge */}
        {notification.actionRequired && (
          <div className="mt-2">
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 font-medium text-amber-700 text-xs ring-1 ring-amber-600/20 ring-inset dark:bg-amber-950/50 dark:text-amber-400">
              Action required
            </span>
          </div>
        )}
      </div>
    </div>
  );

  if (notification.link) {
    return (
      <Link className="block" onClick={onClick} to={notification.link}>
        {content}
      </Link>
    );
  }

  return (
    <button className="w-full text-left" onClick={onClick} type="button">
      {content}
    </button>
  );
}

// =============================================================================
// CONFIDENCE BADGE
// =============================================================================

function ConfidenceBadge({ value }: { value: number }) {
  const percentage = Math.round(value * 100);
  let color = "text-green-600 bg-green-50 dark:bg-green-950/50";

  if (percentage < 70) {
    color = "text-amber-600 bg-amber-50 dark:bg-amber-950/50";
  }
  if (percentage < 50) {
    color = "text-red-600 bg-red-50 dark:bg-red-950/50";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-medium text-xs",
        color
      )}
      title="AI confidence score"
    >
      {percentage}%
    </span>
  );
}

export default NotificationCard;
