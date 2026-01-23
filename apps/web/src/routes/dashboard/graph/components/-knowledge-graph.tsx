// =============================================================================
// KNOWLEDGE GRAPH COMPONENT
// =============================================================================
//
// Main React Flow canvas with custom node types and real-time updates.
//

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Panel,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import type { GraphNode, GraphEdge, GraphNodeData } from "../-types";
import { ContactNode } from "./nodes/-contact-node";
import { CommitmentNode } from "./nodes/-commitment-node";
import { DecisionNode } from "./nodes/-decision-node";
import { TaskNode } from "./nodes/-task-node";
import { useGraphLayout } from "../hooks/-use-graph-layout";
import { useGraphRealtime } from "../hooks/-use-graph-realtime";

// =============================================================================
// NODE TYPES REGISTRATION
// =============================================================================

// Custom node types for React Flow
// Using type assertion because custom nodes have specific data types
const nodeTypes = {
  contact: ContactNode,
  commitment: CommitmentNode,
  decision: DecisionNode,
  task: TaskNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// =============================================================================
// PROPS
// =============================================================================

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeSelect: (node: GraphNodeData | null) => void;
  searchQuery?: string;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function KnowledgeGraph({
  nodes: initialNodes,
  edges: initialEdges,
  onNodeSelect,
  searchQuery,
}: KnowledgeGraphProps) {
  // Give nodes random positions if they don't have them
  const nodesWithPositions = useMemo(() => {
    return initialNodes.map((node, index) => {
      // If position is at origin, give it a random position
      if (node.position.x === 0 && node.position.y === 0) {
        const angle = (index / initialNodes.length) * 2 * Math.PI;
        const radius = 200 + Math.random() * 100;
        return {
          ...node,
          position: {
            x: 400 + Math.cos(angle) * radius,
            y: 300 + Math.sin(angle) * radius,
          },
        };
      }
      return node;
    });
  }, [initialNodes]);

  // State - initialize with positioned nodes
  const [nodes, setNodes, onNodesChange] = useNodesState(nodesWithPositions);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Apply force-directed layout (optional enhancement)
  const { layoutedNodes } = useGraphLayout(nodesWithPositions, initialEdges);

  // Track if layout has been applied for this data set
  const appliedLayoutIdRef = useRef<string>("");

  // Create a stable ID for the current nodes
  const nodesId = useMemo(
    () => initialNodes.map((n) => n.id).sort().join(","),
    [initialNodes]
  );

  // Listen for real-time updates (disabled for debugging)
  // useGraphRealtime(setNodes, setEdges);

  // Apply D3 layout when it's ready
  useEffect(() => {
    if (layoutedNodes.length > 0 && appliedLayoutIdRef.current !== nodesId) {
      appliedLayoutIdRef.current = nodesId;
      setNodes(layoutedNodes);
      setEdges(initialEdges);
    }
  }, [layoutedNodes, nodesId, initialEdges, setNodes, setEdges]);

  // Filter nodes based on search query
  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodes;
    const query = searchQuery.toLowerCase();
    return nodes.map((node) => ({
      ...node,
      hidden: !node.data.label.toLowerCase().includes(query),
    }));
  }, [nodes, searchQuery]);

  // Handlers
  const handleNodeClick: NodeMouseHandler<GraphNode> = useCallback(
    (_event: ReactMouseEvent, node: GraphNode) => {
      onNodeSelect(node.data);
    },
    [onNodeSelect]
  );

  const handlePaneClick = useCallback(() => {
    onNodeSelect(null);
  }, [onNodeSelect]);

  // Minimap node color
  const getMinimapNodeColor = useCallback((node: GraphNode) => {
    switch (node.data.nodeType) {
      case "contact":
        return "#3b82f6"; // blue-500
      case "commitment":
        return "#8b5cf6"; // violet-500
      case "decision":
        return "#a855f7"; // purple-500
      case "task":
        return "#22c55e"; // green-500
      default:
        return "#6b7280"; // gray-500
    }
  }, []);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={filteredNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: false,
          style: { stroke: "hsl(var(--border))", strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        {/* Background grid */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(var(--muted-foreground) / 0.2)"
        />

        {/* Controls */}
        <Controls
          showZoom
          showFitView
          showInteractive={false}
          className="rounded-lg border bg-background shadow-sm"
        />

        {/* Minimap */}
        <MiniMap
          nodeColor={getMinimapNodeColor}
          maskColor="hsl(var(--background) / 0.8)"
          className="rounded-lg border bg-background/80 shadow-sm"
          zoomable
          pannable
        />

        {/* Legend panel */}
        <Panel position="bottom-left" className="m-4">
          <div className="flex gap-2 rounded-lg border bg-background/80 p-2 backdrop-blur-sm">
            <Badge
              variant="outline"
              className="border-blue-500 bg-blue-500/10 text-blue-700"
            >
              Contacts
            </Badge>
            <Badge
              variant="outline"
              className="border-violet-500 bg-violet-500/10 text-violet-700"
            >
              Commitments
            </Badge>
            <Badge
              variant="outline"
              className="border-purple-500 bg-purple-500/10 text-purple-700"
            >
              Decisions
            </Badge>
            <Badge
              variant="outline"
              className="border-green-500 bg-green-500/10 text-green-700"
            >
              Tasks
            </Badge>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
