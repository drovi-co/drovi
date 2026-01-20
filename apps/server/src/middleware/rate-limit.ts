// Redis type for optional Redis-based rate limiting
interface Redis {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}

import type { Context, MiddlewareHandler } from "hono";

interface RateLimitStore {
  get(key: string): Promise<{ count: number; resetAt: number } | null>;
  set(
    key: string,
    value: { count: number; resetAt: number },
    ttlMs: number
  ): Promise<void>;
  increment(key: string): Promise<number>;
}

/**
 * In-memory rate limit store for development/single-instance deployments
 * For production with multiple instances, use Redis store
 */
class MemoryStore implements RateLimitStore {
  private readonly store = new Map<
    string,
    { count: number; resetAt: number }
  >();

  // biome-ignore lint/suspicious/useAwait: async required for RateLimitStore interface compatibility
  async get(key: string): Promise<{ count: number; resetAt: number } | null> {
    const data = this.store.get(key);
    if (!data) {
      return null;
    }
    if (Date.now() > data.resetAt) {
      this.store.delete(key);
      return null;
    }
    return data;
  }

  // biome-ignore lint/suspicious/useAwait: async required for RateLimitStore interface compatibility
  async set(
    key: string,
    value: { count: number; resetAt: number },
    ttlMs: number
  ): Promise<void> {
    this.store.set(key, value);
    // Auto-cleanup after TTL
    setTimeout(() => {
      this.store.delete(key);
    }, ttlMs);
  }

  // biome-ignore lint/suspicious/useAwait: async required for RateLimitStore interface compatibility
  async increment(key: string): Promise<number> {
    const data = this.store.get(key);
    if (data) {
      data.count++;
      return data.count;
    }
    return 1;
  }
}

interface RateLimitOptions {
  /** Maximum number of requests per window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom key generator - defaults to IP address */
  keyGenerator?: (c: Context) => string;
  /** Custom store - defaults to in-memory */
  store?: RateLimitStore;
  /** Skip rate limiting for certain requests */
  skip?: (c: Context) => boolean;
  /** Message to return when rate limited */
  message?: string;
  /** Custom handler when rate limited */
  handler?: (c: Context) => Response | Promise<Response>;
}

const defaultStore = new MemoryStore();

/**
 * Rate limiting middleware for Hono
 *
 * @example
 * // Basic usage - 100 requests per minute
 * app.use('/api/*', rateLimit({ limit: 100, windowMs: 60000 }));
 *
 * @example
 * // Different limits for different tiers
 * app.use('/api/*', rateLimit({
 *   limit: 1000,
 *   windowMs: 60000,
 *   keyGenerator: (c) => c.req.header('x-api-key') || getClientIp(c)
 * }));
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const {
    limit,
    windowMs,
    keyGenerator = getClientIp,
    store = defaultStore,
    skip,
    message = "Too many requests, please try again later.",
    handler,
  } = options;

  return async (c, next) => {
    // Check if we should skip rate limiting
    if (skip?.(c)) {
      return next();
    }

    const key = `ratelimit:${keyGenerator(c)}`;
    const now = Date.now();

    // Get current rate limit data
    let data = await store.get(key);

    if (data) {
      // Increment counter
      data.count = await store.increment(key);
    } else {
      // First request in window
      data = { count: 1, resetAt: now + windowMs };
      await store.set(key, data, windowMs);
    }

    // Calculate remaining requests
    const remaining = Math.max(0, limit - data.count);
    const resetAt = data.resetAt;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    // Check if rate limit exceeded
    if (data.count > limit) {
      c.header("Retry-After", String(Math.ceil((resetAt - now) / 1000)));

      if (handler) {
        return handler(c);
      }

      return c.json(
        {
          error: "RATE_LIMIT_EXCEEDED",
          message,
          retryAfter: Math.ceil((resetAt - now) / 1000),
        },
        429
      );
    }

    return next();
  };
}

/**
 * Get client IP address from request
 */
function getClientIp(c: Context): string {
  // Check common proxy headers
  const xForwardedFor = c.req.header("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0];
    return firstIp?.trim() ?? "unknown";
  }

  const xRealIp = c.req.header("x-real-ip");
  if (xRealIp) {
    return xRealIp;
  }

  const cfConnectingIp = c.req.header("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  // Fallback to a default value
  return "unknown";
}

/**
 * Rate limit tiers for different subscription levels
 */
export const rateLimitTiers = {
  /** Free tier: 60 requests per minute */
  free: { limit: 60, windowMs: 60 * 1000 },
  /** Pro tier: 300 requests per minute */
  pro: { limit: 300, windowMs: 60 * 1000 },
  /** Enterprise tier: 1000 requests per minute */
  enterprise: { limit: 1000, windowMs: 60 * 1000 },
  /** API tier: 100 requests per minute (for public API) */
  api: { limit: 100, windowMs: 60 * 1000 },
} as const;

/**
 * Strict rate limiter for sensitive endpoints (login, signup, password reset)
 * 5 requests per 15 minutes
 */
export const strictRateLimit = rateLimit({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  message: "Too many attempts. Please try again in 15 minutes.",
});

/**
 * Standard API rate limiter
 * 100 requests per minute
 */
export const standardRateLimit = rateLimit({
  limit: 100,
  windowMs: 60 * 1000,
});

/**
 * Lenient rate limiter for general endpoints
 * 300 requests per minute
 */
export const lenientRateLimit = rateLimit({
  limit: 300,
  windowMs: 60 * 1000,
});

/**
 * Redis-backed rate limit store for distributed deployments
 * Supports multiple server instances sharing rate limit state
 */
class RedisStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<{ count: number; resetAt: number } | null> {
    try {
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }
      const parsed = JSON.parse(data) as { count: number; resetAt: number };
      if (Date.now() > parsed.resetAt) {
        await this.redis.del(key);
        return null;
      }
      return parsed;
    } catch (error) {
      console.error("[RateLimit] Redis get error:", error);
      return null;
    }
  }

  async set(
    key: string,
    value: { count: number; resetAt: number },
    ttlMs: number
  ): Promise<void> {
    try {
      await this.redis.setex(
        key,
        Math.ceil(ttlMs / 1000),
        JSON.stringify(value)
      );
    } catch (error) {
      console.error("[RateLimit] Redis set error:", error);
    }
  }

  async increment(key: string): Promise<number> {
    try {
      const data = await this.redis.get(key);
      if (!data) {
        return 1;
      }
      const parsed = JSON.parse(data) as { count: number; resetAt: number };
      parsed.count++;

      // Preserve the remaining TTL
      const ttl = await this.redis.ttl(key);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, JSON.stringify(parsed));
      }

      return parsed.count;
    } catch (error) {
      console.error("[RateLimit] Redis increment error:", error);
      return 1;
    }
  }
}

/**
 * Create a Redis-backed rate limit store
 * Use this for production deployments with multiple server instances
 */
export function createRedisStore(redis: Redis): RateLimitStore {
  return new RedisStore(redis);
}

export { MemoryStore, RedisStore };
export type { RateLimitStore, RateLimitOptions };
