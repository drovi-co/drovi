// =============================================================================
// DECISION NODE COMPONENT
// =============================================================================

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { Calendar, Check, RotateCcw, Sparkles } from "lucide-react";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DecisionNodeData } from "../../-types";

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// =============================================================================
// COMPONENT
// =============================================================================

function DecisionNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as DecisionNodeData;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={`group relative cursor-pointer transition-all duration-200 ${selected ? "scale-105" : "hover:scale-[1.02]"}
              ${nodeData.isSuperseded ? "opacity-60" : ""}
            `}
          >
            {/* Active decision glow */}
            {!nodeData.isSuperseded && (
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-purple-500/20 to-fuchsia-500/20 opacity-0 blur-sm transition-opacity group-hover:opacity-100" />
            )}

            {/* Main card - hexagonal feel with rounded corners */}
            <div
              className={`relative flex min-w-[180px] max-w-[220px] flex-col gap-2 rounded-2xl border-2 bg-card p-3 shadow-lg transition-all ${
                nodeData.isSuperseded
                  ? "border-muted-foreground/20 bg-muted/50"
                  : "border-purple-400/50 bg-gradient-to-br from-purple-500/5 to-fuchsia-500/5"
              }
                ${selected ? "border-purple-500 ring-4 ring-purple-500/20" : ""}group-hover:shadow-xl group-hover:border-purple-400`}
            >
              {/* Decorative corner accents */}
              <div className="absolute -top-px -left-px h-4 w-4 rounded-tl-2xl border-purple-500/50 border-t-2 border-l-2" />
              <div className="absolute -top-px -right-px h-4 w-4 rounded-tr-2xl border-purple-500/50 border-t-2 border-r-2" />

              {/* Input handle */}
              <Handle
                className="!-left-1.5 !h-3 !w-3 !rounded-full !border-2 !border-purple-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Left}
                type="target"
              />

              {/* Header row */}
              <div className="flex items-start gap-2">
                {/* Decision icon */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${
                    nodeData.isSuperseded
                      ? "bg-muted"
                      : "bg-gradient-to-br from-purple-500 to-fuchsia-500"
                  }
                  `}
                >
                  <Sparkles
                    className={`h-4 w-4 ${nodeData.isSuperseded ? "text-muted-foreground" : "text-white"}`}
                  />
                </div>

                {/* Title & status */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium text-foreground text-sm leading-tight">
                    {nodeData.label}
                  </p>
                </div>
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-2">
                {/* Status badge */}
                <Badge
                  className={`border-0 font-medium text-[10px] ${
                    nodeData.isSuperseded
                      ? "bg-muted text-muted-foreground"
                      : "bg-purple-500/10 text-purple-600"
                  }
                  `}
                  variant="secondary"
                >
                  {nodeData.isSuperseded ? (
                    <>
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Superseded
                    </>
                  ) : (
                    <>
                      <Check className="mr-1 h-3 w-3" />
                      Active
                    </>
                  )}
                </Badge>

                {/* Decision date */}
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {formatDate(nodeData.decidedAt)}
                </span>
              </div>

              {/* Confidence indicator */}
              {nodeData.confidence < 0.7 && (
                <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-50 font-bold text-[10px] text-amber-600 shadow-sm">
                  ?
                </div>
              )}

              {/* Output handle */}
              <Handle
                className="!-right-1.5 !h-3 !w-3 !rounded-full !border-2 !border-purple-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Right}
                type="source"
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="top">
          <div className="space-y-2">
            <p className="font-semibold">{nodeData.label}</p>
            {nodeData.rationale && (
              <p className="line-clamp-3 text-muted-foreground text-xs">
                {nodeData.rationale}
              </p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Decided:</span>
              <span>{formatDate(nodeData.decidedAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Confidence:</span>
              <div className="h-1.5 w-16 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-purple-500"
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

export const DecisionNode = memo(DecisionNodeComponent);
