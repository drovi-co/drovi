// =============================================================================
// LINKED UIO CARD COMPONENT
// =============================================================================
//
// Beautiful clickable card for UIOs linked to a conversation.
// Shows:
// - Type icon with accent color
// - Title
// - Due date (with overdue styling)
// - Status badge
// - Source breadcrumbs (cross-source indicator)
//
// Clicking navigates to the UIO detail page.

"use client";

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow, isPast } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronRight,
  FileText,
  GitBranch,
  Lightbulb,
  MessageSquare,
  Target,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export type UIOType =
  | "commitment"
  | "decision"
  | "topic"
  | "project"
  | "claim"
  | "task"
  | "risk"
  | "brief";

export interface SourceBreadcrumb {
  sourceType: string;
  count: number;
  sourceName: string;
}

export interface LinkedUIOCardData {
  id: string;
  type: UIOType;
  title: string;
  dueDate?: Date | null;
  status: string;
  sourceBreadcrumbs?: SourceBreadcrumb[];
}

export interface LinkedUIOCardProps {
  uio: LinkedUIOCardData;
  className?: string;
}

// =============================================================================
// TYPE CONFIGURATION
// =============================================================================

const TYPE_CONFIG: Record<
  UIOType,
  {
    icon: typeof Target;
    label: string;
    color: string;
    bgColor: string;
    route: string;
  }
> = {
  commitment: {
    icon: Target,
    label: "Commitment",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10 hover:bg-blue-500/20",
    route: "/dashboard/commitments",
  },
  decision: {
    icon: GitBranch,
    label: "Decision",
    color: "text-purple-500",
    bgColor: "bg-purple-500/10 hover:bg-purple-500/20",
    route: "/dashboard/decisions",
  },
  task: {
    icon: CheckCircle2,
    label: "Task",
    color: "text-green-500",
    bgColor: "bg-green-500/10 hover:bg-green-500/20",
    route: "/dashboard/tasks",
  },
  topic: {
    icon: MessageSquare,
    label: "Topic",
    color: "text-cyan-500",
    bgColor: "bg-cyan-500/10 hover:bg-cyan-500/20",
    route: "/dashboard/uio",
  },
  project: {
    icon: FileText,
    label: "Project",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10 hover:bg-orange-500/20",
    route: "/dashboard/uio",
  },
  claim: {
    icon: Lightbulb,
    label: "Claim",
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10 hover:bg-yellow-500/20",
    route: "/dashboard/uio",
  },
  risk: {
    icon: AlertTriangle,
    label: "Risk",
    color: "text-red-500",
    bgColor: "bg-red-500/10 hover:bg-red-500/20",
    route: "/dashboard/uio",
  },
  brief: {
    icon: Zap,
    label: "Brief",
    color: "text-indigo-500",
    bgColor: "bg-indigo-500/10 hover:bg-indigo-500/20",
    route: "/dashboard/uio",
  },
};

// =============================================================================
// STATUS CONFIGURATION
// =============================================================================

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "success" | "warning" | "destructive";
  }
> = {
  pending: { label: "Pending", variant: "secondary" },
  not_started: { label: "Not Started", variant: "secondary" },
  in_progress: { label: "In Progress", variant: "default" },
  in_review: { label: "In Review", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  done: { label: "Done", variant: "success" },
  active: { label: "Active", variant: "default" },
  resolved: { label: "Resolved", variant: "success" },
  dismissed: { label: "Dismissed", variant: "secondary" },
  archived: { label: "Archived", variant: "secondary" },
  overdue: { label: "Overdue", variant: "destructive" },
};

// =============================================================================
// HELPERS
// =============================================================================

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status.toLowerCase()] ?? {
      label: status,
      variant: "secondary" as const,
    }
  );
}

function formatDueDate(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  const d = new Date(date);
  return formatDistanceToNow(d, { addSuffix: true });
}

// =============================================================================
// LINKED UIO CARD COMPONENT
// =============================================================================

export function LinkedUIOCard({ uio, className }: LinkedUIOCardProps) {
  const config = TYPE_CONFIG[uio.type];
  const TypeIcon = config.icon;
  const statusConfig = getStatusConfig(uio.status);
  const dueDateStr = formatDueDate(uio.dueDate);
  const isOverdue = uio.dueDate && isPast(new Date(uio.dueDate));

  // Determine the route based on type
  const href = `${config.route}/${uio.id}`;

  return (
    <Link
      className={cn(
        "group flex items-start gap-3 rounded-lg border p-3",
        "transition-all duration-150",
        config.bgColor,
        "border-transparent",
        className
      )}
      to={href}
    >
      {/* Type icon */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          "bg-background/50"
        )}
      >
        <TypeIcon className={cn("h-4 w-4", config.color)} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Type label + Status */}
        <div className="mb-1 flex items-center gap-2">
          <span
            className={cn("font-medium text-[10px] uppercase", config.color)}
          >
            {config.label}
          </span>
          <Badge
            className="h-4 px-1.5 text-[9px]"
            variant={statusConfig.variant}
          >
            {statusConfig.label}
          </Badge>
        </div>

        {/* Title */}
        <h4 className="line-clamp-2 font-medium text-sm leading-snug">
          {uio.title || "Untitled"}
        </h4>

        {/* Due date */}
        {dueDateStr && (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-1 text-[11px]",
              isOverdue ? "text-red-500" : "text-muted-foreground"
            )}
          >
            <Calendar className="h-3 w-3" />
            <span>
              {isOverdue ? "Overdue: " : "Due "}
              {dueDateStr}
            </span>
          </div>
        )}

        {/* Source breadcrumbs */}
        {uio.sourceBreadcrumbs && uio.sourceBreadcrumbs.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {uio.sourceBreadcrumbs.map((crumb) => (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                key={crumb.sourceType}
              >
                {crumb.sourceName}: {crumb.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chevron */}
      <ChevronRight
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground",
          "opacity-0 transition-opacity group-hover:opacity-100"
        )}
      />
    </Link>
  );
}
