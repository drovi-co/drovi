// =============================================================================
// CALENDAR CLIENT FACTORY
// =============================================================================

import type { SourceAccount } from "@memorystack/db/schema";
import { CalendarProviderError } from "./errors";
import { GmailCalendarClient } from "./gmail";
import { OutlookCalendarClient } from "./outlook";
import type { CalendarClient, CalendarProvider } from "./types";

export * from "./errors";
export { GmailCalendarClient } from "./gmail";
export { OutlookCalendarClient } from "./outlook";
// Re-export types and errors
export * from "./types";

// =============================================================================
// CLIENT CACHE
// =============================================================================

/**
 * Cache for calendar client instances.
 * Keyed by account ID for reuse within request lifecycle.
 */
const clientCache = new Map<
  string,
  { client: CalendarClient; cachedAt: number }
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

interface CreateCalendarClientOptions {
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
 * Create a calendar client for the given account.
 *
 * @param options - Configuration options
 * @returns Calendar client instance
 * @throws CalendarProviderError if provider is not supported
 *
 * @example
 * ```ts
 * const account = await db.query.emailAccount.findFirst({
 *   where: eq(emailAccount.id, accountId),
 * });
 *
 * const client = createCalendarClient({ account });
 * const events = await client.listEvents({
 *   timeMin: new Date(),
 *   timeMax: addDays(new Date(), 7),
 * });
 * ```
 */
export function createCalendarClient(
  options: CreateCalendarClientOptions
): CalendarClient {
  const { account, skipCache = false, decryptToken } = options;

  // Check cache first
  if (!skipCache) {
    const cached = clientCache.get(account.id);
    if (cached && Date.now() - cached.cachedAt < CACHE_MAX_AGE) {
      return cached.client;
    }
  }

  // Validate tokens exist
  if (!account.accessToken || !account.refreshToken) {
    throw new CalendarProviderError(
      "Account is missing OAuth tokens",
      account.provider as CalendarProvider,
      400
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
  let client: CalendarClient;

  switch (account.provider) {
    case "gmail": {
      client = new GmailCalendarClient(
        account.externalId,
        accessToken,
        refreshToken,
        account.tokenExpiresAt ?? new Date()
      );
      break;
    }
    case "outlook": {
      client = new OutlookCalendarClient(
        account.externalId,
        accessToken,
        refreshToken,
        account.tokenExpiresAt ?? new Date()
      );
      break;
    }
    default: {
      throw new CalendarProviderError(
        `Unsupported calendar provider: ${account.provider}`,
        account.provider as CalendarProvider,
        400
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
export function invalidateCalendarClientCache(accountId: string): void {
  clientCache.delete(accountId);
}

/**
 * Clear all cached clients.
 * Useful for testing or shutdown.
 */
export function clearCalendarClientCache(): void {
  clientCache.clear();
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a provider supports calendar integration
 */
export function isCalendarSupported(
  provider: string
): provider is CalendarProvider {
  return provider === "gmail" || provider === "outlook";
}

/**
 * Get calendar API display name for a provider
 */
export function getCalendarProviderDisplayName(
  provider: CalendarProvider
): string {
  switch (provider) {
    case "gmail":
      return "Google Calendar";
    case "outlook":
      return "Outlook Calendar";
    default:
      return provider;
  }
}
