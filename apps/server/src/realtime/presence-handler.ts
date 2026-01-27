// =============================================================================
// PRESENCE WEBSOCKET HANDLER
// =============================================================================
//
// Real-time presence tracking for collaboration features:
// - Heartbeat/keep-alive
// - Online/away/DND status
// - Who's viewing what resource
// - Typing indicators
//
// Uses Redis pub/sub for multi-server deployments.
//

import type { ServerWebSocket } from "bun";
import { db } from "@memorystack/db";
import {
  userPresence,
  resourceViewers,
  type ViewingType,
} from "@memorystack/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { getRedis, isRedisConfigured } from "@memorystack/db/lib/redis";
import { log } from "../lib/logger";

// =============================================================================
// TYPES
// =============================================================================

export interface PresenceWebSocketData {
  connectionId: string;
  organizationId: string;
  userId: string;
  authenticated: boolean;
}

// Map to schema enum values
type PresenceStatusDB = "online" | "away" | "busy" | "do_not_disturb" | "offline";

// Client can send shorter version
export type PresenceStatus = "online" | "away" | "dnd" | "busy" | "offline";

function mapStatusToDb(status: PresenceStatus): PresenceStatusDB {
  if (status === "dnd") return "do_not_disturb";
  return status;
}

interface HeartbeatMessage {
  type: "heartbeat";
}

interface StatusMessage {
  type: "status";
  status: PresenceStatus;
  statusMessage?: string;
}

interface ViewingMessage {
  type: "viewing";
  resourceType: ViewingType;
  resourceId: string;
}

interface StopViewingMessage {
  type: "stop_viewing";
}

interface TypingMessage {
  type: "typing";
  isTyping: boolean;
}

interface SubscribeMessage {
  type: "subscribe";
  channels: string[];
}

interface UnsubscribeMessage {
  type: "unsubscribe";
  channels: string[];
}

type IncomingMessage =
  | HeartbeatMessage
  | StatusMessage
  | ViewingMessage
  | StopViewingMessage
  | TypingMessage
  | SubscribeMessage
  | UnsubscribeMessage;

interface PresenceUpdate {
  type: "presence_update";
  userId: string;
  status: PresenceStatus;
  statusMessage?: string;
  lastActivityAt: string;
}

interface ViewerUpdate {
  type: "viewer_update";
  resourceType: ViewingType;
  resourceId: string;
  userId: string;
  action: "joined" | "left";
  isTyping?: boolean;
}

interface ViewersSnapshot {
  type: "viewers_snapshot";
  resourceType: ViewingType;
  resourceId: string;
  viewers: Array<{
    userId: string;
    isTyping: boolean;
    startedViewingAt: string;
  }>;
}

type OutgoingMessage = PresenceUpdate | ViewerUpdate | ViewersSnapshot;

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

// Map of connectionId -> WebSocket
const connections = new Map<string, ServerWebSocket<PresenceWebSocketData>>();

// Map of connectionId -> subscribed channels
const subscriptions = new Map<string, Set<string>>();

// Map of channel -> connectionIds subscribed to it
const channelSubscribers = new Map<string, Set<string>>();

// Track current viewing per connection
const connectionViewing = new Map<string, { resourceType: ViewingType; resourceId: string }>();

// Constants
const HEARTBEAT_TIMEOUT_MS = 60_000; // Mark offline after 60s without heartbeat
const CLEANUP_INTERVAL_MS = 30_000; // Run cleanup every 30s

// =============================================================================
// REDIS PUB/SUB
// =============================================================================

let redisSubscriber: ReturnType<typeof getRedis> | null = null;

async function initRedisSubscriber(): Promise<void> {
  if (!isRedisConfigured()) {
    log.info("Redis not configured - presence will be single-server only");
    return;
  }

  try {
    // Create a duplicate connection for pub/sub (ioredis pattern)
    redisSubscriber = getRedis().duplicate();

    // Subscribe to presence channel pattern
    await redisSubscriber.psubscribe("presence:*");

    // Handle pattern messages
    redisSubscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
      handleRedisBroadcast(channel, message);
    });

    log.info("Redis presence subscriber connected");
  } catch (error) {
    log.error("Failed to connect Redis presence subscriber", error);
  }
}

function handleRedisBroadcast(channel: string, message: string): void {
  try {
    const parsed = JSON.parse(message) as OutgoingMessage & { senderId?: string };
    const { senderId, ...payload } = parsed;

    // Get subscribers for this channel
    const subscribers = channelSubscribers.get(channel);
    if (!subscribers) return;

    const messageStr = JSON.stringify(payload);

    for (const connectionId of subscribers) {
      // Skip the sender to avoid echo
      if (senderId === connectionId) continue;

      const ws = connections.get(connectionId);
      if (ws) {
        try {
          ws.send(messageStr);
        } catch {
          // Connection may be closed
        }
      }
    }
  } catch (error) {
    log.error("Error handling Redis broadcast", error);
  }
}

async function broadcastToChannel(
  channel: string,
  message: OutgoingMessage,
  senderId?: string
): Promise<void> {
  const messageStr = JSON.stringify(message);

  // Broadcast locally
  const subscribers = channelSubscribers.get(channel);
  if (subscribers) {
    for (const connectionId of subscribers) {
      if (senderId === connectionId) continue;

      const ws = connections.get(connectionId);
      if (ws) {
        try {
          ws.send(messageStr);
        } catch {
          // Connection may be closed
        }
      }
    }
  }

  // Broadcast via Redis for multi-server
  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      await redis.publish(channel, JSON.stringify({ ...message, senderId }));
    } catch (error) {
      log.error("Error publishing to Redis", error);
    }
  }
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

async function updateUserPresence(
  userId: string,
  organizationId: string,
  status: PresenceStatus,
  statusMessage?: string
): Promise<void> {
  const now = new Date();
  const dbStatus = mapStatusToDb(status);

  await db
    .insert(userPresence)
    .values({
      userId,
      organizationId,
      status: dbStatus,
      statusMessage: statusMessage ?? null,
      lastActivityAt: now,
      lastHeartbeat: now,
      currentViewingType: null,
      currentViewingId: null,
    })
    .onConflictDoUpdate({
      target: [userPresence.userId],
      set: {
        organizationId,
        status: dbStatus,
        statusMessage: statusMessage ?? null,
        lastActivityAt: now,
        lastHeartbeat: now,
      },
    });
}

async function updateUserHeartbeat(
  userId: string,
  _organizationId: string
): Promise<void> {
  const now = new Date();
  await db
    .update(userPresence)
    .set({
      lastHeartbeat: now,
      lastActivityAt: now,
    })
    .where(eq(userPresence.userId, userId));
}

async function startViewingResource(
  userId: string,
  organizationId: string,
  resourceType: ViewingType,
  resourceId: string
): Promise<void> {
  const now = new Date();

  // Update presence with current resource
  await db
    .update(userPresence)
    .set({
      currentViewingType: resourceType,
      currentViewingId: resourceId,
      lastActivityAt: now,
    })
    .where(eq(userPresence.userId, userId));

  // Add to resource viewers
  await db
    .insert(resourceViewers)
    .values({
      organizationId,
      resourceType,
      resourceId,
      userId,
      isTyping: false,
      startedViewingAt: now,
      lastHeartbeat: now,
    })
    .onConflictDoUpdate({
      target: [
        resourceViewers.resourceType,
        resourceViewers.resourceId,
        resourceViewers.userId,
      ],
      set: {
        startedViewingAt: now,
        lastHeartbeat: now,
        isTyping: false,
      },
    });
}

async function stopViewingResource(
  userId: string,
  _organizationId: string
): Promise<void> {
  // Clear current resource from presence
  await db
    .update(userPresence)
    .set({
      currentViewingType: null,
      currentViewingId: null,
    })
    .where(eq(userPresence.userId, userId));

  // Remove from all resource viewers
  await db.delete(resourceViewers).where(eq(resourceViewers.userId, userId));
}

async function updateTypingStatus(
  userId: string,
  _organizationId: string,
  isTyping: boolean
): Promise<{ resourceType: ViewingType; resourceId: string } | null> {
  // Get current resource
  const presence = await db.query.userPresence.findFirst({
    where: eq(userPresence.userId, userId),
  });

  if (!presence?.currentViewingType || !presence?.currentViewingId) {
    return null;
  }

  await db
    .update(resourceViewers)
    .set({ isTyping })
    .where(
      and(
        eq(resourceViewers.userId, userId),
        eq(resourceViewers.resourceType, presence.currentViewingType),
        eq(resourceViewers.resourceId, presence.currentViewingId)
      )
    );

  return {
    resourceType: presence.currentViewingType,
    resourceId: presence.currentViewingId,
  };
}

async function getResourceViewersData(
  organizationId: string,
  resourceType: ViewingType,
  resourceId: string
): Promise<ViewersSnapshot["viewers"]> {
  const viewers = await db.query.resourceViewers.findMany({
    where: and(
      eq(resourceViewers.organizationId, organizationId),
      eq(resourceViewers.resourceType, resourceType),
      eq(resourceViewers.resourceId, resourceId)
    ),
  });

  return viewers.map((v) => ({
    userId: v.userId,
    isTyping: v.isTyping,
    startedViewingAt: v.startedViewingAt.toISOString(),
  }));
}

async function cleanupStalePresence(): Promise<void> {
  const staleThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);

  // Mark stale users as offline
  await db
    .update(userPresence)
    .set({ status: "offline" })
    .where(
      and(
        lt(userPresence.lastHeartbeat, staleThreshold),
        // Only update if not already offline
        eq(userPresence.status, "online")
      )
    );

  // Remove stale resource viewers
  await db
    .delete(resourceViewers)
    .where(lt(resourceViewers.lastHeartbeat, staleThreshold));
}

// =============================================================================
// MESSAGE HANDLERS
// =============================================================================

async function handleMessage(
  ws: ServerWebSocket<PresenceWebSocketData>,
  message: IncomingMessage
): Promise<void> {
  const { userId, organizationId, connectionId } = ws.data;

  switch (message.type) {
    case "heartbeat": {
      await updateUserHeartbeat(userId, organizationId);
      ws.send(JSON.stringify({ type: "heartbeat_ack" }));
      break;
    }

    case "status": {
      await updateUserPresence(
        userId,
        organizationId,
        message.status,
        message.statusMessage
      );

      // Broadcast status change to org
      await broadcastToChannel(
        `presence:org:${organizationId}`,
        {
          type: "presence_update",
          userId,
          status: message.status,
          statusMessage: message.statusMessage,
          lastActivityAt: new Date().toISOString(),
        },
        connectionId
      );
      break;
    }

    case "viewing": {
      // Stop viewing previous resource if any
      const previousViewing = connectionViewing.get(connectionId);
      if (previousViewing) {
        const prevChannel = `presence:resource:${previousViewing.resourceType}:${previousViewing.resourceId}`;
        await broadcastToChannel(
          prevChannel,
          {
            type: "viewer_update",
            resourceType: previousViewing.resourceType,
            resourceId: previousViewing.resourceId,
            userId,
            action: "left",
          },
          connectionId
        );
        unsubscribeFromChannel(connectionId, prevChannel);
      }

      await startViewingResource(
        userId,
        organizationId,
        message.resourceType,
        message.resourceId
      );

      // Track this connection's viewing
      connectionViewing.set(connectionId, {
        resourceType: message.resourceType,
        resourceId: message.resourceId,
      });

      const channel = `presence:resource:${message.resourceType}:${message.resourceId}`;

      // Subscribe to this resource's channel
      subscribeToChannel(connectionId, channel);

      // Broadcast that user started viewing
      await broadcastToChannel(
        channel,
        {
          type: "viewer_update",
          resourceType: message.resourceType,
          resourceId: message.resourceId,
          userId,
          action: "joined",
        },
        connectionId
      );

      // Send current viewers snapshot to the new viewer
      const viewers = await getResourceViewersData(
        organizationId,
        message.resourceType,
        message.resourceId
      );

      ws.send(
        JSON.stringify({
          type: "viewers_snapshot",
          resourceType: message.resourceType,
          resourceId: message.resourceId,
          viewers,
        } satisfies ViewersSnapshot)
      );
      break;
    }

    case "stop_viewing": {
      const currentViewing = connectionViewing.get(connectionId);

      if (currentViewing) {
        const channel = `presence:resource:${currentViewing.resourceType}:${currentViewing.resourceId}`;

        // Broadcast that user stopped viewing
        await broadcastToChannel(
          channel,
          {
            type: "viewer_update",
            resourceType: currentViewing.resourceType,
            resourceId: currentViewing.resourceId,
            userId,
            action: "left",
          },
          connectionId
        );

        // Unsubscribe from resource channel
        unsubscribeFromChannel(connectionId, channel);
        connectionViewing.delete(connectionId);
      }

      await stopViewingResource(userId, organizationId);
      break;
    }

    case "typing": {
      const resource = await updateTypingStatus(
        userId,
        organizationId,
        message.isTyping
      );

      if (resource) {
        const channel = `presence:resource:${resource.resourceType}:${resource.resourceId}`;

        await broadcastToChannel(
          channel,
          {
            type: "viewer_update",
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            userId,
            action: "joined", // Using joined to update, frontend handles isTyping
            isTyping: message.isTyping,
          },
          connectionId
        );
      }
      break;
    }

    case "subscribe": {
      for (const channel of message.channels) {
        // Validate channel format (security)
        if (channel.startsWith(`presence:org:${organizationId}`)) {
          subscribeToChannel(connectionId, channel);
        } else if (channel.startsWith("presence:resource:")) {
          // Resource channels are allowed if user is in the org
          subscribeToChannel(connectionId, channel);
        }
      }
      break;
    }

    case "unsubscribe": {
      for (const channel of message.channels) {
        unsubscribeFromChannel(connectionId, channel);
      }
      break;
    }
  }
}

function subscribeToChannel(connectionId: string, channel: string): void {
  // Add to connection's subscriptions
  const connSubs = subscriptions.get(connectionId) ?? new Set();
  connSubs.add(channel);
  subscriptions.set(connectionId, connSubs);

  // Add to channel's subscribers
  const channelSubs = channelSubscribers.get(channel) ?? new Set();
  channelSubs.add(connectionId);
  channelSubscribers.set(channel, channelSubs);
}

function unsubscribeFromChannel(connectionId: string, channel: string): void {
  // Remove from connection's subscriptions
  const connSubs = subscriptions.get(connectionId);
  if (connSubs) {
    connSubs.delete(channel);
    if (connSubs.size === 0) {
      subscriptions.delete(connectionId);
    }
  }

  // Remove from channel's subscribers
  const channelSubs = channelSubscribers.get(channel);
  if (channelSubs) {
    channelSubs.delete(connectionId);
    if (channelSubs.size === 0) {
      channelSubscribers.delete(channel);
    }
  }
}

async function handleDisconnect(
  ws: ServerWebSocket<PresenceWebSocketData>
): Promise<void> {
  const { userId, organizationId, connectionId } = ws.data;

  // Get current viewing before cleanup
  const currentViewing = connectionViewing.get(connectionId);

  // Remove from connections
  connections.delete(connectionId);
  connectionViewing.delete(connectionId);

  // Get subscribed channels before cleanup
  const connSubs = subscriptions.get(connectionId);

  // Clean up subscriptions
  if (connSubs) {
    for (const channel of connSubs) {
      const channelSubs = channelSubscribers.get(channel);
      if (channelSubs) {
        channelSubs.delete(connectionId);
        if (channelSubs.size === 0) {
          channelSubscribers.delete(channel);
        }
      }
    }
    subscriptions.delete(connectionId);
  }

  // Update presence to offline
  await updateUserPresence(userId, organizationId, "offline");

  // Broadcast that user is offline
  await broadcastToChannel(
    `presence:org:${organizationId}`,
    {
      type: "presence_update",
      userId,
      status: "offline",
      lastActivityAt: new Date().toISOString(),
    },
    connectionId
  );

  // Broadcast viewer left if was viewing something
  if (currentViewing) {
    await broadcastToChannel(
      `presence:resource:${currentViewing.resourceType}:${currentViewing.resourceId}`,
      {
        type: "viewer_update",
        resourceType: currentViewing.resourceType,
        resourceId: currentViewing.resourceId,
        userId,
        action: "left",
      },
      connectionId
    );
  }

  // Clean up resource viewing
  await stopViewingResource(userId, organizationId);
}

// =============================================================================
// EXPORTED HANDLERS
// =============================================================================

export const presenceHandlers = {
  async open(ws: ServerWebSocket<PresenceWebSocketData>): Promise<void> {
    const { userId, organizationId, connectionId } = ws.data;

    log.info("Presence WebSocket connected", {
      connectionId,
      userId,
      organizationId,
    });

    // Store connection
    connections.set(connectionId, ws);

    // Auto-subscribe to org presence channel
    subscribeToChannel(connectionId, `presence:org:${organizationId}`);

    // Set user as online
    await updateUserPresence(userId, organizationId, "online");

    // Broadcast that user is online
    await broadcastToChannel(
      `presence:org:${organizationId}`,
      {
        type: "presence_update",
        userId,
        status: "online",
        lastActivityAt: new Date().toISOString(),
      },
      connectionId
    );

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: "connected",
        connectionId,
        userId,
        organizationId,
      })
    );
  },

  async message(
    ws: ServerWebSocket<PresenceWebSocketData>,
    message: string | Buffer
  ): Promise<void> {
    try {
      const msgStr = typeof message === "string" ? message : message.toString();
      const parsed = JSON.parse(msgStr) as IncomingMessage;
      await handleMessage(ws, parsed);
    } catch (error) {
      log.error("Error handling presence message", error, {
        connectionId: ws.data.connectionId,
      });
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Invalid message format",
        })
      );
    }
  },

  async close(
    ws: ServerWebSocket<PresenceWebSocketData>,
    code: number,
    reason: string
  ): Promise<void> {
    log.info("Presence WebSocket disconnected", {
      connectionId: ws.data.connectionId,
      code,
      reason,
    });
    await handleDisconnect(ws);
  },

  error(ws: ServerWebSocket<PresenceWebSocketData>, error: Error): void {
    log.error("Presence WebSocket error", error, {
      connectionId: ws.data.connectionId,
    });
  },
};

// =============================================================================
// INITIALIZATION
// =============================================================================

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export async function initializePresenceServer(): Promise<void> {
  // Initialize Redis subscriber for multi-server support
  await initRedisSubscriber();

  // Start cleanup interval
  cleanupInterval = setInterval(async () => {
    try {
      await cleanupStalePresence();
    } catch (error) {
      log.error("Error in presence cleanup", error);
    }
  }, CLEANUP_INTERVAL_MS);

  log.info("Presence server initialized");
}

export async function closePresenceServer(): Promise<void> {
  // Stop cleanup interval
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  // Close all connections
  for (const [_connectionId, ws] of connections) {
    try {
      ws.close(1000, "Server shutting down");
    } catch {
      // Ignore errors
    }
  }
  connections.clear();
  subscriptions.clear();
  channelSubscribers.clear();
  connectionViewing.clear();

  // Close Redis subscriber
  if (redisSubscriber) {
    try {
      await redisSubscriber.quit();
    } catch {
      // Ignore
    }
    redisSubscriber = null;
  }

  log.info("Presence server closed");
}

// =============================================================================
// UTILITIES FOR API ROUTES
// =============================================================================

export function getOnlineConnectionCount(): number {
  return connections.size;
}

export function isUserConnected(userId: string): boolean {
  for (const ws of connections.values()) {
    if (ws.data.userId === userId) {
      return true;
    }
  }
  return false;
}
