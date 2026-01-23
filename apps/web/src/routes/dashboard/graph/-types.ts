// =============================================================================
// GRAPH TYPES
// =============================================================================

import type { Node, Edge } from "@xyflow/react";

// =============================================================================
// NODE DATA TYPES
// =============================================================================

export type GraphNodeType =
  | "contact"
  | "commitment"
  | "decision"
  | "task"
  | "conversation"
  | "topic";

export interface BaseNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  nodeType: GraphNodeType;
}

export interface ContactNodeData extends BaseNodeData {
  nodeType: "contact";
  email: string;
  company?: string;
  title?: string;
  avatarUrl?: string;
  healthScore?: number;
  importanceScore?: number;
  isVip?: boolean;
  isAtRisk?: boolean;
}

export interface CommitmentNodeData extends BaseNodeData {
  nodeType: "commitment";
  status: string;
  priority: string;
  direction: "owed_by_me" | "owed_to_me";
  dueDate?: string;
  confidence: number;
  isOverdue?: boolean;
}

export interface DecisionNodeData extends BaseNodeData {
  nodeType: "decision";
  status: string;
  decidedAt: string;
  confidence: number;
  rationale?: string;
  isSuperseded?: boolean;
}

export interface TaskNodeData extends BaseNodeData {
  nodeType: "task";
  status: string;
  priority: string;
  dueDate?: string;
  sourceType?: string;
}

export interface ConversationNodeData extends BaseNodeData {
  nodeType: "conversation";
  sourceType: string;
  messageCount: number;
  lastMessageAt?: string;
}

export interface TopicNodeData extends BaseNodeData {
  nodeType: "topic";
  threadCount: number;
  decisionCount: number;
}

export type GraphNodeData =
  | ContactNodeData
  | CommitmentNodeData
  | DecisionNodeData
  | TaskNodeData
  | ConversationNodeData
  | TopicNodeData;

// =============================================================================
// EDGE DATA TYPES
// =============================================================================

export type GraphEdgeType =
  | "communicates_with"
  | "owns"
  | "involves"
  | "originated_from"
  | "tracks"
  | "depends_on"
  | "supersedes"
  | "related_to";

export interface GraphEdgeData extends Record<string, unknown> {
  edgeType: GraphEdgeType;
  strength?: number;
  label?: string;
  animated?: boolean;
}

// =============================================================================
// REACT FLOW TYPES
// =============================================================================

export type GraphNode = Node<GraphNodeData, GraphNodeType>;
export type GraphEdge = Edge<GraphEdgeData>;

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface GraphSubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics?: {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<GraphNodeType, number>;
  };
}
