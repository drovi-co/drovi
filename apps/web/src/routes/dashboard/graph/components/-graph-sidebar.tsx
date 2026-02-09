// =============================================================================
// GRAPH SIDEBAR COMPONENT
// =============================================================================
//
// Shows details about the selected node.
//

import { AlertTriangle, Calendar, Check, Clock, Star, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useI18n, useT } from "@/i18n";
import type { GraphNodeData } from "../-types";

// =============================================================================
// PROPS
// =============================================================================

interface GraphSidebarProps {
  node: GraphNodeData;
  onClose: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function GraphSidebar({ node, onClose }: GraphSidebarProps) {
  const t = useT();
  return (
    <div className="w-80 border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-semibold text-sm">{t("pages.dashboard.graph.sidebar.title")}</h2>
        <Button onClick={onClose} size="icon" variant="ghost">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="h-[calc(100%-57px)]">
        <div className="p-4">
          {/* Render based on node type */}
          {node.nodeType === "contact" && <ContactDetails node={node} />}
          {node.nodeType === "commitment" && <CommitmentDetails node={node} />}
          {node.nodeType === "decision" && <DecisionDetails node={node} />}
          {node.nodeType === "task" && <TaskDetails node={node} />}
        </div>
      </ScrollArea>
    </div>
  );
}

// =============================================================================
// CONTACT DETAILS
// =============================================================================

function ContactDetails({
  node,
}: {
  node: GraphNodeData & { nodeType: "contact" };
}) {
  const t = useT();
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Avatar className="h-12 w-12">
          <AvatarImage src={node.avatarUrl} />
          <AvatarFallback>
            {node.label
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{node.label}</h3>
            {node.isVip && (
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            )}
          </div>
          <p className="text-muted-foreground text-sm">{node.email}</p>
        </div>
      </div>

      {/* Company/Title */}
      {(node.company || node.title) && (
        <div className="text-sm">
          {node.title && <p className="font-medium">{node.title}</p>}
          {node.company && (
            <p className="text-muted-foreground">{node.company}</p>
          )}
        </div>
      )}

      <Separator />

      {/* Health score */}
      {node.healthScore !== undefined && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("pages.dashboard.graph.sidebar.contact.relationshipHealth")}</span>
            <span className="font-medium">
              {Math.round(node.healthScore * 100)}%
            </span>
          </div>
          <Progress className="h-2" value={node.healthScore * 100} />
        </div>
      )}

      {/* Importance score */}
      {node.importanceScore !== undefined && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("pages.dashboard.graph.sidebar.contact.importance")}</span>
            <span className="font-medium">
              {Math.round(node.importanceScore * 100)}%
            </span>
          </div>
          <Progress className="h-2" value={node.importanceScore * 100} />
        </div>
      )}

      {/* Status badges */}
      <div className="flex gap-2">
        {node.isVip && (
          <Badge className="bg-yellow-100 text-yellow-800" variant="secondary">
            <Star className="mr-1 h-3 w-3" />
            {t("pages.dashboard.graph.sidebar.contact.vip")}
          </Badge>
        )}
        {node.isAtRisk && (
          <Badge variant="destructive">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {t("pages.dashboard.graph.sidebar.contact.atRisk")}
          </Badge>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// COMMITMENT DETAILS
// =============================================================================

function CommitmentDetails({
  node,
}: {
  node: GraphNodeData & { nodeType: "commitment" };
}) {
  const t = useT();
  const { locale } = useI18n();
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    in_progress: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    overdue: "bg-red-100 text-red-800",
  };

  const priorityColors: Record<string, string> = {
    low: "bg-gray-100 text-gray-800",
    medium: "bg-yellow-100 text-yellow-800",
    high: "bg-orange-100 text-orange-800",
    urgent: "bg-red-100 text-red-800",
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <Badge
          className={
            node.direction === "owed_by_me"
              ? "bg-blue-100 text-blue-800"
              : "bg-green-100 text-green-800"
          }
        >
          {node.direction === "owed_by_me"
            ? t("pages.dashboard.graph.sidebar.commitment.iOwe")
            : t("pages.dashboard.graph.sidebar.commitment.owedToMe")}
        </Badge>
        <h3 className="mt-2 font-semibold">{node.label}</h3>
      </div>

      <Separator />

      {/* Status & Priority */}
      <div className="flex gap-2">
        <Badge className={statusColors[node.status] ?? "bg-gray-100"}>
          {node.status.replace("_", " ")}
        </Badge>
        <Badge className={priorityColors[node.priority] ?? "bg-gray-100"}>
          {node.priority}
        </Badge>
      </div>

      {/* Due date */}
      {node.dueDate && (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>
            {t("pages.dashboard.graph.sidebar.commitment.due", {
              date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(
                new Date(node.dueDate)
              ),
            })}
          </span>
          {node.isOverdue && (
            <Badge className="ml-auto" variant="destructive">
              {t("pages.dashboard.graph.sidebar.commitment.overdue")}
            </Badge>
          )}
        </div>
      )}

      {/* Confidence */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("pages.dashboard.graph.sidebar.aiConfidence")}</span>
          <span className="font-medium">
            {Math.round(node.confidence * 100)}%
          </span>
        </div>
        <Progress className="h-2" value={node.confidence * 100} />
      </div>
    </div>
  );
}

// =============================================================================
// DECISION DETAILS
// =============================================================================

function DecisionDetails({
  node,
}: {
  node: GraphNodeData & { nodeType: "decision" };
}) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <Badge className="bg-purple-100 text-purple-800" variant="secondary">
          {t("pages.dashboard.graph.sidebar.decision.badge")}
        </Badge>
        <h3 className="mt-2 font-semibold">{node.label}</h3>
      </div>

      <Separator />

      {/* Decided at */}
      <div className="flex items-center gap-2 text-sm">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <span>
          {t("pages.dashboard.graph.sidebar.decision.decided", {
            date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(
              new Date(node.decidedAt)
            ),
          })}
        </span>
      </div>

      {/* Status */}
      <div className="flex gap-2">
        <Badge
          className={
            node.isSuperseded
              ? "bg-gray-100 text-gray-500"
              : "bg-green-100 text-green-800"
          }
        >
          {node.isSuperseded
            ? t("pages.dashboard.graph.sidebar.decision.superseded")
            : t("pages.dashboard.graph.sidebar.decision.active")}
        </Badge>
      </div>

      {/* Rationale */}
      {node.rationale && (
        <div className="text-sm">
          <p className="font-medium text-muted-foreground">{t("pages.dashboard.graph.sidebar.decision.rationale")}</p>
          <p className="mt-1">{node.rationale}</p>
        </div>
      )}

      {/* Confidence */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("pages.dashboard.graph.sidebar.aiConfidence")}</span>
          <span className="font-medium">
            {Math.round(node.confidence * 100)}%
          </span>
        </div>
        <Progress className="h-2" value={node.confidence * 100} />
      </div>
    </div>
  );
}

// =============================================================================
// TASK DETAILS
// =============================================================================

function TaskDetails({ node }: { node: GraphNodeData & { nodeType: "task" } }) {
  const t = useT();
  const { locale } = useI18n();
  const statusColors: Record<string, string> = {
    backlog: "bg-gray-100 text-gray-800",
    todo: "bg-yellow-100 text-yellow-800",
    in_progress: "bg-blue-100 text-blue-800",
    done: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <Badge className="bg-green-100 text-green-800" variant="secondary">
          {t("pages.dashboard.graph.sidebar.task.badge")}
        </Badge>
        <h3 className="mt-2 font-semibold">{node.label}</h3>
      </div>

      <Separator />

      {/* Status & Priority */}
      <div className="flex gap-2">
        <Badge className={statusColors[node.status] ?? "bg-gray-100"}>
          {node.status === "done" ? (
            <>
              <Check className="mr-1 h-3 w-3" />
              {t("pages.dashboard.graph.sidebar.task.done")}
            </>
          ) : (
            node.status.replace("_", " ")
          )}
        </Badge>
        <Badge variant="outline">{node.priority}</Badge>
      </div>

      {/* Due date */}
      {node.dueDate && (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span>
            {t("pages.dashboard.graph.sidebar.task.due", {
              date: new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(
                new Date(node.dueDate)
              ),
            })}
          </span>
        </div>
      )}

      {/* Source */}
      {node.sourceType && (
        <div className="text-sm">
          <p className="text-muted-foreground">
            {t("pages.dashboard.graph.sidebar.task.source")}{" "}
            <span className="font-medium">{node.sourceType}</span>
          </p>
        </div>
      )}
    </div>
  );
}
