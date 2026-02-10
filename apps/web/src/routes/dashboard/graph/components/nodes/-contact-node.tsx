// =============================================================================
// CONTACT NODE COMPONENT
// =============================================================================

import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, Building2, Star } from "lucide-react";
import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import type { ContactNodeData } from "../../-types";

// =============================================================================
// COMPONENT
// =============================================================================

function ContactNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as ContactNodeData;
  const t = useT();
  const initials = nodeData.label
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Calculate health color
  const healthScore = nodeData.healthScore ?? 0.5;
  const healthColor =
    healthScore > 0.7
      ? "ring-emerald-400"
      : healthScore > 0.4
        ? "ring-amber-400"
        : "ring-red-400";

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={`group relative cursor-pointer transition-all duration-200 ${selected ? "scale-110" : "hover:scale-105"}
            `}
          >
            {/* Outer glow ring for importance */}
            {nodeData.importanceScore && nodeData.importanceScore > 0.7 && (
              <div className="absolute -inset-1 rounded-full bg-blue-400/20 blur-sm" />
            )}

            {/* Main container */}
            <div
              className={`relative rounded-full border-2 bg-card p-1.5 shadow-lg transition-all ${selected ? "border-blue-500 ring-4 ring-blue-500/20" : "border-border"}
                ${nodeData.isAtRisk ? "border-red-400 ring-2 ring-red-400/30" : ""}group-hover:border-blue-400 group-hover:shadow-xl`}
            >
              {/* Input handle */}
              <Handle
                className="!-left-1 !h-3 !w-3 !rounded-full !border-2 !border-blue-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Left}
                type="target"
              />

              {/* Avatar with health ring */}
              <div
                className={`rounded-full ring-2 ${healthColor} ring-offset-1 ring-offset-card`}
              >
                <Avatar className="h-12 w-12">
                  <AvatarImage src={nodeData.avatarUrl} />
                  <AvatarFallback className="bg-gradient-to-br from-blue-500 to-blue-600 font-semibold text-sm text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>

              {/* VIP badge */}
              {nodeData.isVip && (
                <div className="absolute -top-0.5 -right-0.5 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 p-1 shadow-md">
                  <Star className="h-3 w-3 fill-white text-white" />
                </div>
              )}

              {/* At risk indicator */}
              {nodeData.isAtRisk && (
                <div className="absolute -right-0.5 -bottom-0.5 animate-pulse rounded-full bg-gradient-to-br from-red-500 to-red-600 p-1 shadow-md">
                  <AlertTriangle className="h-3 w-3 text-white" />
                </div>
              )}

              {/* Output handle */}
              <Handle
                className="!-right-1 !h-3 !w-3 !rounded-full !border-2 !border-blue-500 !bg-card opacity-0 transition-opacity group-hover:opacity-100"
                position={Position.Right}
                type="source"
              />
            </div>

            {/* Label card below */}
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2">
              <div className="rounded-md bg-card/95 px-2 py-0.5 shadow-sm backdrop-blur-sm">
                <p className="whitespace-nowrap font-medium text-foreground text-xs">
                  {nodeData.label}
                </p>
              </div>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs" side="top">
          <div className="space-y-1">
            <p className="font-semibold">{nodeData.label}</p>
            <p className="text-muted-foreground text-xs">{nodeData.email}</p>
            {nodeData.company && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <Building2 className="h-3 w-3" />
                <span>{nodeData.company}</span>
                {nodeData.title && <span>· {nodeData.title}</span>}
              </div>
            )}
            {nodeData.importanceScore !== undefined && (
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  {t("pages.dashboard.graph.nodes.contact.importance")}
                </span>
                <div className="h-1.5 w-16 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${nodeData.importanceScore * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const ContactNode = memo(ContactNodeComponent);
