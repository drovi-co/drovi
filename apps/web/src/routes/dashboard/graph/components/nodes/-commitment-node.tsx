// =============================================================================
// COMMITMENT NODE COMPONENT
// =============================================================================

import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Calendar,
} from "lucide-react";
import { memo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { CommitmentNodeData } from "../../-types";

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// =============================================================================
// COMPONENT
// =============================================================================

function CommitmentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as CommitmentNodeData;
  const isOwedByMe = nodeData.direction === "owed_by_me";

  // Status-based styling
  const statusConfig: Record<string, { bg: string; border: string; text: string }> = {
    pending: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-600" },
    in_progress: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-600" },
    completed: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-600" },
    overdue: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-600" },
    cancelled: { bg: "bg-muted", border: "border-muted-foreground/20", text: "text-muted-foreground" },
  };

  const config = statusConfig[nodeData.status] ?? statusConfig.pending;

  // Priority indicator
  const priorityColors: Record<string, string> = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-blue-500",
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
            `}
          >
            {/* Overdue pulse effect */}
            {nodeData.isOverdue && (
              <div className="absolute -inset-1 animate-pulse rounded-xl bg-red-500/20 blur-sm" />
            )}

            {/* Main card */}
            <div
              className={`
                relative flex min-w-[180px] max-w-[220px] flex-col gap-2 rounded-xl border-2 bg-card p-3 shadow-lg transition-all
                ${config.border}
                ${selected ? "ring-4 ring-violet-500/20 border-violet-500" : ""}
                group-hover:shadow-xl group-hover:border-violet-400
              `}
            >
              {/* Priority stripe */}
              <div
                className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${priorityColors[nodeData.priority] ?? priorityColors.medium}`}
              />

              {/* Input handle */}
              <Handle
                type="target"
                position={Position.Left}
                className="!-left-1.5 !h-3 !w-3 !rounded-full !border-2 !border-violet-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
              />

              {/* Header row */}
              <div className="flex items-start gap-2 pl-2">
                {/* Direction badge */}
                <div
                  className={`
                    flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm
                    ${isOwedByMe ? "bg-gradient-to-br from-blue-500 to-blue-600" : "bg-gradient-to-br from-emerald-500 to-emerald-600"}
                  `}
                >
                  {isOwedByMe ? (
                    <ArrowUpRight className="h-4 w-4 text-white" />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4 text-white" />
                  )}
                </div>

                {/* Title */}
                <p className="flex-1 text-sm font-medium leading-tight text-foreground line-clamp-2">
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
                  {nodeData.status === "completed" && <Check className="mr-1 h-3 w-3" />}
                  {nodeData.isOverdue && <AlertTriangle className="mr-1 h-3 w-3" />}
                  {nodeData.status === "in_progress" && <Clock className="mr-1 h-3 w-3" />}
                  {nodeData.status.replace("_", " ")}
                </Badge>

                {/* Due date */}
                {nodeData.dueDate && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(nodeData.dueDate)}
                  </span>
                )}
              </div>

              {/* Confidence indicator */}
              {nodeData.confidence < 0.7 && (
                <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50 text-[10px] font-bold text-amber-600 shadow-sm">
                  ?
                </div>
              )}

              {/* Output handle */}
              <Handle
                type="source"
                position={Position.Right}
                className="!-right-1.5 !h-3 !w-3 !rounded-full !border-2 !border-violet-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-semibold">{nodeData.label}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className={isOwedByMe ? "border-blue-300" : "border-emerald-300"}>
                {isOwedByMe ? "You owe this" : "Owed to you"}
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
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Confidence:</span>
              <div className="h-1.5 w-16 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${nodeData.confidence * 100}%` }}
                />
              </div>
              <span className="text-muted-foreground">{Math.round(nodeData.confidence * 100)}%</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const CommitmentNode = memo(CommitmentNodeComponent);
