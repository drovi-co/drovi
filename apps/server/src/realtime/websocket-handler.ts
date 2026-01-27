// =============================================================================
// WEBSOCKET HANDLER FOR BUN + HONO
// =============================================================================
//
// Handles WebSocket connections for:
// - Presence/collaboration features (active)
// - Intelligence events are handled by Python SSE at:
//   /api/v1/events/stream/{organization_id}
//

import { auth } from "@memorystack/auth";
import type { Server, ServerWebSocket } from "bun";
import { log } from "../lib/logger";
import {
  closePresenceServer,
  initializePresenceServer,
  type PresenceWebSocketData,
  presenceHandlers,
} from "./presence-handler";

// =============================================================================
// TYPES
// =============================================================================

interface WebSocketData extends PresenceWebSocketData {
  // Additional fields can be added here for other WebSocket features
}

// Simplified WebSocket server interface
interface WebSocketServer {
  close(): void;
}

// =============================================================================
// SINGLETON STATE
// =============================================================================

let wsServer: WebSocketServer | null = null;
let initialized = false;

/**
 * Get the WebSocket server instance.
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wsServer;
}

/**
 * Initialize the WebSocket server for presence features.
 */
export async function initializeWebSocketServer(): Promise<WebSocketServer | null> {
  if (initialized) {
    return wsServer;
  }

  try {
    // Initialize presence server
    await initializePresenceServer();

    wsServer = {
      close: () => {
        // Handled in closeWebSocketServer
      },
    };

    initialized = true;
    log.info("WebSocket server initialized for presence features");
    log.info(
      "For intelligence events, use Python SSE at /api/v1/events/stream/{organization_id}"
    );

    return wsServer;
  } catch (error) {
    log.error("Failed to initialize WebSocket server", error);
    return null;
  }
}

// =============================================================================
// BUN WEBSOCKET HANDLERS
// =============================================================================

/**
 * Bun WebSocket configuration for presence features.
 */
export const bunWebSocketHandlers = {
  /**
   * Called when a WebSocket connection is opened.
   */
  async open(ws: ServerWebSocket<WebSocketData>) {
    if (!ws.data.authenticated) {
      log.warn("Unauthenticated WebSocket connection rejected");
      ws.close(4001, "Authentication required");
      return;
    }

    await presenceHandlers.open(ws);
  },

  /**
   * Called when a message is received from the client.
   */
  async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    if (!ws.data.authenticated) {
      return;
    }

    await presenceHandlers.message(ws, message);
  },

  /**
   * Called when a WebSocket connection is closed.
   */
  async close(
    ws: ServerWebSocket<WebSocketData>,
    code: number,
    reason: string
  ) {
    await presenceHandlers.close(ws, code, reason);
  },

  /**
   * Called when an error occurs on the WebSocket.
   */
  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    presenceHandlers.error(ws, error);
  },
};

// =============================================================================
// WEBSOCKET UPGRADE HANDLER
// =============================================================================

/**
 * Handle WebSocket upgrade requests.
 * Validates authentication and upgrades the connection.
 */
export async function handleWebSocketUpgrade(
  server: Server<WebSocketData>,
  request: Request
): Promise<boolean> {
  const url = new URL(request.url);

  // Extract auth token from query params or headers
  const token =
    url.searchParams.get("token") ??
    request.headers.get("authorization")?.replace("Bearer ", "");

  if (!token) {
    log.warn("WebSocket upgrade rejected - no token provided");
    return false;
  }

  // Validate session
  try {
    const session = await auth.api.getSession({
      headers: new Headers({
        authorization: `Bearer ${token}`,
      }),
    });

    if (!session?.user?.id) {
      log.warn("WebSocket upgrade rejected - invalid session");
      return false;
    }

    // Extract organization ID from query params
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      log.warn("WebSocket upgrade rejected - no organizationId provided");
      return false;
    }

    // Generate unique connection ID
    const connectionId = `${session.user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Upgrade the connection with user data
    const success = server.upgrade(request, {
      data: {
        connectionId,
        organizationId,
        userId: session.user.id,
        authenticated: true,
      },
    });

    if (success) {
      log.info("WebSocket connection upgraded", {
        connectionId,
        userId: session.user.id,
        organizationId,
      });
    }

    return success;
  } catch (error) {
    log.error("Error during WebSocket upgrade", error);
    return false;
  }
}

// =============================================================================
// SHUTDOWN
// =============================================================================

/**
 * Gracefully close all WebSocket connections.
 */
export async function closeWebSocketServer(): Promise<void> {
  if (wsServer) {
    await closePresenceServer();
    wsServer = null;
    initialized = false;
  }
  log.info("WebSocket server closed");
}
