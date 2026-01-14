import { createHash } from "node:crypto";
import { db } from "@memorystack/db";
import { apiKey } from "@memorystack/db/schema";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

export interface ApiKeyContext {
  apiKey: {
    id: string;
    userId: string;
    organizationId: string | null;
    scopes: string[];
    rateLimit: string;
  };
}

/**
 * Extract API key from Authorization header
 */
function extractApiKey(c: Context): string | null {
  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    return null;
  }

  // Support "Bearer <key>" format
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Support direct key format
  if (authHeader.startsWith("lm_")) {
    return authHeader;
  }

  return null;
}

/**
 * Verify API key and return key data
 */
async function verifyApiKey(key: string) {
  // Get prefix for lookup
  const prefix = key.slice(0, 11);

  // Find key by prefix
  const keyRecord = await db.query.apiKey.findFirst({
    where: eq(apiKey.keyPrefix, prefix),
  });

  if (!keyRecord) {
    return null;
  }

  // Check expiration
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
    return null;
  }

  // Verify hash
  const hash = createHash("sha256").update(key).digest("hex");
  if (hash !== keyRecord.keyHash) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  db.update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, keyRecord.id))
    .execute()
    .catch(() => {
      // Silently fail - don't block the request
    });

  return {
    id: keyRecord.id,
    userId: keyRecord.userId,
    organizationId: keyRecord.organizationId,
    scopes: keyRecord.scopes ?? [],
    rateLimit: keyRecord.rateLimit ?? "100/minute",
  };
}

/**
 * API key authentication middleware
 * Validates API key from Authorization header
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const key = extractApiKey(c);

    if (!key) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "API key required. Provide via Authorization header.",
        },
        401
      );
    }

    const keyData = await verifyApiKey(key);

    if (!keyData) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "Invalid or expired API key",
        },
        401
      );
    }

    // Attach key data to context
    c.set("apiKey", keyData);

    return next();
  };
}

/**
 * Scope validation middleware
 * Ensures the API key has required scopes
 */
export function requireScopes(...requiredScopes: string[]): MiddlewareHandler {
  return async (c, next) => {
    const keyData = c.get("apiKey") as ApiKeyContext["apiKey"] | undefined;

    if (!keyData) {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "API key authentication required",
        },
        401
      );
    }

    // Check if key has admin scope (allows all)
    if (keyData.scopes.includes("admin")) {
      return await next();
    }

    // Check required scopes
    const hasAllScopes = requiredScopes.every((scope) =>
      keyData.scopes.includes(scope)
    );

    if (!hasAllScopes) {
      return c.json(
        {
          error: "FORBIDDEN",
          message: `Missing required scopes: ${requiredScopes.join(", ")}`,
          required: requiredScopes,
          provided: keyData.scopes,
        },
        403
      );
    }

    return await next();
  };
}

/**
 * Optional API key auth - doesn't fail if no key provided
 * Useful for endpoints that support both authenticated and unauthenticated access
 */
export function optionalApiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const key = extractApiKey(c);

    if (key) {
      const keyData = await verifyApiKey(key);
      if (keyData) {
        c.set("apiKey", keyData);
      }
    }

    return next();
  };
}
