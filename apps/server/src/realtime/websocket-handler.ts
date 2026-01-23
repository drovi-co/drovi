// =============================================================================
// WEBSOCKET HANDLER FOR BUN + HONO
// =============================================================================
//
// NOTE: WebSocket functionality is now disabled in favor of Python SSE.
// Real-time events are handled by the Python intelligence backend at:
//   /api/v1/events/stream/{organization_id}
//
// This file maintains the same exports for backwards compatibility but
// returns disabled/null states.
//

import type { Server, ServerWebSocket } from "bun";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

interface WebSocketData {
  connectionId: string;
  organizationId: string;
  userId?: string;
  authenticated: boolean;
}

// Simplified WebSocket server interface (stub)
interface WebSocketServer {
  close(): void;
}

// =============================================================================
// SINGLETON STATE
// =============================================================================

let wsServer: WebSocketServer | null = null;

/**
 * Get the WebSocket server instance.
 * Returns null - WebSocket is disabled in favor of Python SSE.
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wsServer;
}

/**
 * Initialize the WebSocket server.
 * Returns null - WebSocket is disabled in favor of Python SSE.
 *
 * For real-time intelligence events, use Python SSE:
 *   const eventSource = new EventSource(
 *     `${INTELLIGENCE_BACKEND_URL}/api/v1/events/stream/${organizationId}`
 *   );
 */
export async function initializeWebSocketServer(): Promise<WebSocketServer | null> {
  log.info(
    "WebSocket server disabled - use Python SSE for real-time events at /api/v1/events/stream/{organization_id}"
  );
  return null;
}


// =============================================================================
// BUN WEBSOCKET HANDLERS (DISABLED)
// =============================================================================

/**
 * Bun WebSocket configuration.
 * WebSocket is disabled - clients should use Python SSE instead.
 */
export const bunWebSocketHandlers = {
  /**
   * Called when a WebSocket connection is opened.
   * Immediately closes with a message to use SSE instead.
   */
  async open(ws: ServerWebSocket<WebSocketData>) {
    log.warn(
      "WebSocket connection attempted - WebSocket is disabled, use Python SSE instead"
    );
    ws.close(1000, "WebSocket disabled - use SSE at /api/v1/events/stream");
  },

  /**
   * Called when a message is received from the client.
   */
  message(_ws: ServerWebSocket<WebSocketData>, _message: string | Buffer) {
    // No-op - WebSocket is disabled
  },

  /**
   * Called when a WebSocket connection is closed.
   */
  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    log.info("WebSocket client disconnected", {
      connectionId: ws.data.connectionId,
      code,
      reason,
    });
  },

  /**
   * Called when an error occurs on the WebSocket.
   */
  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    log.error("WebSocket error", error, {
      connectionId: ws.data.connectionId,
    });
  },
};

// =============================================================================
// WEBSOCKET UPGRADE HANDLER
// =============================================================================

/**
 * Handle WebSocket upgrade requests.
 * Returns false - WebSocket is disabled in favor of Python SSE.
 */
export async function handleWebSocketUpgrade(
  _server: Server<WebSocketData>,
  _request: Request
): Promise<boolean> {
  log.warn(
    "WebSocket upgrade rejected - use Python SSE at /api/v1/events/stream"
  );
  return false;
}

// =============================================================================
// SHUTDOWN
// =============================================================================

/**
 * Gracefully close all WebSocket connections.
 */
export async function closeWebSocketServer(): Promise<void> {
  if (wsServer) {
    wsServer.close();
    wsServer = null;
  }
  log.info("WebSocket server closed");
}
