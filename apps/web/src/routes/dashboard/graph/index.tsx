// =============================================================================
// KNOWLEDGE GRAPH PAGE
// =============================================================================
//
// Interactive visualization of the memory graph.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Filter,
  Maximize2,
  Minimize2,
  Network,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { graphAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type {
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeData,
  GraphNodeType,
} from "./-types";
import { GraphSidebar } from "./components/-graph-sidebar";
import { KnowledgeGraph } from "./components/-knowledge-graph";

export const Route = createFileRoute("/dashboard/graph/")({
  component: GraphPage,
});

type NodeFilter = "all" | "contacts" | "commitments" | "decisions" | "tasks";

const filterToLabels: Record<NodeFilter, string[]> = {
  all: ["Contact", "Commitment", "Decision", "Task"],
  contacts: ["Contact"],
  commitments: ["Commitment"],
  decisions: ["Decision"],
  tasks: ["Task"],
};

function getValue<T>(
  node: Record<string, unknown>,
  keys: string[],
  fallback: T
): T {
  for (const key of keys) {
    const value = node[key];
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }
  return fallback;
}

function mapNodeType(label: string): GraphNodeType {
  switch (label) {
    case "Contact":
      return "contact";
    case "Commitment":
      return "commitment";
    case "Decision":
      return "decision";
    case "Task":
      return "task";
    default:
      return "topic";
  }
}

function mapEdgeType(raw: string): GraphEdgeType {
  const normalized = raw.toLowerCase();
  const allowed: GraphEdgeType[] = [
    "communicates_with",
    "owns",
    "involves",
    "originated_from",
    "tracks",
    "depends_on",
    "supersedes",
    "related_to",
  ];
  return (
    allowed.includes(normalized as GraphEdgeType) ? normalized : "related_to"
  ) as GraphEdgeType;
}

function GraphPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const labels = filterToLabels[nodeFilter];

  const nodesQuery = useQuery({
    queryKey: ["graph-nodes", organizationId, nodeFilter],
    queryFn: () =>
      graphAPI.query({
        organizationId,
        cypher: `
        MATCH (n)
        WHERE n.organizationId = $orgId AND labels(n)[0] IN $labels
        RETURN labels(n)[0] as node_label, n as node
        LIMIT $limit
      `,
        params: {
          labels,
          limit: 240,
        },
      }),
    enabled: !!organizationId,
  });

  const edgesQuery = useQuery({
    queryKey: ["graph-edges", organizationId, nodeFilter],
    queryFn: () =>
      graphAPI.query({
        organizationId,
        cypher: `
        MATCH (a)-[r]->(b)
        WHERE a.organizationId = $orgId
          AND b.organizationId = $orgId
          AND labels(a)[0] IN $labels
          AND labels(b)[0] IN $labels
        RETURN a.id as source, b.id as target, type(r) as rel_type, r.strength as strength
        LIMIT $limit
      `,
        params: {
          labels,
          limit: 320,
        },
      }),
    enabled: !!organizationId,
  });

  const isGraphLoading = nodesQuery.isLoading || edgesQuery.isLoading;
  const isGraphError = nodesQuery.isError || edgesQuery.isError;
  const graphError = nodesQuery.error ?? edgesQuery.error;

  const { nodes, edges } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const rawNodes = nodesQuery.data?.results ?? [];
    for (const row of rawNodes) {
      const rawNode = (row.node as Record<string, unknown>) ?? row;
      const label = getValue(
        rawNode,
        ["name", "title", "canonicalTitle", "label"],
        t("pages.dashboard.graph.untitled")
      );
      const nodeId = getValue(rawNode, ["id"], "");
      const nodeLabel =
        (row.node_label as string) ?? getValue(rawNode, ["label"], "");
      const finalType = mapNodeType(nodeLabel);

      const base = {
        id: nodeId,
        label,
        nodeType: finalType,
      };

      const data: GraphNodeData =
        finalType === "contact"
          ? {
              ...base,
              nodeType: "contact",
              email: getValue(rawNode, ["email", "primaryEmail"], ""),
              company: getValue(
                rawNode,
                ["company", "organization"],
                undefined
              ),
              title: getValue(rawNode, ["title"], undefined),
              avatarUrl: getValue(
                rawNode,
                ["avatarUrl", "avatar_url"],
                undefined
              ),
              healthScore: getValue(
                rawNode,
                ["healthScore", "health_score"],
                undefined
              ),
              importanceScore: getValue(
                rawNode,
                ["importanceScore", "importance_score"],
                undefined
              ),
              isVip: getValue(rawNode, ["isVip", "is_vip"], false),
              isAtRisk: getValue(rawNode, ["isAtRisk", "is_at_risk"], false),
            }
          : finalType === "commitment"
            ? {
                ...base,
                nodeType: "commitment",
                status: getValue(rawNode, ["status"], "pending"),
                priority: getValue(rawNode, ["priority"], "medium"),
                direction: getValue(rawNode, ["direction"], "owed_by_me"),
                dueDate: getValue(rawNode, ["dueDate", "due_date"], undefined),
                confidence: getValue(rawNode, ["confidence"], 0.6),
                isOverdue: getValue(
                  rawNode,
                  ["isOverdue", "is_overdue"],
                  false
                ),
              }
            : finalType === "decision"
              ? {
                  ...base,
                  nodeType: "decision",
                  status: getValue(rawNode, ["status"], "made"),
                  decidedAt: getValue(rawNode, ["decidedAt", "decided_at"], ""),
                  confidence: getValue(rawNode, ["confidence"], 0.6),
                  rationale: getValue(rawNode, ["rationale"], undefined),
                  isSuperseded: getValue(
                    rawNode,
                    ["isSuperseded", "is_superseded"],
                    false
                  ),
                }
              : {
                  ...base,
                  nodeType: "task",
                  status: getValue(rawNode, ["status"], "open"),
                  priority: getValue(rawNode, ["priority"], "medium"),
                  dueDate: getValue(
                    rawNode,
                    ["dueDate", "due_date"],
                    undefined
                  ),
                  sourceType: getValue(
                    rawNode,
                    ["sourceType", "source_type"],
                    undefined
                  ),
                };

      nodes.push({
        id: nodeId,
        type: finalType,
        position: { x: 0, y: 0 },
        data,
      });
    }

    const rawEdges = edgesQuery.data?.results ?? [];
    for (const [index, row] of rawEdges.entries()) {
      const source = row.source as string;
      const target = row.target as string;
      const relType = row.rel_type as string;
      if (!(source && target)) continue;

      edges.push({
        id: `${source}-${target}-${index}`,
        source,
        target,
        type: "default",
        data: {
          edgeType: mapEdgeType(relType),
          strength: (row.strength as number | undefined) ?? undefined,
          label: relType,
        },
      });
    }

    return { nodes, edges };
  }, [edgesQuery.data, nodesQuery.data, t]);

  const handleNodeSelect = useCallback((node: GraphNodeData | null) => {
    setSelectedNode(node);
  }, []);

  const handleRefresh = useCallback(() => {
    nodesQuery.refetch();
    edgesQuery.refetch();
  }, [nodesQuery, edgesQuery]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col ${isFullscreen ? "fixed inset-0 z-50 bg-background" : ""}`}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg">
            {t("pages.dashboard.graph.title")}
          </h1>
          <Badge className="text-xs" variant="secondary">
            {t("pages.dashboard.graph.counts", {
              nodes: nodes.length,
              edges: edges.length,
            })}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-64 pl-9"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("pages.dashboard.graph.search.placeholder")}
              value={searchQuery}
            />
          </div>

          <Select
            onValueChange={(v) => setNodeFilter(v as NodeFilter)}
            value={nodeFilter}
          >
            <SelectTrigger className="w-36">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("pages.dashboard.graph.filters.all")}
              </SelectItem>
              <SelectItem value="contacts">
                {t("pages.dashboard.graph.filters.contacts")}
              </SelectItem>
              <SelectItem value="commitments">
                {t("pages.dashboard.graph.filters.commitments")}
              </SelectItem>
              <SelectItem value="decisions">
                {t("pages.dashboard.graph.filters.decisions")}
              </SelectItem>
              <SelectItem value="tasks">
                {t("pages.dashboard.graph.filters.tasks")}
              </SelectItem>
            </SelectContent>
          </Select>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleRefresh} size="icon" variant="outline">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("pages.dashboard.graph.actions.refresh")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={toggleFullscreen}
                  size="icon"
                  variant="outline"
                >
                  {isFullscreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isFullscreen
                  ? t("pages.dashboard.graph.actions.exitFullscreen")
                  : t("pages.dashboard.graph.actions.fullscreen")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex flex-1">
        <div className="flex-1">
          {isGraphLoading ? (
            <div className="p-6">
              <Skeleton className="h-[520px] w-full" />
            </div>
          ) : isGraphError ? (
            <div className="p-6">
              <ApiErrorPanel error={graphError} onRetry={handleRefresh} />
            </div>
          ) : (
            <KnowledgeGraph
              edges={edges}
              nodes={nodes}
              onNodeSelect={handleNodeSelect}
              searchQuery={searchQuery}
            />
          )}
        </div>
        {selectedNode && (
          <GraphSidebar
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
