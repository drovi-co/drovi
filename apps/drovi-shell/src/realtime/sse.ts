import { useEffect, useRef, useCallback } from "react";
import { apiClient } from "../api/client";
import { useConnectionStore } from "../store/connectionStore";
import { useUIStore } from "../store/uiStore";

export type SSEEventType =
  | "connection.sync.started"
  | "connection.sync.progress"
  | "connection.sync.completed"
  | "connection.sync.failed"
  | "uio.created"
  | "uio.updated"
  | "uio.deleted"
  | "brief.updated"
  | "alert.new";

export interface SSEEvent {
  event: SSEEventType;
  data: {
    connection_id?: string;
    uio_id?: string;
    progress?: number;
    records_processed?: number;
    error?: string;
    message?: string;
    [key: string]: unknown;
  };
  timestamp: string;
}

interface SSEOptions {
  organizationId: string;
  onEvent?: (event: SSEEvent) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
}

/**
 * Create an SSE connection to the backend for real-time updates
 */
export function createSSEConnection(options: SSEOptions): () => void {
  const {
    organizationId,
    onEvent,
    autoReconnect = true,
    reconnectInterval = 5000,
  } = options;

  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let isClosing = false;

  const connect = () => {
    if (isClosing) return;

    const baseUrl = apiClient.getBaseUrl();
    const url = `${baseUrl}/api/v1/stream/subscribe?organization_id=${organizationId}`;

    eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      console.log("[SSE] Connected to real-time stream");
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SSEEvent;
        handleEvent(data);
        onEvent?.(data);
      } catch (error) {
        console.error("[SSE] Failed to parse event:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Connection error:", error);
      eventSource?.close();

      if (autoReconnect && !isClosing) {
        console.log(`[SSE] Reconnecting in ${reconnectInterval}ms...`);
        reconnectTimer = setTimeout(connect, reconnectInterval);
      }
    };
  };

  const handleEvent = (event: SSEEvent) => {
    const { checkSyncStatus, loadConnections } = useConnectionStore.getState();
    const { addNotification } = useUIStore.getState();

    switch (event.event) {
      case "connection.sync.started":
        if (event.data.connection_id) {
          checkSyncStatus(event.data.connection_id, organizationId);
        }
        break;

      case "connection.sync.progress":
        if (event.data.connection_id) {
          checkSyncStatus(event.data.connection_id, organizationId);
        }
        break;

      case "connection.sync.completed":
        if (event.data.connection_id) {
          checkSyncStatus(event.data.connection_id, organizationId);
          loadConnections(organizationId);
          addNotification({
            type: "success",
            title: "Sync Complete",
            message: `Processed ${event.data.records_processed?.toLocaleString() ?? 0} records`,
          });
        }
        break;

      case "connection.sync.failed":
        if (event.data.connection_id) {
          checkSyncStatus(event.data.connection_id, organizationId);
          addNotification({
            type: "error",
            title: "Sync Failed",
            message: event.data.error || "An error occurred during sync",
          });
        }
        break;

      case "uio.created":
      case "uio.updated":
        // Could trigger a refresh of relevant views
        break;

      case "alert.new":
        addNotification({
          type: "warning",
          title: "New Alert",
          message: event.data.message || "You have a new alert",
        });
        break;
    }
  };

  // Start connection
  connect();

  // Return cleanup function
  return () => {
    isClosing = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    eventSource?.close();
  };
}

/**
 * React hook for SSE connection with automatic cleanup
 */
export function useSSE(organizationId: string | null) {
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleEvent = useCallback((event: SSEEvent) => {
    // Additional event handling can be added here
    console.log("[SSE] Received event:", event.event);
  }, []);

  useEffect(() => {
    if (!organizationId) return;

    // Create SSE connection
    cleanupRef.current = createSSEConnection({
      organizationId,
      onEvent: handleEvent,
    });

    // Cleanup on unmount or orgId change
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [organizationId, handleEvent]);
}

// SSEProvider should be used in a React component file (.tsx)
