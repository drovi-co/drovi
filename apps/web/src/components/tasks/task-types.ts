// =============================================================================
// TASK TYPES & CONSTANTS
// =============================================================================
//
// Shared types and configuration for task components across the application.
//

import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleDot,
  CirclePause,
  XCircle,
} from "lucide-react";
import type { TFunction } from "@/i18n";

// =============================================================================
// TYPES
// =============================================================================

export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

export type TaskPriority = "no_priority" | "low" | "medium" | "high" | "urgent";

export type TaskSourceType =
  | "conversation"
  | "commitment"
  | "decision"
  | "manual";

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface TaskAssignee {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface TaskMetadata {
  sourceUrl?: string;
  sourceTitle?: string;
  sourceAccountType?: string;
  sourceAccountId?: string;
  sourceSnippet?: string;
}

export interface TaskData {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  sourceType: TaskSourceType;
  dueDate: Date | null;
  completedAt: Date | null;
  assignee: TaskAssignee | null;
  labels: TaskLabel[];
  metadata: TaskMetadata | null;
  createdAt: Date;
  updatedAt: Date;
  evidenceCount?: number;
  lastVerifiedAt?: Date | null;
  confidence?: number;
  isUserVerified?: boolean;
  supersessionState?: "active" | "final" | "superseding" | "superseded";
}

export interface TaskActivity {
  id: string;
  taskId: string;
  userId: string;
  userName: string | null;
  userImage: string | null;
  activityType: string;
  previousValue: string | null;
  newValue: string | null;
  comment: string | null;
  createdAt: Date;
}

// =============================================================================
// STATUS CONFIGURATION
// =============================================================================

export const STATUS_CONFIG: Record<
  TaskStatus,
  {
    label: string;
    icon: typeof Circle;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  backlog: {
    label: "components.tasks.status.backlog",
    icon: CircleDashed,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    borderColor: "border-muted-foreground/30",
  },
  todo: {
    label: "components.tasks.status.todo",
    icon: Circle,
    color: "text-ring",
    bgColor: "bg-ring/10",
    borderColor: "border-ring/35",
  },
  in_progress: {
    label: "components.tasks.status.inProgress",
    icon: CircleDot,
    color: "text-warning",
    bgColor: "bg-warning/10",
    borderColor: "border-warning/35",
  },
  in_review: {
    label: "components.tasks.status.inReview",
    icon: CirclePause,
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/35",
  },
  done: {
    label: "components.tasks.status.done",
    icon: CheckCircle2,
    color: "text-success",
    bgColor: "bg-success/10",
    borderColor: "border-success/35",
  },
  cancelled: {
    label: "components.tasks.status.cancelled",
    icon: XCircle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/35",
  },
};

export const STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

// =============================================================================
// PRIORITY CONFIGURATION
// =============================================================================

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  {
    label: string;
    color: string;
    bgColor: string;
    dotColor: string;
  }
> = {
  urgent: {
    label: "components.tasks.priority.urgent",
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    dotColor: "bg-destructive",
  },
  high: {
    label: "components.tasks.priority.high",
    color: "text-warning",
    bgColor: "bg-warning/10",
    dotColor: "bg-warning",
  },
  medium: {
    label: "components.tasks.priority.medium",
    color: "text-ring",
    bgColor: "bg-ring/10",
    dotColor: "bg-ring",
  },
  low: {
    label: "components.tasks.priority.low",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    dotColor: "bg-muted-foreground",
  },
  no_priority: {
    label: "components.tasks.priority.none",
    color: "text-muted-foreground/50",
    bgColor: "bg-muted/50",
    dotColor: "bg-muted-foreground/30",
  },
};

export const PRIORITY_ORDER: TaskPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "no_priority",
];

// =============================================================================
// SOURCE TYPE CONFIGURATION
// =============================================================================

export const SOURCE_TYPE_CONFIG: Record<
  TaskSourceType,
  {
    label: string;
    color: string;
    bgColor: string;
  }
> = {
  conversation: {
    label: "components.tasks.sourceType.conversation",
    color: "text-ring",
    bgColor: "bg-ring/10",
  },
  commitment: {
    label: "components.tasks.sourceType.commitment",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  decision: {
    label: "components.tasks.sourceType.decision",
    color: "text-success",
    bgColor: "bg-success/10",
  },
  manual: {
    label: "components.tasks.sourceType.manual",
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function formatDueDate(
  date: Date | null,
  options: { locale: string; t: TFunction }
): {
  text: string;
  className: string;
  isOverdue: boolean;
} | null {
  if (!date) {
    return null;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(date);
  dueDate.setHours(0, 0, 0, 0);

  const diffMs = dueDate.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      text: options.t("components.tasks.due.overdueShort", {
        days: Math.abs(diffDays),
      }),
      className: "text-destructive font-medium",
      isOverdue: true,
    };
  }
  if (diffDays === 0) {
    return {
      text: options.t("components.tasks.due.today"),
      className: "text-warning font-medium",
      isOverdue: false,
    };
  }
  if (diffDays === 1) {
    return {
      text: options.t("components.tasks.due.tomorrow"),
      className: "text-warning",
      isOverdue: false,
    };
  }
  if (diffDays < 7) {
    return {
      text: options.t("components.tasks.due.inDaysShort", { days: diffDays }),
      className: "text-muted-foreground",
      isOverdue: false,
    };
  }

  let formattedDate: string;
  try {
    formattedDate = new Intl.DateTimeFormat(options.locale, {
      month: "short",
      day: "numeric",
    }).format(dueDate);
  } catch {
    formattedDate = dueDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return {
    text: formattedDate,
    className: "text-muted-foreground",
    isOverdue: false,
  };
}

export function getActivityDescription(
  activityType: string,
  previousValue: string | null,
  newValue: string | null
): string {
  switch (activityType) {
    case "created":
      return "created this task";
    case "status_changed":
      return `changed status from ${STATUS_CONFIG[previousValue as TaskStatus]?.label ?? previousValue} to ${STATUS_CONFIG[newValue as TaskStatus]?.label ?? newValue}`;
    case "priority_changed":
      return `changed priority from ${PRIORITY_CONFIG[previousValue as TaskPriority]?.label ?? previousValue} to ${PRIORITY_CONFIG[newValue as TaskPriority]?.label ?? newValue}`;
    case "assigned":
      return newValue ? `assigned to ${newValue}` : "unassigned";
    case "unassigned":
      return "removed assignee";
    case "description_updated":
      return "updated the description";
    case "title_updated":
      return "updated the title";
    case "due_date_set":
      return `set due date to ${newValue}`;
    case "due_date_removed":
      return "removed due date";
    case "label_added":
      return `added label "${newValue}"`;
    case "label_removed":
      return `removed label "${previousValue}"`;
    case "comment_added":
      return "added a comment";
    default:
      return activityType.replace(/_/g, " ");
  }
}
