// =============================================================================
// COMMITMENT NODE COMPONENT
// =============================================================================

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Check,
  Clock,
} from "lucide-react";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n, useT } from "@/i18n";
import type { CommitmentNodeData } from "../../-types";

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

// =============================================================================
// COMPONENT
// =============================================================================

function CommitmentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as CommitmentNodeData;
  const isOwedByMe = nodeData.direction === "owed_by_me";
  const t = useT();
  const { locale } = useI18n();

  // Status-based styling
  const statusConfig: Record<
    string,
    { bg: string; border: string; text: string }
  > = {
    pending: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      text: "text-amber-600",
    },
    in_progress: {
      bg: "bg-blue-500/10",
      border: "border-blue-500/30",
      text: "text-blue-600",
    },
    completed: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      text: "text-emerald-600",
    },
    overdue: {
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      text: "text-red-600",
    },
    cancelled: {
      bg: "bg-muted",
      border: "border-muted-foreground/20",
      text: "text-muted-foreground",
    },
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
            className={`group relative cursor-pointer transition-all duration-200 ${selected ? "scale-105" : "hover:scale-[1.02]"}
            `}
          >
            {/* Overdue pulse effect */}
            {nodeData.isOverdue && (
              <div className="absolute -inset-1 animate-pulse rounded-xl bg-red-500/20 blur-sm" />
            )}

            {/* Main card */}
            <div
              className={`relative flex min-w-[180px] max-w-[220px] flex-col gap-2 rounded-xl border-2 bg-card p-3 shadow-lg transition-all ${config.border}
                ${selected ? "border-violet-500 ring-4 ring-violet-500/20" : ""}group-hover:shadow-xl group-hover:border-violet-400`}
            >
              {/* Priority stripe */}
              <div
                className={`absolute top-3 bottom-3 left-0 w-1 rounded-r-full ${priorityColors[nodeData.priority] ?? priorityColors.medium}`}
              />

              {/* Input handle */}
              <Handle
                className="!-left-1.5 !h-3 !w-3 !rounded-full !border-2 !border-violet-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Left}
                type="target"
              />

              {/* Header row */}
              <div className="flex items-start gap-2 pl-2">
                {/* Direction badge */}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm ${isOwedByMe ? "bg-gradient-to-br from-blue-500 to-blue-600" : "bg-gradient-to-br from-emerald-500 to-emerald-600"}
                  `}
                >
                  {isOwedByMe ? (
                    <ArrowUpRight className="h-4 w-4 text-white" />
                  ) : (
                    <ArrowDownLeft className="h-4 w-4 text-white" />
                  )}
                </div>

                {/* Title */}
                <p className="line-clamp-2 flex-1 font-medium text-foreground text-sm leading-tight">
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
                  {nodeData.status === "completed" && (
                    <Check className="mr-1 h-3 w-3" />
                  )}
                  {nodeData.isOverdue && (
                    <AlertTriangle className="mr-1 h-3 w-3" />
                  )}
                  {nodeData.status === "in_progress" && (
                    <Clock className="mr-1 h-3 w-3" />
                  )}
                  {nodeData.status.replace("_", " ")}
                </Badge>

                {/* Due date */}
                {nodeData.dueDate && (
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(nodeData.dueDate, locale)}
                  </span>
                )}
              </div>

              {/* Confidence indicator */}
              {nodeData.confidence < 0.7 && (
                <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50 font-bold text-[10px] text-amber-600 shadow-sm">
                  ?
                </div>
              )}

              {/* Output handle */}
              <Handle
                className="!-right-1.5 !h-3 !w-3 !rounded-full !border-2 !border-violet-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
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
              <Badge
                className={
                  isOwedByMe ? "border-blue-300" : "border-emerald-300"
                }
                variant="outline"
              >
                {isOwedByMe
                  ? t("pages.dashboard.graph.nodes.commitment.youOweThis")
                  : t("pages.dashboard.graph.nodes.commitment.owedToYou")}
              </Badge>
              <Badge variant="outline">
                {t("pages.dashboard.graph.nodes.commitment.priority", {
                  priority: nodeData.priority,
                })}
              </Badge>
            </div>
            {nodeData.dueDate && (
              <p className="text-muted-foreground text-xs">
                {t("pages.dashboard.graph.nodes.commitment.due", {
                  date: new Intl.DateTimeFormat(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }).format(new Date(nodeData.dueDate)),
                })}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">
                {t("pages.dashboard.graph.nodes.commitment.confidence")}
              </span>
              <div className="h-1.5 w-16 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${nodeData.confidence * 100}%` }}
                />
              </div>
              <span className="text-muted-foreground">
                {Math.round(nodeData.confidence * 100)}%
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const CommitmentNode = memo(CommitmentNodeComponent);
