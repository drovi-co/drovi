// =============================================================================
// LINKED UIOS SECTION COMPONENT
// =============================================================================
//
// Section that displays all UIOs linked to a conversation, grouped by type.
// Shows:
// - Section header with "Linked Intelligence" title
// - UIOs grouped by type (Commitments, Decisions, Tasks, etc.)
// - Count badge for each group
// - Collapsible groups (optional)

"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  GitBranch,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { useMemo } from "react";

import {
  LinkedUIOCard,
  type LinkedUIOCardData,
  type UIOType,
} from "@/components/smart-inbox/linked-uio-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface LinkedUIOsSectionProps {
  uios: LinkedUIOCardData[];
  className?: string;
}

// =============================================================================
// TYPE CONFIGURATION
// =============================================================================

const TYPE_ORDER: UIOType[] = [
  "commitment",
  "decision",
  "task",
  "risk",
  "topic",
  "claim",
  "project",
  "brief",
];

const TYPE_CONFIG: Record<UIOType, { icon: typeof Target; label: string; pluralLabel: string }> = {
  commitment: { icon: Target, label: "Commitment", pluralLabel: "Commitments" },
  decision: { icon: GitBranch, label: "Decision", pluralLabel: "Decisions" },
  task: { icon: CheckCircle2, label: "Task", pluralLabel: "Tasks" },
  topic: { icon: MessageSquare, label: "Topic", pluralLabel: "Topics" },
  project: { icon: FileText, label: "Project", pluralLabel: "Projects" },
  claim: { icon: Lightbulb, label: "Claim", pluralLabel: "Claims" },
  risk: { icon: AlertTriangle, label: "Risk", pluralLabel: "Risks" },
  brief: { icon: Zap, label: "Brief", pluralLabel: "Briefs" },
};

// =============================================================================
// LINKED UIOS SECTION COMPONENT
// =============================================================================

export function LinkedUIOsSection({ uios, className }: LinkedUIOsSectionProps) {
  // Group UIOs by type
  const groupedUIOs = useMemo(() => {
    const groups: Partial<Record<UIOType, LinkedUIOCardData[]>> = {};

    for (const uio of uios) {
      if (!groups[uio.type]) {
        groups[uio.type] = [];
      }
      groups[uio.type]?.push(uio);
    }

    return groups;
  }, [uios]);

  // Calculate total count
  const totalCount = uios.length;

  if (totalCount === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Section header */}
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
          Linked Intelligence
        </h3>
        <Badge className="h-5 px-1.5 text-[10px]" variant="secondary">
          {totalCount}
        </Badge>
      </div>

      {/* Grouped UIOs */}
      <div className="space-y-4">
        {TYPE_ORDER.map((type) => {
          const typeUIOs = groupedUIOs[type];
          if (!typeUIOs || typeUIOs.length === 0) {
            return null;
          }

          const config = TYPE_CONFIG[type];
          const TypeIcon = config.icon;

          return (
            <div key={type}>
              {/* Type header */}
              <div className="mb-2 flex items-center gap-2">
                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-xs text-muted-foreground">
                  {typeUIOs.length === 1 ? config.label : config.pluralLabel}
                </span>
                <Badge className="h-4 px-1 text-[9px]" variant="outline">
                  {typeUIOs.length}
                </Badge>
              </div>

              {/* UIO cards */}
              <div className="space-y-2">
                {typeUIOs.map((uio) => (
                  <LinkedUIOCard key={uio.id} uio={uio} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
