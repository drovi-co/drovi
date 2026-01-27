// =============================================================================
// REALTIME MODULE
// =============================================================================
//
// WebSocket and real-time event handling for the server.
// - Presence/collaboration: via WebSocket (this module)
// - Intelligence events: via Python SSE at /api/v1/events/stream/{organization_id}
//

export {
  getWebSocketServer,
  initializeWebSocketServer,
  handleWebSocketUpgrade,
  closeWebSocketServer,
  bunWebSocketHandlers,
} from "./websocket-handler";

export {
  getOnlineConnectionCount,
  isUserConnected,
  type PresenceWebSocketData,
} from "./presence-handler";
