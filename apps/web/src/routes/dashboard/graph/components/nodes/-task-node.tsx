// =============================================================================
// TASK NODE COMPONENT
// =============================================================================

import { Badge } from "@memorystack/ui-core/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@memorystack/ui-core/tooltip";
import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import {
  Calendar,
  Check,
  Circle,
  Clock,
  FileText,
  ListTodo,
  Mail,
  MessageSquare,
} from "lucide-react";
import { memo } from "react";
import { useI18n, useT } from "@/i18n";
import type { TaskNodeData } from "../../-types";

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) {
    return "";
  }
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getSourceIcon(sourceType?: string) {
  switch (sourceType) {
    case "email":
      return <Mail className="h-3 w-3" />;
    case "slack":
      return <MessageSquare className="h-3 w-3" />;
    case "notion":
      return <FileText className="h-3 w-3" />;
    default:
      return null;
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

function TaskNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as TaskNodeData;
  const t = useT();
  const { locale } = useI18n();

  // Status configuration
  const statusConfig: Record<
    string,
    { bg: string; text: string; icon: React.ReactNode }
  > = {
    backlog: {
      bg: "bg-slate-500/10",
      text: "text-slate-600",
      icon: <Circle className="h-3 w-3" />,
    },
    todo: {
      bg: "bg-amber-500/10",
      text: "text-amber-600",
      icon: <ListTodo className="h-3 w-3" />,
    },
    in_progress: {
      bg: "bg-blue-500/10",
      text: "text-blue-600",
      icon: <Clock className="h-3 w-3 animate-pulse" />,
    },
    done: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-600",
      icon: <Check className="h-3 w-3" />,
    },
    blocked: {
      bg: "bg-red-500/10",
      text: "text-red-600",
      icon: <Circle className="h-3 w-3" />,
    },
  };

  const config = statusConfig[nodeData.status] ?? statusConfig.backlog;
  const isDone = nodeData.status === "done";

  // Priority colors for the left stripe
  const priorityColors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-emerald-500",
    low: "bg-slate-400",
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={`group relative cursor-pointer transition-all duration-200 ${selected ? "scale-105" : "hover:scale-[1.02]"}
              ${isDone ? "opacity-70" : ""}
            `}
          >
            {/* Main card */}
            <div
              className={`relative flex min-w-[160px] max-w-[200px] flex-col gap-2 rounded-lg border-2 bg-card p-2.5 shadow-md transition-all ${isDone ? "border-emerald-400/30" : "border-emerald-500/30"}
                ${selected ? "border-emerald-500 ring-4 ring-emerald-500/20" : ""}group-hover:shadow-lg group-hover:border-emerald-400`}
            >
              {/* Priority stripe */}
              <div
                className={`absolute top-2 bottom-2 left-0 w-1 rounded-r-full ${priorityColors[nodeData.priority] ?? priorityColors.medium}`}
              />

              {/* Input handle */}
              <Handle
                className="!-left-1.5 !h-3 !w-3 !rounded-full !border-2 !border-emerald-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Left}
                type="target"
              />

              {/* Header row */}
              <div className="flex items-start gap-2 pl-2">
                {/* Checkbox-style status indicator */}
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                    isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-muted-foreground/30 bg-background"
                  }
                  `}
                >
                  {isDone && <Check className="h-3 w-3" />}
                </div>

                {/* Title */}
                <p
                  className={`line-clamp-2 flex-1 font-medium text-xs leading-tight ${isDone ? "text-muted-foreground line-through" : "text-foreground"}
                  `}
                >
                  {nodeData.label}
                </p>
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-2 pl-2">
                {/* Status badge */}
                <Badge
                  className={`${config.bg} ${config.text} border-0 font-medium text-[10px]`}
                  variant="secondary"
                >
                  {config.icon}
                  <span className="ml-1">
                    {nodeData.status.replace("_", " ")}
                  </span>
                </Badge>

                {/* Due date or source */}
                {nodeData.dueDate ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(nodeData.dueDate, locale)}
                  </span>
                ) : nodeData.sourceType ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {getSourceIcon(nodeData.sourceType)}
                  </span>
                ) : null}
              </div>

              {/* Output handle */}
              <Handle
                className="!-right-1.5 !h-3 !w-3 !rounded-full !border-2 !border-emerald-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Right}
                type="source"
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="top">
          <div className="space-y-2">
            <p className="font-semibold">{nodeData.label}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className={config.text} variant="outline">
                {nodeData.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline">
                {t("pages.dashboard.graph.nodes.task.priority", {
                  priority: nodeData.priority,
                })}
              </Badge>
            </div>
            {nodeData.dueDate && (
              <p className="text-muted-foreground text-xs">
                {t("pages.dashboard.graph.nodes.task.due", {
                  date: new Intl.DateTimeFormat(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }).format(new Date(nodeData.dueDate)),
                })}
              </p>
            )}
            {nodeData.sourceType && (
              <p className="text-muted-foreground text-xs">
                {t("pages.dashboard.graph.nodes.task.source", {
                  source: nodeData.sourceType,
                })}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const TaskNode = memo(TaskNodeComponent);
