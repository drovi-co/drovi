// =============================================================================
// HUBSPOT OAUTH CONFIGURATION
// =============================================================================

import { env } from "@memorystack/env/server";

/**
 * HubSpot OAuth scopes for CRM access.
 * @see https://developers.hubspot.com/docs/api/working-with-oauth
 */
export const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read", // Read contacts
  "crm.objects.contacts.write", // Write contacts
  "crm.objects.companies.read", // Read companies
  "crm.objects.deals.read", // Read deals
  "oauth", // OAuth operations
] as const;

/**
 * HubSpot OAuth 2.0 endpoints
 */
export const HUBSPOT_OAUTH_URLS = {
  authorization: "https://app.hubspot.com/oauth/authorize",
  token: "https://api.hubapi.com/oauth/v1/token",
  tokenInfo: "https://api.hubapi.com/oauth/v1/access-tokens",
  refresh: "https://api.hubapi.com/oauth/v1/token",
} as const;

/**
 * HubSpot API base URL
 */
export const HUBSPOT_API_BASE = "https://api.hubapi.com";

/**
 * HubSpot OAuth configuration
 */
export interface HubSpotOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Creates HubSpot OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getHubSpotOAuthConfig(): HubSpotOAuthConfig {
  const clientId = env.HUBSPOT_CLIENT_ID;
  const clientSecret = env.HUBSPOT_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "HubSpot OAuth not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/hubspot/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: HUBSPOT_SCOPES,
  };
}

/**
 * Checks if HubSpot OAuth is configured
 */
export function isHubSpotConfigured(): boolean {
  return Boolean(env.HUBSPOT_CLIENT_ID && env.HUBSPOT_CLIENT_SECRET);
}

/**
 * Generates the HubSpot OAuth authorization URL.
 *
 * @param state - CSRF protection token
 * @param options - Additional options
 */
export function getHubSpotAuthorizationUrl(
  state: string,
  options: {
    /** Additional scopes beyond the default */
    additionalScopes?: string[];
  } = {}
): string {
  const config = getHubSpotOAuthConfig();

  const allScopes = [
    ...config.scopes,
    ...(options.additionalScopes ?? []),
  ];

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: allScopes.join(" "),
  });

  return `${HUBSPOT_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * HubSpot OAuth token response
 */
export interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 */
export async function exchangeHubSpotCode(
  code: string
): Promise<HubSpotTokenResponse> {
  const config = getHubSpotOAuthConfig();

  const response = await fetch(HUBSPOT_OAUTH_URLS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HubSpot token exchange failed: ${error}`);
  }

  return response.json() as Promise<HubSpotTokenResponse>;
}

/**
 * Refresh an access token using a refresh token.
 *
 * @param refreshToken - The refresh token
 */
export async function refreshHubSpotToken(
  refreshToken: string
): Promise<HubSpotTokenResponse> {
  const config = getHubSpotOAuthConfig();

  const response = await fetch(HUBSPOT_OAUTH_URLS.refresh, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HubSpot token refresh failed: ${error}`);
  }

  return response.json() as Promise<HubSpotTokenResponse>;
}

/**
 * Get access token info from HubSpot
 *
 * @param accessToken - Valid access token
 */
export async function getHubSpotTokenInfo(
  accessToken: string
): Promise<{
  token: string;
  user: string;
  hubDomain: string;
  scopes: string[];
  hubId: number;
  appId: number;
  expiresIn: number;
  userId: number;
  tokenType: string;
}> {
  const response = await fetch(`${HUBSPOT_OAUTH_URLS.tokenInfo}/${accessToken}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch HubSpot token info");
  }

  const data = (await response.json()) as {
    token: string;
    user: string;
    hub_domain: string;
    scopes: string[];
    hub_id: number;
    app_id: number;
    expires_in: number;
    user_id: number;
    token_type: string;
  };

  return {
    token: data.token,
    user: data.user,
    hubDomain: data.hub_domain,
    scopes: data.scopes,
    hubId: data.hub_id,
    appId: data.app_id,
    expiresIn: data.expires_in,
    userId: data.user_id,
    tokenType: data.token_type,
  };
}

/**
 * Get account info from HubSpot
 *
 * @param accessToken - Valid access token
 */
export async function getHubSpotAccountInfo(
  accessToken: string
): Promise<{
  portalId: number;
  accountType: string;
  timeZone: string;
  companyCurrency: string;
  utcOffset: string;
  utcOffsetMilliseconds: number;
}> {
  const response = await fetch(`${HUBSPOT_API_BASE}/account-info/v3/details`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch HubSpot account info");
  }

  const data = (await response.json()) as {
    portalId: number;
    accountType: string;
    timeZone: string;
    companyCurrency: string;
    utcOffset: string;
    utcOffsetMilliseconds: number;
  };

  return data;
}

/**
 * Get the current user's info from HubSpot
 *
 * @param accessToken - Valid access token
 */
export async function getHubSpotUserInfo(
  accessToken: string
): Promise<{
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}> {
  // HubSpot uses the token info endpoint to get user details
  const tokenInfo = await getHubSpotTokenInfo(accessToken);

  return {
    id: tokenInfo.userId.toString(),
    email: tokenInfo.user,
    firstName: "", // HubSpot doesn't provide this directly
    lastName: "",
  };
}

/**
 * Revoke a HubSpot OAuth token.
 * Note: HubSpot doesn't have a direct revoke endpoint.
 * Tokens expire naturally or when the app is disconnected.
 *
 * @param _token - Token to revoke (unused, kept for API consistency)
 */
export async function revokeHubSpotToken(_token: string): Promise<void> {
  // HubSpot doesn't support programmatic token revocation
  // Users must disconnect the app from their HubSpot settings
  return Promise.resolve();
}
