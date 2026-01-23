// =============================================================================
// TASK NODE COMPONENT
// =============================================================================

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import {
  Check,
  Circle,
  Clock,
  ListTodo,
  Calendar,
  Mail,
  MessageSquare,
  FileText,
} from "lucide-react";
import { memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { TaskNodeData } from "../../-types";

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  // Status configuration
  const statusConfig: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
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
            className={`
              group relative cursor-pointer transition-all duration-200
              ${selected ? "scale-105" : "hover:scale-[1.02]"}
              ${isDone ? "opacity-70" : ""}
            `}
          >
            {/* Main card */}
            <div
              className={`
                relative flex min-w-[160px] max-w-[200px] flex-col gap-2 rounded-lg border-2 bg-card p-2.5 shadow-md transition-all
                ${isDone ? "border-emerald-400/30" : "border-emerald-500/30"}
                ${selected ? "ring-4 ring-emerald-500/20 border-emerald-500" : ""}
                group-hover:shadow-lg group-hover:border-emerald-400
              `}
            >
              {/* Priority stripe */}
              <div
                className={`absolute left-0 top-2 bottom-2 w-1 rounded-r-full ${priorityColors[nodeData.priority] ?? priorityColors.medium}`}
              />

              {/* Input handle */}
              <Handle
                type="target"
                position={Position.Left}
                className="!-left-1.5 !h-3 !w-3 !rounded-full !border-2 !border-emerald-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
              />

              {/* Header row */}
              <div className="flex items-start gap-2 pl-2">
                {/* Checkbox-style status indicator */}
                <div
                  className={`
                    flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors
                    ${isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-muted-foreground/30 bg-background"}
                  `}
                >
                  {isDone && <Check className="h-3 w-3" />}
                </div>

                {/* Title */}
                <p
                  className={`
                    flex-1 text-xs font-medium leading-tight line-clamp-2
                    ${isDone ? "text-muted-foreground line-through" : "text-foreground"}
                  `}
                >
                  {nodeData.label}
                </p>
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-2 pl-2">
                {/* Status badge */}
                <Badge
                  variant="secondary"
                  className={`${config.bg} ${config.text} border-0 text-[10px] font-medium`}
                >
                  {config.icon}
                  <span className="ml-1">{nodeData.status.replace("_", " ")}</span>
                </Badge>

                {/* Due date or source */}
                {nodeData.dueDate ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(nodeData.dueDate)}
                  </span>
                ) : nodeData.sourceType ? (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {getSourceIcon(nodeData.sourceType)}
                  </span>
                ) : null}
              </div>

              {/* Output handle */}
              <Handle
                type="source"
                position={Position.Right}
                className="!-right-1.5 !h-3 !w-3 !rounded-full !border-2 !border-emerald-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-semibold">{nodeData.label}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className={config.text}>
                {nodeData.status.replace("_", " ")}
              </Badge>
              <Badge variant="outline">
                {nodeData.priority} priority
              </Badge>
            </div>
            {nodeData.dueDate && (
              <p className="text-xs text-muted-foreground">
                Due: {new Date(nodeData.dueDate).toLocaleDateString()}
              </p>
            )}
            {nodeData.sourceType && (
              <p className="text-xs text-muted-foreground">
                Source: {nodeData.sourceType}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const TaskNode = memo(TaskNodeComponent);
