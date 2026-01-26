// =============================================================================
// SALESFORCE OAUTH CONFIGURATION
// =============================================================================

import { env } from "@memorystack/env/server";

/**
 * Salesforce OAuth scopes for API access.
 * @see https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_scopes.htm
 */
export const SALESFORCE_SCOPES = [
  "api", // Access and manage your data
  "refresh_token", // Perform requests at any time
  "offline_access", // Access data while you're offline
] as const;

/**
 * Salesforce OAuth 2.0 endpoints
 */
export const SALESFORCE_OAUTH_URLS = {
  authorization: "https://login.salesforce.com/services/oauth2/authorize",
  token: "https://login.salesforce.com/services/oauth2/token",
  revoke: "https://login.salesforce.com/services/oauth2/revoke",
  userInfo: "https://login.salesforce.com/services/oauth2/userinfo",
} as const;

/**
 * Salesforce OAuth configuration
 */
export interface SalesforceOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Creates Salesforce OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getSalesforceOAuthConfig(): SalesforceOAuthConfig {
  const clientId = env.SALESFORCE_CLIENT_ID;
  const clientSecret = env.SALESFORCE_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Salesforce OAuth not configured. Set SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/salesforce/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: SALESFORCE_SCOPES,
  };
}

/**
 * Checks if Salesforce OAuth is configured
 */
export function isSalesforceConfigured(): boolean {
  return Boolean(env.SALESFORCE_CLIENT_ID && env.SALESFORCE_CLIENT_SECRET);
}

/**
 * Generates the Salesforce OAuth authorization URL.
 *
 * @param state - CSRF protection token
 * @param options - Additional options
 */
export function getSalesforceAuthorizationUrl(
  state: string,
  options: {
    /** Use sandbox environment instead of production */
    useSandbox?: boolean;
    /** Prompt for login even if already authenticated */
    prompt?: "login" | "consent" | "select_account";
  } = {}
): string {
  const config = getSalesforceOAuthConfig();

  const baseUrl = options.useSandbox
    ? "https://test.salesforce.com/services/oauth2/authorize"
    : SALESFORCE_OAUTH_URLS.authorization;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: config.scopes.join(" "),
  });

  if (options.prompt) {
    params.set("prompt", options.prompt);
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Salesforce OAuth token response
 */
export interface SalesforceTokenResponse {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
  scope?: string;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @param options - Additional options
 */
export async function exchangeSalesforceCode(
  code: string,
  options: { useSandbox?: boolean } = {}
): Promise<SalesforceTokenResponse> {
  const config = getSalesforceOAuthConfig();

  const tokenUrl = options.useSandbox
    ? "https://test.salesforce.com/services/oauth2/token"
    : SALESFORCE_OAUTH_URLS.token;

  const response = await fetch(tokenUrl, {
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
    throw new Error(`Salesforce token exchange failed: ${error}`);
  }

  return response.json() as Promise<SalesforceTokenResponse>;
}

/**
 * Refresh an access token using a refresh token.
 *
 * @param refreshToken - The refresh token
 * @param instanceUrl - The Salesforce instance URL
 */
export async function refreshSalesforceToken(
  refreshToken: string,
  instanceUrl: string
): Promise<Omit<SalesforceTokenResponse, "refresh_token">> {
  const config = getSalesforceOAuthConfig();

  // Use the instance URL for token refresh
  const tokenUrl = `${instanceUrl}/services/oauth2/token`;

  const response = await fetch(tokenUrl, {
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
    throw new Error(`Salesforce token refresh failed: ${error}`);
  }

  return response.json() as Promise<Omit<SalesforceTokenResponse, "refresh_token">>;
}

/**
 * Get user info from Salesforce
 *
 * @param accessToken - Valid access token
 * @param instanceUrl - Salesforce instance URL
 */
export async function getSalesforceUserInfo(
  accessToken: string,
  instanceUrl: string
): Promise<{
  id: string;
  organizationId: string;
  userId: string;
  username: string;
  displayName: string;
  email: string;
  locale?: string;
  timezone?: string;
}> {
  const response = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Salesforce user info");
  }

  const data = (await response.json()) as {
    sub: string;
    organization_id: string;
    user_id: string;
    preferred_username: string;
    name: string;
    email: string;
    locale?: string;
    zoneinfo?: string;
  };

  return {
    id: data.sub,
    organizationId: data.organization_id,
    userId: data.user_id,
    username: data.preferred_username,
    displayName: data.name,
    email: data.email,
    locale: data.locale,
    timezone: data.zoneinfo,
  };
}

/**
 * Revoke a Salesforce OAuth token.
 *
 * @param token - Access or refresh token to revoke
 * @param instanceUrl - Salesforce instance URL
 */
export async function revokeSalesforceToken(
  token: string,
  instanceUrl: string
): Promise<void> {
  const response = await fetch(`${instanceUrl}/services/oauth2/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
  });

  if (!response.ok) {
    throw new Error("Failed to revoke Salesforce token");
  }
}
