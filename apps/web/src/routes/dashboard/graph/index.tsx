// =============================================================================
// KNOWLEDGE GRAPH PAGE
// =============================================================================
//
// Interactive real-time visualization of your professional universe.
// See contacts, commitments, decisions, and tasks all connected.
// Watch intelligence appear in real-time as emails are analyzed.
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
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";
import type {
  GraphEdge,
  GraphNode,
  GraphNodeData,
  GraphNodeType,
} from "./-types";
import { GraphSidebar } from "./components/-graph-sidebar";
import { KnowledgeGraph } from "./components/-knowledge-graph";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/graph/")({
  component: GraphPage,
});

// =============================================================================
// TYPES
// =============================================================================

type NodeFilter = "all" | "contacts" | "commitments" | "decisions" | "tasks";

// Map filter value to node type
const filterToNodeTypes: Record<NodeFilter, GraphNodeType[]> = {
  all: ["contact", "commitment", "decision", "task"],
  contacts: ["contact"],
  commitments: ["commitment"],
  decisions: ["decision"],
  tasks: ["task"],
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function GraphPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNodeData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch graph data
  const {
    data: graphData,
    isLoading,
    refetch,
  } = useQuery({
    ...trpc.graph.getSubgraph.queryOptions({
      organizationId,
      nodeTypes: filterToNodeTypes[nodeFilter],
      limit: 200,
    }),
    enabled: !!organizationId,
  });

  // Transform API data to proper graph types
  // The API returns compatible shapes, but TypeScript's strict null checks cause issues
  // with null vs undefined in optional boolean fields
  const transformedNodes = useMemo((): GraphNode[] => {
    if (!graphData?.nodes) {
      return [];
    }
    // Cast through unknown to handle null vs undefined differences
    return graphData.nodes as unknown as GraphNode[];
  }, [graphData?.nodes]);

  const transformedEdges = useMemo((): GraphEdge[] => {
    if (!graphData?.edges) {
      return [];
    }
    // Cast through unknown to handle edgeType string literal type
    return graphData.edges as unknown as GraphEdge[];
  }, [graphData?.edges]);

  // Handlers
  const handleNodeSelect = useCallback((node: GraphNodeData | null) => {
    setSelectedNode(node);
  }, []);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Loading state
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
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Network className="h-5 w-5 text-primary" />
          <h1 className="font-semibold text-lg">Knowledge Graph</h1>
          {graphData && (
            <Badge className="text-xs" variant="secondary">
              {graphData.nodes?.length ?? 0} nodes ·{" "}
              {graphData.edges?.length ?? 0} connections
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-64 pl-9"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search graph..."
              value={searchQuery}
            />
          </div>

          {/* Filter */}
          <Select
            onValueChange={(v) => setNodeFilter(v as NodeFilter)}
            value={nodeFilter}
          >
            <SelectTrigger className="w-36">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Nodes</SelectItem>
              <SelectItem value="contacts">Contacts</SelectItem>
              <SelectItem value="commitments">Commitments</SelectItem>
              <SelectItem value="decisions">Decisions</SelectItem>
              <SelectItem value="tasks">Tasks</SelectItem>
            </SelectContent>
          </Select>

          {/* Actions */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={handleRefresh} size="icon" variant="outline">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh graph</TooltipContent>
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
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Graph canvas */}
        <div className="flex-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Network className="mx-auto h-12 w-12 animate-pulse text-muted-foreground" />
                <p className="mt-2 text-muted-foreground text-sm">
                  Loading your knowledge graph...
                </p>
              </div>
            </div>
          ) : (
            <KnowledgeGraph
              edges={transformedEdges}
              nodes={transformedNodes}
              onNodeSelect={handleNodeSelect}
              searchQuery={searchQuery}
            />
          )}
        </div>

        {/* Sidebar (selected node details) */}
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
