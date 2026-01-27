// =============================================================================
// PATTERN CARD COMPONENT
// =============================================================================
//
// Compact card showing recognition pattern details for Klein's RPD approach.
// Displays pattern name, domain, match count, accuracy, and active toggle.
//

import { motion } from "framer-motion";
import {
  Brain,
  CircleDot,
  Eye,
  MoreHorizontal,
  Target,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface Pattern {
  id: string;
  name: string;
  description: string;
  domain: string;
  salientFeatures: string[];
  typicalExpectations: string[];
  typicalAction: string;
  plausibleGoals: string[];
  confidenceThreshold: number;
  confidenceBoost: number;
  timesMatched: number;
  timesConfirmed: number;
  timesRejected: number;
  accuracyRate: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PatternCardProps {
  pattern: Pattern;
  isSelected?: boolean;
  onSelect?: () => void;
  onToggleActive?: (id: string, active: boolean) => void;
  onViewDetails?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

// =============================================================================
// DOMAIN CONFIG
// =============================================================================

const DOMAIN_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string; icon: React.ElementType }
> = {
  sales: {
    label: "Sales",
    color: "text-green-600",
    bgColor: "bg-green-500/10 border-green-500/30",
    icon: Target,
  },
  engineering: {
    label: "Engineering",
    color: "text-blue-600",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    icon: Zap,
  },
  legal: {
    label: "Legal",
    color: "text-purple-600",
    bgColor: "bg-purple-500/10 border-purple-500/30",
    icon: CircleDot,
  },
  hr: {
    label: "HR",
    color: "text-orange-600",
    bgColor: "bg-orange-500/10 border-orange-500/30",
    icon: Brain,
  },
  general: {
    label: "General",
    color: "text-gray-600",
    bgColor: "bg-gray-500/10 border-gray-500/30",
    icon: Eye,
  },
};

// =============================================================================
// HELPERS
// =============================================================================

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 0.8) {
    return "text-green-600";
  }
  if (accuracy >= 0.6) {
    return "text-amber-600";
  }
  return "text-red-600";
}

function getAccuracyBgColor(accuracy: number): string {
  if (accuracy >= 0.8) {
    return "bg-green-500/10 border-green-500/30";
  }
  if (accuracy >= 0.6) {
    return "bg-amber-500/10 border-amber-500/30";
  }
  return "bg-red-500/10 border-red-500/30";
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function PatternCard({
  pattern,
  isSelected = false,
  onSelect,
  onToggleActive,
  onViewDetails,
  onEdit,
  onDelete,
}: PatternCardProps) {
  const domainConfig = DOMAIN_CONFIG[pattern.domain] ?? DOMAIN_CONFIG.general;
  const DomainIcon = domainConfig.icon;
  const accuracyPercent = Math.round(pattern.accuracyRate * 100);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 transition-all",
        isSelected && "ring-2 ring-primary",
        pattern.isActive ? "opacity-100" : "opacity-60",
        onSelect && "cursor-pointer hover:shadow-md"
      )}
      initial={{ opacity: 0, y: 10 }}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn("rounded-lg p-2", domainConfig.bgColor)}>
            <DomainIcon className={cn("h-5 w-5", domainConfig.color)} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{pattern.name}</h4>
              {!pattern.isActive && (
                <Badge className="text-xs" variant="secondary">
                  Inactive
                </Badge>
              )}
            </div>
            <p className="line-clamp-2 text-muted-foreground text-sm">
              {pattern.description}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Switch
                  checked={pattern.isActive}
                  onCheckedChange={(checked) =>
                    onToggleActive?.(pattern.id, checked)
                  }
                  onClick={(e) => e.stopPropagation()}
                />
              </TooltipTrigger>
              <TooltipContent>
                {pattern.isActive ? "Deactivate pattern" : "Activate pattern"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="h-8 w-8"
                onClick={(e) => e.stopPropagation()}
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewDetails?.(pattern.id)}>
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit?.(pattern.id)}>
                <Brain className="mr-2 h-4 w-4" />
                Edit Pattern
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete?.(pattern.id)}
              >
                <X className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 border-t pt-4">
        {/* Domain */}
        <Badge
          className={cn("text-xs", domainConfig.bgColor)}
          variant="outline"
        >
          {domainConfig.label}
        </Badge>

        {/* Match Count */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-sm">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{pattern.timesMatched}</span>
                <span className="text-muted-foreground">matches</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {pattern.timesConfirmed} confirmed, {pattern.timesRejected}{" "}
                rejected
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Accuracy */}
        <div className="ml-auto flex items-center gap-2">
          <Badge
            className={cn("text-xs", getAccuracyBgColor(pattern.accuracyRate))}
            variant="outline"
          >
            <span className={getAccuracyColor(pattern.accuracyRate)}>
              {accuracyPercent}% accuracy
            </span>
          </Badge>
        </div>
      </div>

      {/* Salient Features Preview */}
      {pattern.salientFeatures.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {pattern.salientFeatures.slice(0, 3).map((feature) => (
            <Badge className="text-xs" key={feature} variant="secondary">
              {feature}
            </Badge>
          ))}
          {pattern.salientFeatures.length > 3 && (
            <Badge className="text-xs" variant="secondary">
              +{pattern.salientFeatures.length - 3} more
            </Badge>
          )}
        </div>
      )}

      {/* Confidence indicator */}
      <div className="absolute right-0 bottom-0 h-1 w-full bg-gradient-to-r from-transparent via-transparent to-primary/20" />
    </motion.div>
  );
}

export default PatternCard;
