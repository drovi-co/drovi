// =============================================================================
// GRAPH LAYOUT HOOK
// =============================================================================
//
// Uses D3-Force for force-directed graph layout.
// TODO: Move to Web Worker for better performance with large graphs.
//

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "../-types";

// =============================================================================
// TYPES
// =============================================================================

interface D3Node extends SimulationNodeDatum {
  id: string;
  x?: number;
  y?: number;
}

interface D3Link extends SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
}

// =============================================================================
// HOOK
// =============================================================================

export function useGraphLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const [layoutedNodes, setLayoutedNodes] = useState<GraphNode[]>([]);
  const simulationRef = useRef<ReturnType<
    typeof forceSimulation<D3Node>
  > | null>(null);

  // Run layout simulation
  const runLayout = useCallback(() => {
    if (nodes.length === 0) {
      setLayoutedNodes([]);
      return;
    }

    // Stop any existing simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // Create D3 nodes from React Flow nodes
    // Use random positions if nodes are at origin (0,0) to help D3 spread them out
    const d3Nodes: D3Node[] = nodes.map((node, _index) => {
      const hasPosition = node.position?.x !== 0 || node.position?.y !== 0;
      return {
        id: node.id,
        x: hasPosition ? node.position.x : Math.random() * 800 + 100,
        y: hasPosition ? node.position.y : Math.random() * 600 + 100,
      };
    });

    // Create D3 links from React Flow edges
    const d3Links: D3Link[] = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));

    // Create force simulation
    const simulation = forceSimulation<D3Node>(d3Nodes)
      .force(
        "link",
        forceLink<D3Node, D3Link>(d3Links)
          .id((d) => d.id)
          .distance(150)
          .strength(0.5)
      )
      .force("charge", forceManyBody().strength(-300))
      .force("center", forceCenter(400, 300))
      .force("collide", forceCollide().radius(60).strength(0.7))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    simulationRef.current = simulation;

    // Run simulation until it stabilizes
    simulation.on("end", () => {
      // Map D3 positions back to React Flow nodes
      const positionMap = new Map<string, { x: number; y: number }>();
      for (const d3Node of d3Nodes) {
        positionMap.set(d3Node.id, {
          x: d3Node.x ?? 0,
          y: d3Node.y ?? 0,
        });
      }

      const updatedNodes = nodes.map((node) => {
        const position = positionMap.get(node.id);
        return {
          ...node,
          position: position ?? node.position,
        };
      });

      setLayoutedNodes(updatedNodes);
    });

    // Warm up the simulation
    simulation.tick(100);

    // Trigger end manually after warmup
    const positionMap = new Map<string, { x: number; y: number }>();
    for (const d3Node of d3Nodes) {
      positionMap.set(d3Node.id, {
        x: d3Node.x ?? 0,
        y: d3Node.y ?? 0,
      });
    }

    const updatedNodes = nodes.map((node) => {
      const position = positionMap.get(node.id);
      return {
        ...node,
        position: position ?? node.position,
      };
    });

    setLayoutedNodes(updatedNodes);
  }, [nodes, edges]);

  // Run layout when nodes/edges change
  useEffect(() => {
    runLayout();

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [runLayout]);

  return {
    layoutedNodes,
    runLayout,
  };
}
