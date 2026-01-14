// =============================================================================
// HMAC SIGNING UTILITIES FOR OAUTH STATE
// =============================================================================
//
// HMAC-SHA256 signing for OAuth state parameters to prevent tampering.
// Uses timing-safe comparison to prevent timing attacks.
//

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@memorystack/env/server";

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

/**
 * Get the signing key from environment.
 * Falls back to a derived key from BETTER_AUTH_SECRET if TOKEN_ENCRYPTION_KEY is not set.
 *
 * @throws Error if neither key is configured
 */
function getSigningKey(): Buffer {
  const keyString = env.TOKEN_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET;

  if (!keyString) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY or BETTER_AUTH_SECRET is required for OAuth state signing."
    );
  }

  // If key is base64 encoded, decode it
  if (keyString.length === 44 && keyString.endsWith("=")) {
    const decoded = Buffer.from(keyString, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  }

  // Use key directly or derive from it
  const keyBuffer = Buffer.from(keyString, "utf-8");

  if (keyBuffer.length < 32) {
    throw new Error(
      "Signing key must be at least 32 characters."
    );
  }

  // Use first 32 bytes
  return keyBuffer.subarray(0, 32);
}

/**
 * Check if signing is configured.
 */
export function isSigningConfigured(): boolean {
  return Boolean(env.TOKEN_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET);
}

// =============================================================================
// SIGNING FUNCTIONS
// =============================================================================

/**
 * Sign a payload using HMAC-SHA256.
 * Used for OAuth state to prevent tampering.
 *
 * @param payload - The data to sign
 * @returns Signed string in format: payload.signature
 */
export function signPayload(payload: string): string {
  const key = getSigningKey();
  const signature = createHmac("sha256", key)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verify and extract a signed payload.
 *
 * @param signedPayload - The signed string (payload.signature)
 * @returns The original payload if valid, null if invalid
 */
export function verifySignedPayload(signedPayload: string): string | null {
  const lastDotIndex = signedPayload.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return null;
  }

  const payload = signedPayload.substring(0, lastDotIndex);
  const providedSignature = signedPayload.substring(lastDotIndex + 1);

  // Recompute signature
  const key = getSigningKey();
  const expectedSignature = createHmac("sha256", key)
    .update(payload)
    .digest("base64url");

  // Timing-safe comparison to prevent timing attacks
  try {
    const providedBuffer = Buffer.from(providedSignature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");

    if (providedBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Safely sign payload, returning unsigned if signing key not configured.
 */
export function safeSignPayload(payload: string): string {
  if (!isSigningConfigured()) {
    return payload;
  }
  return signPayload(payload);
}

/**
 * Safely verify signed payload, accepting unsigned if signing key not configured.
 */
export function safeVerifySignedPayload(signedPayload: string): string | null {
  if (!isSigningConfigured()) {
    // No signing configured, return as-is (for backwards compat)
    return signedPayload;
  }

  // Check if it looks signed (has a dot for signature)
  if (!signedPayload.includes(".")) {
    // Not signed - might be legacy unsigned state
    return signedPayload;
  }

  return verifySignedPayload(signedPayload);
}

/**
 * Generate a random state token for OAuth flows.
 */
export function generateRandomToken(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}
