// =============================================================================
// REDIS CLIENT
// =============================================================================
//
// Singleton Redis client for distributed caching and rate limiting.
// Supports lazy initialization and graceful shutdown.
//

import { env } from "@memorystack/env/server";
import { Redis } from "ioredis";

// =============================================================================
// TYPES
// =============================================================================

export interface RedisHealthCheck {
  connected: boolean;
  latencyMs: number | null;
  error?: string;
}

// =============================================================================
// SINGLETON CLIENT
// =============================================================================

let redis: Redis | null = null;
let connectionPromise: Promise<Redis> | null = null;

/**
 * Check if Redis is configured via environment variables
 */
export function isRedisConfigured(): boolean {
  return Boolean(env.REDIS_URL);
}

/**
 * Get the Redis client instance.
 * Creates a new connection if one doesn't exist.
 * Throws if REDIS_URL is not configured.
 */
export function getRedis(): Redis {
  if (!env.REDIS_URL) {
    throw new Error(
      "REDIS_URL not configured. Redis is required for distributed caching and rate limiting."
    );
  }

  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      // Connection settings
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        // Exponential backoff with max 30s delay
        const delay = Math.min(times * 100, 30_000);
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: false, // Connect immediately when created

      // Connection pool settings
      family: 4, // IPv4
      keepAlive: 30_000, // Send keepalive every 30s

      // Reconnection settings
      reconnectOnError: (err) => {
        // Reconnect on READONLY errors (happens during failover)
        const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    // Log connection events
    redis.on("connect", () => {
      console.log("[Redis] Connected to server");
    });

    redis.on("ready", () => {
      console.log("[Redis] Connection ready");
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redis.on("close", () => {
      console.log("[Redis] Connection closed");
    });

    redis.on("reconnecting", () => {
      console.log("[Redis] Reconnecting...");
    });
  }

  return redis;
}

/**
 * Get the Redis client if available, or null if not configured.
 * Use this for optional Redis features.
 */
export function getRedisOrNull(): Redis | null {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    return getRedis();
  } catch {
    return null;
  }
}

/**
 * Connect to Redis and wait for the connection to be ready.
 * Returns the connected client.
 */
export async function connectRedis(): Promise<Redis> {
  if (!isRedisConfigured()) {
    throw new Error("REDIS_URL not configured");
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = new Promise((resolve, reject) => {
    const client = getRedis();

    if (client.status === "ready") {
      resolve(client);
      return;
    }

    const onReady = () => {
      client.off("error", onError);
      resolve(client);
    };

    const onError = (err: Error) => {
      client.off("ready", onReady);
      reject(err);
    };

    client.once("ready", onReady);
    client.once("error", onError);
  });

  return connectionPromise;
}

/**
 * Check Redis connection health with latency measurement.
 */
export async function checkRedisHealth(): Promise<RedisHealthCheck> {
  if (!isRedisConfigured()) {
    return { connected: false, latencyMs: null, error: "Not configured" };
  }

  try {
    const client = getRedis();
    const start = performance.now();
    await client.ping();
    const latencyMs = Math.round(performance.now() - start);

    return {
      connected: true,
      latencyMs,
    };
  } catch (error) {
    return {
      connected: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Gracefully disconnect from Redis.
 * Should be called during application shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    console.log("[Redis] Disconnecting...");
    await redis.quit();
    redis = null;
    connectionPromise = null;
    console.log("[Redis] Disconnected");
  }
}

/**
 * Force disconnect from Redis without waiting for pending commands.
 * Use only in emergency shutdown situations.
 */
export function forceDisconnectRedis(): void {
  if (redis) {
    redis.disconnect();
    redis = null;
    connectionPromise = null;
  }
}
