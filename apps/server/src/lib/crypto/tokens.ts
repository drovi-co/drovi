// =============================================================================
// TOKEN ENCRYPTION UTILITIES
// =============================================================================
//
// AES-256-GCM encryption for OAuth tokens at rest.
// Each encryption produces unique output due to random IV.
//

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@memorystack/env/server";

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * AES-256-GCM algorithm identifier
 */
const ALGORITHM = "aes-256-gcm" as const;

/**
 * IV length in bytes (96 bits recommended for GCM)
 */
const IV_LENGTH = 12;

/**
 * Auth tag length in bytes (128 bits)
 */
const AUTH_TAG_LENGTH = 16;

/**
 * Key version prefix for future key rotation support
 */
const KEY_VERSION = "v1";

// =============================================================================
// KEY MANAGEMENT
// =============================================================================

/**
 * Get the encryption key from environment.
 * Key should be 32 bytes (256 bits) for AES-256.
 *
 * @throws Error if key is not configured
 */
function getEncryptionKey(): Buffer {
  const keyString = env.TOKEN_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not configured. Set a 32+ character secret in environment variables."
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
      `TOKEN_ENCRYPTION_KEY must be at least 32 characters. Got ${keyBuffer.length} characters.`
    );
  }

  // Use first 32 bytes
  return keyBuffer.subarray(0, 32);
}

// =============================================================================
// ENCRYPTION FUNCTIONS
// =============================================================================

/**
 * Encrypted token format:
 * version:iv:authTag:ciphertext
 *
 * All components are base64url encoded.
 */
type EncryptedToken = string;

/**
 * Encrypt a token for storage.
 *
 * @param plaintext - Token to encrypt (access token or refresh token)
 * @returns Encrypted token string
 *
 * @example
 * ```ts
 * const encrypted = encryptToken(accessToken);
 * // Store encrypted in database
 * await db.update(emailAccount).set({ accessToken: encrypted })
 * ```
 */
export function encryptToken(plaintext: string): EncryptedToken {
  const key = getEncryptionKey();

  // Generate random IV for this encryption
  const iv = randomBytes(IV_LENGTH);

  // Create cipher
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);

  // Get auth tag
  const authTag = cipher.getAuthTag();

  // Combine: version:iv:authTag:ciphertext
  const parts = [
    KEY_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ];

  return parts.join(":");
}

/**
 * Decrypt a stored token.
 *
 * @param encrypted - Encrypted token string from storage
 * @returns Decrypted plaintext token
 * @throws Error if decryption fails (tampered data, wrong key, etc.)
 *
 * @example
 * ```ts
 * const account = await db.query.emailAccount.findFirst({ ... });
 * const accessToken = decryptToken(account.accessToken);
 * ```
 */
export function decryptToken(encrypted: EncryptedToken): string {
  // Parse components
  const parts = encrypted.split(":");

  if (parts.length !== 4) {
    throw new Error("Invalid encrypted token format");
  }

  const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;

  // Version check
  if (version !== KEY_VERSION) {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }

  if (!(ivBase64 && authTagBase64 && ciphertextBase64)) {
    throw new Error("Invalid encrypted token format: missing components");
  }

  // Decode components
  const iv = Buffer.from(ivBase64, "base64url");
  const authTag = Buffer.from(authTagBase64, "base64url");
  const ciphertext = Buffer.from(ciphertextBase64, "base64url");

  // Validate lengths
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: ${authTag.length}`);
  }

  // Get key
  const key = getEncryptionKey();

  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  // Set auth tag
  decipher.setAuthTag(authTag);

  // Decrypt
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf-8");
  } catch (error) {
    // Auth tag verification failed - data was tampered or key is wrong
    throw new Error(
      "Token decryption failed. Data may be corrupted or encryption key may have changed."
    );
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a string looks like an encrypted token.
 */
export function isEncryptedToken(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 4 && parts[0] === KEY_VERSION;
}

/**
 * Generate a new encryption key for environment configuration.
 * Returns a 32-byte key encoded as base64.
 *
 * Run this to generate a key:
 * ```
 * import { generateEncryptionKey } from './lib/crypto/tokens';
 * console.log(generateEncryptionKey());
 * ```
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Check if token encryption is configured.
 */
export function isTokenEncryptionConfigured(): boolean {
  return Boolean(env.TOKEN_ENCRYPTION_KEY);
}

/**
 * Safely encrypt tokens, returning plaintext if encryption is not configured.
 * This allows graceful degradation in development.
 */
export function safeEncryptToken(plaintext: string): string {
  if (!isTokenEncryptionConfigured()) {
    // Only warn once per process to avoid log spam
    if (
      typeof globalThis !== "undefined" &&
      !(globalThis as unknown as Record<string, boolean>).__encryptionWarned
    ) {
      (globalThis as unknown as Record<string, boolean>).__encryptionWarned =
        true;
      // Can't import logger here due to circular deps, but this warning is important for dev
      // biome-ignore lint/suspicious/noConsole: Warning for dev only
      console.warn(
        "TOKEN_ENCRYPTION_KEY not configured - storing tokens in plaintext. " +
          "This is insecure for production use."
      );
    }
    return plaintext;
  }
  return encryptToken(plaintext);
}

/**
 * Safely decrypt tokens, returning as-is if not encrypted.
 * This allows reading tokens that were stored before encryption was enabled.
 */
export function safeDecryptToken(maybeEncrypted: string): string {
  if (!isEncryptedToken(maybeEncrypted)) {
    return maybeEncrypted;
  }
  return decryptToken(maybeEncrypted);
}

// =============================================================================
// HMAC SIGNING FOR OAUTH STATE
// =============================================================================

/**
 * Sign a payload using HMAC-SHA256.
 * Used for OAuth state to prevent tampering.
 *
 * @param payload - The data to sign
 * @returns Signed string in format: payload.signature
 */
export function signPayload(payload: string): string {
  const key = getEncryptionKey();
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
  const key = getEncryptionKey();
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
 * Safely sign payload, returning unsigned if encryption key not configured.
 */
export function safeSignPayload(payload: string): string {
  if (!isTokenEncryptionConfigured()) {
    return payload;
  }
  return signPayload(payload);
}

/**
 * Safely verify signed payload, accepting unsigned if encryption key not configured.
 */
export function safeVerifySignedPayload(signedPayload: string): string | null {
  if (!isTokenEncryptionConfigured()) {
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
