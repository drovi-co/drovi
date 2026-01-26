// =============================================================================
// UIO LIST ITEM COMPONENT
// =============================================================================
//
// Displays a single UIO (Unified Intelligence Object) in the list panel.
// Matches the Agency design reference with:
// - ID code + date + priority indicator
// - Title
// - Company/Contact badges with avatars/logos
// - Selection highlight with accent background

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  GitBranch,
  Lightbulb,
  MessageSquare,
  Target,
  Zap,
} from "lucide-react";

import { EntityBadge } from "@/components/inbox/entity-badge";
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

export type UIOStatus = "active" | "merged" | "archived" | "dismissed";

export interface UIOListItemData {
  id: string;
  type: UIOType;
  status: UIOStatus;
  canonicalTitle: string | null;
  userCorrectedTitle?: string | null;
  canonicalDescription?: string | null;
  dueDate?: Date | null;
  overallConfidence?: number | null;
  isUserVerified?: boolean;
  createdAt: Date;
  lastUpdatedAt?: Date | null;
  owner?: {
    id: string;
    primaryEmail: string;
    displayName?: string | null;
    avatarUrl?: string | null;
  } | null;
  // Commitment-specific
  commitmentDetails?: {
    status?: string;
    priority?: string;
    direction?: string;
  } | null;
  // Task-specific
  taskDetails?: {
    status?: string;
    priority?: string;
  } | null;
  // Risk-specific
  riskDetails?: {
    severity?: string;
  } | null;
  // Brief-specific
  briefDetails?: {
    priorityTier?: string;
  } | null;
}

export interface UIOListItemProps {
  uio: UIOListItemData;
  selected: boolean;
  onClick: () => void;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const TYPE_CONFIG: Record<
  UIOType,
  { icon: typeof Target; label: string; color: string }
> = {
  commitment: {
    icon: Target,
    label: "Commitment",
    color: "text-blue-500",
  },
  decision: {
    icon: GitBranch,
    label: "Decision",
    color: "text-purple-500",
  },
  task: {
    icon: CheckCircle2,
    label: "Task",
    color: "text-green-500",
  },
  topic: {
    icon: MessageSquare,
    label: "Topic",
    color: "text-cyan-500",
  },
  project: {
    icon: FileText,
    label: "Project",
    color: "text-orange-500",
  },
  claim: {
    icon: Lightbulb,
    label: "Claim",
    color: "text-yellow-500",
  },
  risk: {
    icon: AlertTriangle,
    label: "Risk",
    color: "text-red-500",
  },
  brief: {
    icon: Zap,
    label: "Brief",
    color: "text-indigo-500",
  },
};

function getShortId(id: string): string {
  // Take first 8 chars of UUID and format as UIO-XXXX
  return `UIO-${id.slice(0, 4).toUpperCase()}`;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) {
    return "";
  }
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

function getPriorityBadge(
  uio: UIOListItemData
): { variant: "destructive" | "warning" | "default"; label: string } | null {
  // Check commitment priority
  if (uio.commitmentDetails?.priority) {
    const priority = uio.commitmentDetails.priority;
    if (priority === "urgent") {
      return { variant: "destructive", label: "Urgent" };
    }
    if (priority === "high") {
      return { variant: "warning", label: "High" };
    }
  }

  // Check task priority
  if (uio.taskDetails?.priority) {
    const priority = uio.taskDetails.priority;
    if (priority === "urgent") {
      return { variant: "destructive", label: "Urgent" };
    }
    if (priority === "high") {
      return { variant: "warning", label: "High" };
    }
  }

  // Check risk severity
  if (uio.riskDetails?.severity) {
    const severity = uio.riskDetails.severity;
    if (severity === "critical") {
      return { variant: "destructive", label: "Critical" };
    }
    if (severity === "high") {
      return { variant: "warning", label: "High Risk" };
    }
  }

  // Check brief priority tier
  if (uio.briefDetails?.priorityTier) {
    const tier = uio.briefDetails.priorityTier;
    if (tier === "urgent") {
      return { variant: "destructive", label: "Urgent" };
    }
    if (tier === "high") {
      return { variant: "warning", label: "High" };
    }
  }

  // Check if overdue
  if (uio.dueDate && new Date(uio.dueDate) < new Date()) {
    return { variant: "destructive", label: "Overdue" };
  }

  return null;
}

function getStatusIndicator(uio: UIOListItemData): {
  icon: typeof Circle;
  color: string;
  label: string;
} {
  // Check commitment status
  if (uio.commitmentDetails?.status) {
    const status = uio.commitmentDetails.status;
    if (status === "completed") {
      return {
        icon: CheckCircle2,
        color: "text-green-500",
        label: "Completed",
      };
    }
    if (status === "in_progress") {
      return {
        icon: CircleDot,
        color: "text-blue-500",
        label: "In Progress",
      };
    }
  }

  // Check task status
  if (uio.taskDetails?.status) {
    const status = uio.taskDetails.status;
    if (status === "done") {
      return {
        icon: CheckCircle2,
        color: "text-green-500",
        label: "Done",
      };
    }
    if (status === "in_progress") {
      return {
        icon: CircleDot,
        color: "text-blue-500",
        label: "In Progress",
      };
    }
    if (status === "in_review") {
      return {
        icon: CircleDot,
        color: "text-purple-500",
        label: "In Review",
      };
    }
  }

  // Default based on UIO status
  if (uio.status === "archived") {
    return {
      icon: CheckCircle2,
      color: "text-muted-foreground",
      label: "Archived",
    };
  }

  return { icon: Circle, color: "text-muted-foreground", label: "Active" };
}

// =============================================================================
// UIO LIST ITEM COMPONENT
// =============================================================================

export function UIOListItem({
  uio,
  selected,
  onClick,
  className,
}: UIOListItemProps) {
  const typeConfig = TYPE_CONFIG[uio.type];
  const TypeIcon = typeConfig.icon;
  const title = uio.userCorrectedTitle ?? uio.canonicalTitle ?? "Untitled";
  const priority = getPriorityBadge(uio);
  const statusIndicator = getStatusIndicator(uio);
  const StatusIcon = statusIndicator.icon;

  return (
    <button
      className={cn(
        "group relative w-full cursor-pointer border-border/50 border-b p-3 text-left",
        "transition-colors duration-150 hover:bg-muted/50",
        selected && "bg-accent/50",
        className
      )}
      onClick={onClick}
      type="button"
    >
      {/* Header: Type icon, ID, Date, Priority */}
      <div className="mb-1.5 flex items-center gap-2">
        {/* Type icon */}
        <TypeIcon className={cn("h-3.5 w-3.5", typeConfig.color)} />

        {/* Short ID */}
        <span className="font-mono text-[10px] text-muted-foreground">
          {getShortId(uio.id)}
        </span>

        {/* Separator */}
        <span className="text-muted-foreground/50">·</span>

        {/* Date */}
        {uio.dueDate ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            Due {formatDate(uio.dueDate)}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {formatDate(uio.createdAt)}
          </span>
        )}

        {/* Priority badge */}
        {priority && (
          <Badge
            className="ml-auto h-4 px-1.5 text-[9px]"
            variant={priority.variant}
          >
            {priority.label}
          </Badge>
        )}

        {/* Status indicator */}
        <StatusIcon
          className={cn(
            "h-3.5 w-3.5",
            statusIndicator.color,
            !priority && "ml-auto"
          )}
        />
      </div>

      {/* Title */}
      <h3 className="mb-2 line-clamp-2 font-medium text-sm leading-snug">
        {title}
      </h3>

      {/* Entity badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Owner badge */}
        {uio.owner && (
          <EntityBadge
            avatarUrl={uio.owner.avatarUrl}
            id={uio.owner.id}
            name={
              uio.owner.displayName ??
              uio.owner.primaryEmail.split("@")[0] ??
              ""
            }
            size="sm"
            type="contact"
          />
        )}

        {/* Verified indicator */}
        {uio.isUserVerified && (
          <Badge className="h-4 px-1.5 text-[9px]" variant="success">
            Verified
          </Badge>
        )}

        {/* Confidence indicator (if not verified and has confidence) */}
        {!uio.isUserVerified &&
          uio.overallConfidence !== null &&
          uio.overallConfidence !== undefined && (
            <span
              className={cn(
                "text-[10px]",
                uio.overallConfidence >= 0.8
                  ? "text-green-500"
                  : uio.overallConfidence >= 0.5
                    ? "text-yellow-500"
                    : "text-muted-foreground"
              )}
            >
              {Math.round(uio.overallConfidence * 100)}% confident
            </span>
          )}
      </div>
    </button>
  );
}
