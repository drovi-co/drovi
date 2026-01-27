/**
 * Presence Hooks
 *
 * Provides React Query hooks for real-time presence management:
 * - Online status tracking
 * - Who's viewing what
 * - Typing indicators
 *
 * Supports both WebSocket (real-time) and polling (fallback) modes.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// Types
// =============================================================================

export type PresenceStatus =
  | "online"
  | "away"
  | "busy"
  | "do_not_disturb"
  | "offline";

export type ViewingType =
  | "inbox"
  | "conversation"
  | "commitment"
  | "decision"
  | "task"
  | "contact"
  | "uio"
  | "settings"
  | "shared_inbox"
  | "search"
  | "dashboard"
  | "other";

// =============================================================================
// Heartbeat Hook
// =============================================================================

/**
 * Sends periodic heartbeats to maintain presence.
 * Should be used at the app root level.
 */
export function usePresenceHeartbeat(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const heartbeatMutation = useMutation(
    trpc.presence.heartbeat.mutationOptions()
  );

  const sendHeartbeat = useCallback(
    (viewingType?: ViewingType, viewingId?: string) => {
      if (!params.enabled) {
        return;
      }

      heartbeatMutation.mutate({
        organizationId: params.organizationId,
        viewingType,
        viewingId,
      });
    },
    [params.organizationId, params.enabled, heartbeatMutation]
  );

  // Set up periodic heartbeat
  useEffect(() => {
    if (!params.enabled) {
      return;
    }

    // Initial heartbeat
    sendHeartbeat();

    // Periodic heartbeat every 30 seconds
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, 30_000);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [params.enabled, sendHeartbeat]);

  return { sendHeartbeat };
}

// =============================================================================
// Online Users Hook
// =============================================================================

/**
 * Get list of online users in the organization.
 */
export function useOnlineUsers(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.presence.getOnlineUsers.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled ?? true, refetchInterval: 10_000 }
    )
  );
}

// =============================================================================
// Resource Viewers Hook
// =============================================================================

/**
 * Get list of users currently viewing a specific resource.
 */
export function useResourceViewers(params: {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.presence.getResourceViewers.queryOptions(
      {
        organizationId: params.organizationId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      },
      { enabled: params.enabled ?? true, refetchInterval: 5000 }
    )
  );
}

// =============================================================================
// Set Viewing Hook
// =============================================================================

/**
 * Track when user starts/stops viewing a resource.
 */
export function useSetViewing(params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const setViewingMutation = useMutation(
    trpc.presence.setViewing.mutationOptions({
      onSuccess: () => {
        // Invalidate viewers query
        queryClient.invalidateQueries({
          queryKey: ["presence", "getResourceViewers"],
        });
      },
    })
  );

  const startViewing = useCallback(
    (resourceType: ViewingType, resourceId: string) => {
      setViewingMutation.mutate({
        organizationId: params.organizationId,
        resourceType,
        resourceId,
        isViewing: true,
      });
    },
    [params.organizationId, setViewingMutation]
  );

  const stopViewing = useCallback(
    (resourceType: ViewingType, resourceId: string) => {
      setViewingMutation.mutate({
        organizationId: params.organizationId,
        resourceType,
        resourceId,
        isViewing: false,
      });
    },
    [params.organizationId, setViewingMutation]
  );

  return { startViewing, stopViewing, isLoading: setViewingMutation.isPending };
}

// =============================================================================
// Set Status Hook
// =============================================================================

/**
 * Set user's presence status.
 */
export function useSetStatus(_params: { organizationId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.presence.setStatus.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: ["presence", "getOnlineUsers"],
        });
        queryClient.invalidateQueries({
          queryKey: ["presence", "getMyPresence"],
        });
      },
    })
  );
}

// =============================================================================
// Typing Indicator Hook
// =============================================================================

/**
 * Track typing status for a resource.
 * Uses refs to prevent infinite loops and debounces typing state.
 */
export function useTypingIndicator(params: {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
}) {
  const trpc = useTRPC();
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCurrentlyTypingRef = useRef(false);
  const lastTypingCallRef = useRef(0);

  // Store params in ref to avoid stale closures
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const setTypingMutation = useMutation(
    trpc.presence.setTyping.mutationOptions()
  );

  // Store mutation in ref
  const mutationRef = useRef(setTypingMutation);
  mutationRef.current = setTypingMutation;

  // Stable setTyping function that doesn't change between renders
  const setTyping = useCallback((isTyping: boolean) => {
    const now = Date.now();
    const { organizationId, resourceType, resourceId } = paramsRef.current;

    // Debounce: don't call if same state or called too recently (within 1 second)
    if (
      isTyping === isCurrentlyTypingRef.current &&
      now - lastTypingCallRef.current < 1000
    ) {
      return;
    }

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    isCurrentlyTypingRef.current = isTyping;
    lastTypingCallRef.current = now;

    mutationRef.current.mutate({
      organizationId,
      resourceType,
      resourceId,
      isTyping,
    });

    // Auto-clear typing after 5 seconds
    if (isTyping) {
      typingTimeoutRef.current = setTimeout(() => {
        if (isCurrentlyTypingRef.current) {
          isCurrentlyTypingRef.current = false;
          mutationRef.current.mutate({
            organizationId: paramsRef.current.organizationId,
            resourceType: paramsRef.current.resourceType,
            resourceId: paramsRef.current.resourceId,
            isTyping: false,
          });
        }
      }, 5000);
    }
  }, []); // Empty deps - uses refs internally

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      // Clear typing state on unmount
      if (isCurrentlyTypingRef.current) {
        mutationRef.current.mutate({
          organizationId: paramsRef.current.organizationId,
          resourceType: paramsRef.current.resourceType,
          resourceId: paramsRef.current.resourceId,
          isTyping: false,
        });
      }
    };
  }, []);

  return { setTyping };
}

// =============================================================================
// My Presence Hook
// =============================================================================

/**
 * Get current user's presence state.
 */
export function useMyPresence(params: {
  organizationId: string;
  enabled?: boolean;
}) {
  const trpc = useTRPC();

  return useQuery(
    trpc.presence.getMyPresence.queryOptions(
      { organizationId: params.organizationId },
      { enabled: params.enabled ?? true }
    )
  );
}

// =============================================================================
// WebSocket Presence Context
// =============================================================================

interface PresenceWebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface PresenceContextValue {
  isConnected: boolean;
  send: (message: PresenceWebSocketMessage) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  startViewing: (resourceType: string, resourceId: string) => void;
  stopViewing: () => void;
  setTyping: (isTyping: boolean) => void;
  setStatus: (status: PresenceStatus, statusMessage?: string) => void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

export { PresenceContext };

/**
 * Use the presence WebSocket context.
 * Must be used within a PresenceProvider.
 */
export function usePresenceConnection(): PresenceContextValue {
  const context = useContext(PresenceContext);
  if (!context) {
    throw new Error(
      "usePresenceConnection must be used within a PresenceProvider"
    );
  }
  return context;
}

// =============================================================================
// WebSocket Presence Hook (for provider)
// =============================================================================

interface UsePresenceWebSocketParams {
  organizationId: string;
  token?: string;
  enabled?: boolean;
  wsUrl?: string;
}

export function usePresenceWebSocket(params: UsePresenceWebSocketParams) {
  const {
    organizationId,
    token,
    enabled = true,
    wsUrl = typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/presence`
      : "",
  } = params;

  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  // Connection management
  const connect = useCallback(() => {
    if (!(enabled && organizationId)) {
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      const url = new URL(wsUrl);
      if (token) {
        url.searchParams.set("token", token);
      }
      url.searchParams.set("organizationId", organizationId);

      const ws = new WebSocket(url.toString());

      ws.onopen = () => {
        console.log("[Presence] WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as PresenceWebSocketMessage;
          handleMessage(message);
        } catch (error) {
          console.error("[Presence] Failed to parse message", error);
        }
      };

      ws.onclose = (event) => {
        console.log("[Presence] WebSocket closed", event.code, event.reason);
        setIsConnected(false);
        setConnectionId(null);

        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }

        // Reconnect after delay if enabled and not intentionally closed
        if (enabled && event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 5000);
        }
      };

      ws.onerror = (error) => {
        console.error("[Presence] WebSocket error", error);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("[Presence] Failed to create WebSocket", error);
    }
  }, [enabled, organizationId, token, wsUrl]);

  const handleMessage = useCallback(
    (message: PresenceWebSocketMessage) => {
      switch (message.type) {
        case "connected":
          setIsConnected(true);
          setConnectionId(message.connectionId as string);

          // Start heartbeat
          heartbeatIntervalRef.current = setInterval(() => {
            send({ type: "heartbeat" });
          }, 30_000);
          break;

        case "heartbeat_ack":
          // Heartbeat acknowledged
          break;

        case "presence_update":
          // Update online users query
          queryClient.invalidateQueries({
            queryKey: ["presence", "getOnlineUsers"],
          });
          break;

        case "viewer_update":
          // Update resource viewers query
          queryClient.invalidateQueries({
            queryKey: [
              "presence",
              "getResourceViewers",
              {
                resourceType: message.resourceType,
                resourceId: message.resourceId,
              },
            ],
          });
          break;

        case "viewers_snapshot":
          // Update resource viewers query with snapshot data
          queryClient.setQueryData(
            [
              "presence",
              "getResourceViewers",
              {
                organizationId,
                resourceType: message.resourceType,
                resourceId: message.resourceId,
              },
            ],
            { viewers: message.viewers }
          );
          break;

        case "error":
          console.error("[Presence] Server error:", message.message);
          break;
      }
    },
    [queryClient, organizationId]
  );

  const send = useCallback((message: PresenceWebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback(
    (channel: string) => {
      send({ type: "subscribe", channels: [channel] });
    },
    [send]
  );

  const unsubscribe = useCallback(
    (channel: string) => {
      send({ type: "unsubscribe", channels: [channel] });
    },
    [send]
  );

  const startViewing = useCallback(
    (resourceType: string, resourceId: string) => {
      send({ type: "viewing", resourceType, resourceId });
    },
    [send]
  );

  const stopViewing = useCallback(() => {
    send({ type: "stop_viewing" });
  }, [send]);

  const setTyping = useCallback(
    (isTyping: boolean) => {
      send({ type: "typing", isTyping });
    },
    [send]
  );

  const setStatus = useCallback(
    (status: PresenceStatus, statusMessage?: string) => {
      send({ type: "status", status, statusMessage });
    },
    [send]
  );

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      // Clear timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

      // Close connection
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounted");
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected,
    connectionId,
    send,
    subscribe,
    unsubscribe,
    startViewing,
    stopViewing,
    setTyping,
    setStatus,
  };
}

// =============================================================================
// Resource Viewing Hook (WebSocket-aware)
// =============================================================================

/**
 * Track viewing a resource with automatic cleanup.
 * Uses WebSocket when available, falls back to tRPC.
 */
export function useTrackViewing(params: {
  organizationId: string;
  resourceType: ViewingType;
  resourceId: string;
  enabled?: boolean;
}) {
  const presenceContext = useContext(PresenceContext);
  const trpc = useTRPC();

  // Store params in refs to use in cleanup without triggering re-renders
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Track current viewing state
  const currentResourceRef = useRef<string | null>(null);
  const hasCalledStartRef = useRef(false);

  // Create mutation outside effect to get stable reference
  const setViewingMutation = useMutation(
    trpc.presence.setViewing.mutationOptions()
  );

  // Store mutation in ref to avoid closure issues
  const mutationRef = useRef(setViewingMutation);
  mutationRef.current = setViewingMutation;

  useEffect(() => {
    const { enabled, organizationId, resourceType, resourceId } =
      paramsRef.current;

    if (!(enabled && organizationId && resourceId)) {
      return;
    }

    const resourceKey = `${resourceType}:${resourceId}`;

    // Skip if we're already viewing this exact resource
    if (
      currentResourceRef.current === resourceKey &&
      hasCalledStartRef.current
    ) {
      return;
    }

    // If switching resources, stop viewing the old one first
    if (
      currentResourceRef.current &&
      currentResourceRef.current !== resourceKey
    ) {
      if (presenceContext?.isConnected) {
        presenceContext.stopViewing();
      }
      // Note: we don't call the tRPC stop here to avoid race conditions
    }

    currentResourceRef.current = resourceKey;
    hasCalledStartRef.current = true;

    // Use WebSocket if available
    if (presenceContext?.isConnected) {
      presenceContext.startViewing(resourceType, resourceId);
    } else {
      // Fall back to tRPC
      mutationRef.current.mutate({
        organizationId,
        resourceType,
        resourceId,
        isViewing: true,
      });
    }

    // Cleanup only runs on unmount or when resource changes
    return () => {
      const currentKey = currentResourceRef.current;
      // Only stop if this cleanup is for the current resource
      if (currentKey === resourceKey) {
        if (presenceContext?.isConnected) {
          presenceContext.stopViewing();
        } else {
          mutationRef.current.mutate({
            organizationId: paramsRef.current.organizationId,
            resourceType: paramsRef.current.resourceType,
            resourceId: paramsRef.current.resourceId,
            isViewing: false,
          });
        }
        currentResourceRef.current = null;
        hasCalledStartRef.current = false;
      }
    };
    // Only depend on the resource identity and enabled state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.enabled,
    params.organizationId,
    params.resourceType,
    params.resourceId,
  ]);
}
