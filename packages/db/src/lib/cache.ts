// =============================================================================
// CACHING LAYER
// =============================================================================
//
// Generic caching layer built on Redis for distributed caching across
// multiple server instances. Supports TTL, pattern-based invalidation,
// and type-safe operations.
//

import { getRedisOrNull, isRedisConfigured } from "./redis";

// =============================================================================
// TYPES
// =============================================================================

export interface CacheOptions {
  /** Time-to-live in seconds */
  ttl: number;
  /** Optional prefix override (defaults to cache instance prefix) */
  prefix?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

// =============================================================================
// CACHE CLASS
// =============================================================================

export class Cache {
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly prefix: string,
    private readonly defaultTtl: number = 300 // 5 minutes default
  ) {}

  /**
   * Build a full cache key with prefix
   */
  private buildKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedisOrNull();
    if (!redis) return null;

    try {
      const fullKey = this.buildKey(key);
      const data = await redis.get(fullKey);

      if (data === null) {
        this.misses++;
        return null;
      }

      this.hits++;
      return JSON.parse(data) as T;
    } catch (error) {
      console.error("[Cache] Get error:", error);
      this.misses++;
      return null;
    }
  }

  /**
   * Set a value in cache with TTL
   */
  async set<T>(
    key: string,
    value: T,
    options?: Partial<CacheOptions>
  ): Promise<void> {
    const redis = getRedisOrNull();
    if (!redis) return;

    try {
      const fullKey = this.buildKey(key);
      const ttl = options?.ttl ?? this.defaultTtl;
      const serialized = JSON.stringify(value);

      await redis.setex(fullKey, ttl, serialized);
    } catch (error) {
      console.error("[Cache] Set error:", error);
    }
  }

  /**
   * Delete a specific key from cache
   */
  async delete(key: string): Promise<boolean> {
    const redis = getRedisOrNull();
    if (!redis) return false;

    try {
      const fullKey = this.buildKey(key);
      const result = await redis.del(fullKey);
      return result > 0;
    } catch (error) {
      console.error("[Cache] Delete error:", error);
      return false;
    }
  }

  /**
   * Invalidate all keys matching a pattern
   * Pattern supports * as wildcard (e.g., "user:*" invalidates all user keys)
   */
  async invalidate(pattern: string): Promise<number> {
    const redis = getRedisOrNull();
    if (!redis) return 0;

    try {
      const fullPattern = this.buildKey(pattern);
      let cursor = "0";
      let deletedCount = 0;

      // Use SCAN to find keys matching pattern (safe for production)
      do {
        const [newCursor, keys] = await redis.scan(
          cursor,
          "MATCH",
          fullPattern,
          "COUNT",
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          const deleted = await redis.del(...keys);
          deletedCount += deleted;
        }
      } while (cursor !== "0");

      return deletedCount;
    } catch (error) {
      console.error("[Cache] Invalidate error:", error);
      return 0;
    }
  }

  /**
   * Get or set pattern: fetch from cache or execute function and cache result
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    options?: Partial<CacheOptions>
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fn();
    await this.set(key, value, options);
    return value;
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    const redis = getRedisOrNull();
    if (!redis) return false;

    try {
      const fullKey = this.buildKey(key);
      const result = await redis.exists(fullKey);
      return result > 0;
    } catch (error) {
      console.error("[Cache] Exists error:", error);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key in seconds
   */
  async ttl(key: string): Promise<number> {
    const redis = getRedisOrNull();
    if (!redis) return -2;

    try {
      const fullKey = this.buildKey(key);
      return await redis.ttl(fullKey);
    } catch (error) {
      console.error("[Cache] TTL error:", error);
      return -2;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

// =============================================================================
// PRE-CONFIGURED CACHE INSTANCES
// =============================================================================

/** Cache for inbox/thread list queries (short TTL) */
export const inboxCache = new Cache("inbox", 30);

/** Cache for contact data (medium TTL) */
export const contactsCache = new Cache("contacts", 300);

/** Cache for search results (medium TTL) */
export const searchCache = new Cache("search", 300);

/** Cache for calendar metadata (long TTL) */
export const calendarCache = new Cache("calendar", 3600);

/** Cache for organization data (long TTL) */
export const orgCache = new Cache("org", 600);

/** Cache for user preferences/settings (long TTL) */
export const userCache = new Cache("user", 600);

// =============================================================================
// CACHE KEY BUILDERS
// =============================================================================

/**
 * Build cache key for inbox list
 */
export function buildInboxKey(
  userId: string,
  organizationId: string,
  params: {
    accountId?: string;
    filter?: string;
    cursor?: string;
    limit?: number;
  }
): string {
  const parts = [
    userId,
    organizationId,
    params.accountId ?? "all",
    params.filter ?? "inbox",
  ];
  if (params.cursor) parts.push(params.cursor);
  if (params.limit) parts.push(String(params.limit));
  return parts.join(":");
}

/**
 * Build cache key for contact list
 */
export function buildContactsKey(
  organizationId: string,
  params?: {
    search?: string;
    limit?: number;
    offset?: number;
  }
): string {
  const parts = [organizationId];
  if (params?.search) parts.push(`s:${params.search}`);
  if (params?.limit) parts.push(`l:${params.limit}`);
  if (params?.offset) parts.push(`o:${params.offset}`);
  return parts.join(":");
}

/**
 * Build cache key for search queries
 */
export function buildSearchKey(
  organizationId: string,
  query: string,
  params?: {
    limit?: number;
    offset?: number;
    filters?: Record<string, unknown>;
  }
): string {
  const parts = [organizationId, query];
  if (params?.limit) parts.push(`l:${params.limit}`);
  if (params?.offset) parts.push(`o:${params.offset}`);
  if (params?.filters) parts.push(`f:${JSON.stringify(params.filters)}`);
  return parts.join(":");
}

/**
 * Build cache key for calendar data
 */
export function buildCalendarKey(
  accountId: string,
  calendarId?: string
): string {
  return calendarId ? `${accountId}:${calendarId}` : accountId;
}

// =============================================================================
// INVALIDATION HELPERS
// =============================================================================

/**
 * Invalidate all inbox cache for a user
 */
export async function invalidateUserInbox(userId: string): Promise<void> {
  await inboxCache.invalidate(`${userId}:*`);
}

/**
 * Invalidate all inbox cache for an organization
 */
export async function invalidateOrgInbox(
  organizationId: string
): Promise<void> {
  await inboxCache.invalidate(`*:${organizationId}:*`);
}

/**
 * Invalidate all contact cache for an organization
 */
export async function invalidateOrgContacts(
  organizationId: string
): Promise<void> {
  await contactsCache.invalidate(`${organizationId}:*`);
}

/**
 * Invalidate all search cache for an organization
 */
export async function invalidateOrgSearch(
  organizationId: string
): Promise<void> {
  await searchCache.invalidate(`${organizationId}:*`);
}

/**
 * Invalidate calendar cache for an account
 */
export async function invalidateAccountCalendar(
  accountId: string
): Promise<void> {
  await calendarCache.invalidate(`${accountId}:*`);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if caching is available
 */
export function isCacheAvailable(): boolean {
  return isRedisConfigured();
}

/**
 * Get all cache stats
 */
export function getAllCacheStats(): Record<string, CacheStats> {
  return {
    inbox: inboxCache.getStats(),
    contacts: contactsCache.getStats(),
    search: searchCache.getStats(),
    calendar: calendarCache.getStats(),
    org: orgCache.getStats(),
    user: userCache.getStats(),
  };
}
