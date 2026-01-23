// =============================================================================
// GRAPH REALTIME HOOK
// =============================================================================
//
// Listens for real-time intelligence events and updates the graph accordingly.
//

import { useCallback, useEffect } from "react";
import { useIntelligenceStream } from "@/hooks/use-intelligence-stream";
import type { GraphNode, GraphEdge, GraphNodeData, GraphEdgeType } from "../-types";

// =============================================================================
// TYPES
// =============================================================================

type SetNodes = React.Dispatch<React.SetStateAction<GraphNode[]>>;
type SetEdges = React.Dispatch<React.SetStateAction<GraphEdge[]>>;

// =============================================================================
// HOOK
// =============================================================================

export function useGraphRealtime(setNodes: SetNodes, setEdges: SetEdges) {
  // Subscribe to intelligence events
  // Disabled temporarily - WebSocket endpoint may not be available
  const { events, connectionState } = useIntelligenceStream({
    topics: ["uio.*", "graph.*", "task.*"],
    autoReconnect: false, // Don't spam reconnect attempts
  });

  // Handle UIO created event
  const handleUIOCreated = useCallback(
    (event: { uioId: string; uioType: string; data?: Record<string, unknown> }) => {
      const newNode: GraphNode = {
        id: event.uioId,
        type: event.uioType === "commitment" ? "commitment" : "decision",
        position: {
          x: Math.random() * 600 + 100,
          y: Math.random() * 400 + 100,
        },
        data: {
          id: event.uioId,
          label: (event.data?.title as string) ?? "New Intelligence",
          nodeType: event.uioType === "commitment" ? "commitment" : "decision",
          status: (event.data?.status as string) ?? "pending",
          confidence: (event.data?.confidence as number) ?? 0.5,
          ...(event.uioType === "commitment"
            ? {
                priority: (event.data?.priority as string) ?? "medium",
                direction: (event.data?.direction as "owed_by_me" | "owed_to_me") ?? "owed_by_me",
              }
            : {
                decidedAt: (event.data?.decidedAt as string) ?? new Date().toISOString(),
              }),
        } as GraphNodeData,
      };

      setNodes((prev) => [...prev, newNode]);
    },
    [setNodes]
  );

  // Handle relationship created event
  const handleRelationshipCreated = useCallback(
    (event: { fromId: string; toId: string; type: string }) => {
      const newEdge: GraphEdge = {
        id: `${event.fromId}-${event.toId}-${event.type}`,
        source: event.fromId,
        target: event.toId,
        animated: true,
        data: {
          edgeType: event.type as GraphEdgeType,
        },
      };

      setEdges((prev) => {
        // Check if edge already exists
        const exists = prev.some((e) => e.id === newEdge.id);
        if (exists) return prev;
        return [...prev, newEdge];
      });
    },
    [setEdges]
  );

  // Handle task created event
  const handleTaskCreated = useCallback(
    (event: { taskId: string; uioId?: string; data?: Record<string, unknown> }) => {
      const newNode: GraphNode = {
        id: event.taskId,
        type: "task",
        position: {
          x: Math.random() * 600 + 100,
          y: Math.random() * 400 + 100,
        },
        data: {
          id: event.taskId,
          label: (event.data?.title as string) ?? "New Task",
          nodeType: "task",
          status: (event.data?.status as string) ?? "backlog",
          priority: (event.data?.priority as string) ?? "medium",
          sourceType: (event.data?.sourceType as string) ?? undefined,
        } as GraphNodeData,
      };

      setNodes((prev) => [...prev, newNode]);

      // If linked to a UIO, create edge
      if (event.uioId) {
        const newEdge: GraphEdge = {
          id: `${event.taskId}-${event.uioId}-tracks`,
          source: event.taskId,
          target: event.uioId,
          data: {
            edgeType: "tracks",
          },
        };

        setEdges((prev) => [...prev, newEdge]);
      }
    },
    [setNodes, setEdges]
  );

  // Process incoming events
  useEffect(() => {
    if (!events.length) return;

    // Get the latest event
    const latestEvent = events[events.length - 1];
    if (!latestEvent) return;

    switch (latestEvent.type) {
      case "UIO_CREATED":
        handleUIOCreated(latestEvent as unknown as Parameters<typeof handleUIOCreated>[0]);
        break;
      case "RELATIONSHIP_CREATED":
        handleRelationshipCreated(
          latestEvent as unknown as Parameters<typeof handleRelationshipCreated>[0]
        );
        break;
      case "TASK_CREATED":
        handleTaskCreated(latestEvent as unknown as Parameters<typeof handleTaskCreated>[0]);
        break;
      default:
        // Handle other event types as needed
        break;
    }
  }, [events, handleUIOCreated, handleRelationshipCreated, handleTaskCreated]);

  return {
    isConnected: connectionState === "connected",
    eventCount: events.length,
  };
}
