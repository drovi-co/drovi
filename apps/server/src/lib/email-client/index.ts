// =============================================================================
// EMAIL CLIENT FACTORY
// =============================================================================

import type { SourceAccount } from "@memorystack/db/schema";
import { GmailEmailClient } from "./gmail";
import { OutlookEmailClient } from "./outlook";
import type { EmailClient, EmailProvider } from "./types";
import { ProviderError } from "./types";

export * from "./errors";
export { GmailEmailClient } from "./gmail";
export { OutlookEmailClient } from "./outlook";
// Re-export types and errors
export * from "./types";

// =============================================================================
// CLIENT CACHE
// =============================================================================

/**
 * Cache for email client instances.
 * Keyed by account ID for reuse within request lifecycle.
 */
const clientCache = new Map<
  string,
  { client: EmailClient; cachedAt: number }
>();

/**
 * Max age for cached clients (5 minutes)
 */
const CACHE_MAX_AGE = 5 * 60 * 1000;

/**
 * Clear expired entries from the cache
 */
function cleanCache(): void {
  const now = Date.now();
  for (const [key, entry] of clientCache) {
    if (now - entry.cachedAt > CACHE_MAX_AGE) {
      clientCache.delete(key);
    }
  }
}

// Run cache cleanup periodically
setInterval(cleanCache, CACHE_MAX_AGE);

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

interface CreateEmailClientOptions {
  /** Account record from database */
  account: Pick<
    SourceAccount,
    | "id"
    | "provider"
    | "externalId"
    | "accessToken"
    | "refreshToken"
    | "tokenExpiresAt"
  >;
  /**
   * Skip cache lookup and create a fresh client.
   * Useful when tokens have been updated.
   */
  skipCache?: boolean;
  /**
   * Function to decrypt tokens.
   * If not provided, tokens are assumed to be plaintext.
   */
  decryptToken?: (encrypted: string) => string;
}

/**
 * Create an email client for the given account.
 *
 * @param options - Configuration options
 * @returns Email client instance
 * @throws ProviderError if provider is not supported
 *
 * @example
 * ```ts
 * const account = await db.query.emailAccount.findFirst({
 *   where: eq(emailAccount.id, accountId),
 * });
 *
 * const client = createEmailClient({ account });
 * const threads = await client.listThreads({ limit: 10 });
 * ```
 */
export function createEmailClient(
  options: CreateEmailClientOptions
): EmailClient {
  const { account, skipCache = false, decryptToken } = options;

  // Check cache first
  if (!skipCache) {
    const cached = clientCache.get(account.id);
    if (cached && Date.now() - cached.cachedAt < CACHE_MAX_AGE) {
      return cached.client;
    }
  }

  // Validate tokens exist
  if (!(account.accessToken && account.refreshToken)) {
    throw new ProviderError(
      "Account is missing OAuth tokens",
      account.provider as EmailProvider,
      undefined
    );
  }

  // Decrypt tokens if decryption function provided
  const accessToken = decryptToken
    ? decryptToken(account.accessToken)
    : account.accessToken;
  const refreshToken = decryptToken
    ? decryptToken(account.refreshToken)
    : account.refreshToken;

  // Create client based on provider
  let client: EmailClient;

  switch (account.provider) {
    case "gmail": {
      client = new GmailEmailClient(
        account.externalId,
        accessToken,
        refreshToken,
        account.tokenExpiresAt ?? new Date()
      );
      break;
    }
    case "outlook": {
      client = new OutlookEmailClient(
        account.externalId,
        accessToken,
        refreshToken,
        account.tokenExpiresAt ?? new Date()
      );
      break;
    }
    default: {
      throw new ProviderError(
        `Unsupported email provider: ${account.provider}`,
        account.provider as EmailProvider,
        undefined
      );
    }
  }

  // Cache the client
  clientCache.set(account.id, { client, cachedAt: Date.now() });

  return client;
}

/**
 * Invalidate cached client for an account.
 * Call this when tokens are updated.
 *
 * @param accountId - Account ID to invalidate
 */
export function invalidateClientCache(accountId: string): void {
  clientCache.delete(accountId);
}

/**
 * Clear all cached clients.
 * Useful for testing or shutdown.
 */
export function clearClientCache(): void {
  clientCache.clear();
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a provider is supported
 */
export function isSupportedProvider(
  provider: string
): provider is EmailProvider {
  return provider === "gmail" || provider === "outlook";
}

/**
 * Get display name for a provider
 */
export function getProviderDisplayName(provider: EmailProvider): string {
  switch (provider) {
    case "gmail":
      return "Gmail";
    case "outlook":
      return "Outlook";
    default:
      return provider;
  }
}

/**
 * Get provider icon name (for use with icon libraries)
 */
export function getProviderIcon(provider: EmailProvider): string {
  switch (provider) {
    case "gmail":
      return "google";
    case "outlook":
      return "microsoft";
    default:
      return "mail";
  }
}
