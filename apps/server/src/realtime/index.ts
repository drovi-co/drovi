// =============================================================================
// REALTIME MODULE
// =============================================================================
//
// WebSocket and real-time event handling for the server.
// - Presence/collaboration: via WebSocket (this module)
// - Intelligence events: via Python SSE at /api/v1/events/stream/{organization_id}
//

export {
  getOnlineConnectionCount,
  isUserConnected,
  type PresenceWebSocketData,
} from "./presence-handler";
export {
  bunWebSocketHandlers,
  closeWebSocketServer,
  getWebSocketServer,
  handleWebSocketUpgrade,
  initializeWebSocketServer,
} from "./websocket-handler";
