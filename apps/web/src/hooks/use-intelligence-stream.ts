// =============================================================================
// USE INTELLIGENCE STREAM HOOK
// =============================================================================
//
// React hook for subscribing to real-time intelligence events via WebSocket.
// Integrates with React Query for automatic cache invalidation.
//

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Intelligence event from the WebSocket server.
 */
export interface IntelligenceEvent {
  id: string;
  type: string;
  timestamp: number;
  organizationId: string;
  correlationId?: string;
  source: string;
  payload: Record<string, unknown>;
}

/**
 * Message received from the WebSocket server.
 */
interface ServerMessage {
  type: "event" | "subscribed" | "unsubscribed" | "error" | "pong";
  event?: IntelligenceEvent;
  topics?: string[];
  error?: string;
  timestamp: number;
}

/**
 * Message sent to the WebSocket server.
 */
interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  topics?: string[];
}

/**
 * Connection state.
 */
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/**
 * Hook options.
 */
export interface UseIntelligenceStreamOptions {
  /** WebSocket URL (defaults to environment variable) */
  url?: string;
  /** Topics to subscribe to (defaults to all) */
  topics?: string[];
  /** Maximum number of events to keep in history */
  maxEvents?: number;
  /** Automatically reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in milliseconds */
  reconnectDelay?: number;
  /** Callback when an event is received */
  onEvent?: (event: IntelligenceEvent) => void;
  /** Callback when connection state changes */
  onConnectionChange?: (state: ConnectionState) => void;
  /** Enable React Query cache invalidation */
  enableCacheInvalidation?: boolean;
}

/**
 * Hook return value.
 */
export interface UseIntelligenceStreamReturn {
  /** Current connection state */
  connectionState: ConnectionState;
  /** Recent events */
  events: IntelligenceEvent[];
  /** Currently subscribed topics */
  subscribedTopics: string[];
  /** Subscribe to additional topics */
  subscribe: (topics: string[]) => void;
  /** Unsubscribe from topics */
  unsubscribe: (topics: string[]) => void;
  /** Clear event history */
  clearEvents: () => void;
  /** Manually reconnect */
  reconnect: () => void;
  /** Get events of a specific type */
  getEventsByType: (type: string) => IntelligenceEvent[];
}

// =============================================================================
// DEFAULT VALUES
// =============================================================================

const DEFAULT_MAX_EVENTS = 100;
const DEFAULT_RECONNECT_DELAY = 3000;
const DEFAULT_TOPICS = ["uio.*", "task.*"];

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

export function useIntelligenceStream(
  options: UseIntelligenceStreamOptions = {}
): UseIntelligenceStreamReturn {
  const {
    url = getWebSocketUrl(),
    topics = DEFAULT_TOPICS,
    maxEvents = DEFAULT_MAX_EVENTS,
    autoReconnect = true,
    reconnectDelay = DEFAULT_RECONNECT_DELAY,
    onEvent,
    onConnectionChange,
    enableCacheInvalidation = true,
  } = options;

  // State
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [events, setEvents] = useState<IntelligenceEvent[]>([]);
  const [subscribedTopics, setSubscribedTopics] = useState<string[]>([]);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // React Query client for cache invalidation
  const queryClient = useQueryClient();

  // ===========================================================================
  // CACHE INVALIDATION
  // ===========================================================================

  const invalidateRelatedQueries = useCallback(
    (event: IntelligenceEvent) => {
      if (!enableCacheInvalidation) return;

      const eventType = event.type;

      // UIO events
      if (eventType.startsWith("UIO_")) {
        queryClient.invalidateQueries({ queryKey: ["uios"] });
        queryClient.invalidateQueries({ queryKey: ["unified-intelligence"] });
      }

      // Task events
      if (eventType.startsWith("TASK_")) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }

      // Contact events
      if (eventType.startsWith("CONTACT_")) {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
      }

      // Analysis events
      if (eventType.startsWith("ANALYSIS_")) {
        queryClient.invalidateQueries({ queryKey: ["analysis"] });
      }

      // Extraction events
      if (
        eventType === "COMMITMENT_EXTRACTED" ||
        eventType === "DECISION_EXTRACTED"
      ) {
        queryClient.invalidateQueries({ queryKey: ["intelligence"] });
      }
    },
    [queryClient, enableCacheInvalidation]
  );

  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================

  const updateConnectionState = useCallback(
    (state: ConnectionState) => {
      setConnectionState(state);
      onConnectionChange?.(state);
    },
    [onConnectionChange]
  );

  const connect = useCallback(() => {
    if (!url) {
      console.error("[useIntelligenceStream] No WebSocket URL provided");
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    updateConnectionState("connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        updateConnectionState("connected");
        console.log("[useIntelligenceStream] Connected to WebSocket");

        // Subscribe to initial topics
        if (topics.length > 0) {
          sendMessage({ type: "subscribe", topics });
        }

        // Start ping interval to keep connection alive
        pingIntervalRef.current = setInterval(() => {
          sendMessage({ type: "ping" });
        }, 30000);
      };

      ws.onmessage = (messageEvent) => {
        try {
          const message: ServerMessage = JSON.parse(messageEvent.data);
          handleMessage(message);
        } catch (error) {
          console.error("[useIntelligenceStream] Failed to parse message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("[useIntelligenceStream] WebSocket error:", error);
        updateConnectionState("error");
      };

      ws.onclose = () => {
        updateConnectionState("disconnected");
        console.log("[useIntelligenceStream] Disconnected from WebSocket");

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Auto-reconnect
        if (autoReconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("[useIntelligenceStream] Attempting to reconnect...");
            connect();
          }, reconnectDelay);
        }
      };
    } catch (error) {
      console.error("[useIntelligenceStream] Failed to create WebSocket:", error);
      updateConnectionState("error");
    }
  }, [url, topics, autoReconnect, reconnectDelay, updateConnectionState]);

  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Clear ping interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  // ===========================================================================
  // MESSAGE HANDLING
  // ===========================================================================

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const handleMessage = useCallback(
    (message: ServerMessage) => {
      switch (message.type) {
        case "event":
          if (message.event) {
            // Add event to history
            setEvents((prev) => {
              const newEvents = [message.event!, ...prev].slice(0, maxEvents);
              return newEvents;
            });

            // Call event callback
            onEvent?.(message.event);

            // Invalidate related queries
            invalidateRelatedQueries(message.event);
          }
          break;

        case "subscribed":
          if (message.topics) {
            setSubscribedTopics(message.topics);
          }
          break;

        case "unsubscribed":
          if (message.topics) {
            setSubscribedTopics((prev) =>
              prev.filter((t) => !message.topics?.includes(t))
            );
          }
          break;

        case "error":
          console.error("[useIntelligenceStream] Server error:", message.error);
          break;

        case "pong":
          // Connection alive
          break;
      }
    },
    [maxEvents, onEvent, invalidateRelatedQueries]
  );

  // ===========================================================================
  // SUBSCRIPTION MANAGEMENT
  // ===========================================================================

  const subscribe = useCallback(
    (newTopics: string[]) => {
      sendMessage({ type: "subscribe", topics: newTopics });
    },
    [sendMessage]
  );

  const unsubscribe = useCallback(
    (topicsToRemove: string[]) => {
      sendMessage({ type: "unsubscribe", topics: topicsToRemove });
    },
    [sendMessage]
  );

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const getEventsByType = useCallback(
    (type: string): IntelligenceEvent[] => {
      return events.filter((e) => e.type === type);
    },
    [events]
  );

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // ===========================================================================
  // RETURN
  // ===========================================================================

  return {
    connectionState,
    events,
    subscribedTopics,
    subscribe,
    unsubscribe,
    clearEvents,
    reconnect,
    getEventsByType,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function getWebSocketUrl(): string {
  // Use environment variable or construct from current origin
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/api/intelligence/ws`;
  }
  return "";
}

// =============================================================================
// CONVENIENCE HOOKS
// =============================================================================

/**
 * Hook that only listens to UIO events.
 */
export function useUIOEvents(
  options?: Omit<UseIntelligenceStreamOptions, "topics">
): UseIntelligenceStreamReturn {
  return useIntelligenceStream({
    ...options,
    topics: ["uio.*"],
  });
}

/**
 * Hook that only listens to task events.
 */
export function useTaskEvents(
  options?: Omit<UseIntelligenceStreamOptions, "topics">
): UseIntelligenceStreamReturn {
  return useIntelligenceStream({
    ...options,
    topics: ["task.*"],
  });
}

/**
 * Hook that listens to analysis progress events.
 */
export function useAnalysisProgress(
  options?: Omit<UseIntelligenceStreamOptions, "topics">
): UseIntelligenceStreamReturn {
  return useIntelligenceStream({
    ...options,
    topics: ["analysis.*"],
  });
}
