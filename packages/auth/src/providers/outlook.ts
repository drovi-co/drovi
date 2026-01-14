import { env } from "@memorystack/env/server";

// =============================================================================
// OUTLOOK/MICROSOFT OAUTH CONFIGURATION
// =============================================================================

/**
 * Microsoft Graph API scopes for full email access.
 * Includes read, send, modify capabilities for email intelligence and drafting.
 *
 * @see https://docs.microsoft.com/en-us/graph/permissions-reference
 */
export const OUTLOOK_SCOPES = [
  // Full read/write access to emails (read, modify, delete)
  "Mail.ReadWrite",
  // Send emails on behalf of user
  "Mail.Send",
  // Read mailbox settings (folders, rules, etc.)
  "MailboxSettings.Read",
  // Full read/write access to calendars
  "Calendars.ReadWrite",
  // Read user profile
  "User.Read",
  // Required for refresh tokens
  "offline_access",
  // OpenID Connect
  "openid",
  "profile",
  "email",
] as const;

/**
 * Microsoft OAuth 2.0 endpoint templates
 * Use getTenantUrl() to get the actual URL for a specific tenant
 */
export const MICROSOFT_OAUTH_BASE = "https://login.microsoftonline.com";

/**
 * Microsoft Graph API base URL
 */
export const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Outlook OAuth configuration
 */
export interface OutlookOAuthConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Creates Outlook OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getOutlookOAuthConfig(): OutlookOAuthConfig {
  const clientId = env.OUTLOOK_CLIENT_ID;
  const clientSecret = env.OUTLOOK_CLIENT_SECRET;
  const tenantId = env.OUTLOOK_TENANT_ID;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Outlook OAuth not configured. Set OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/outlook/callback`;

  return {
    clientId,
    clientSecret,
    tenantId,
    redirectUri,
    scopes: OUTLOOK_SCOPES,
  };
}

/**
 * Checks if Outlook OAuth is configured
 */
export function isOutlookConfigured(): boolean {
  return Boolean(env.OUTLOOK_CLIENT_ID && env.OUTLOOK_CLIENT_SECRET);
}

/**
 * Gets Microsoft OAuth URLs for a specific tenant.
 *
 * @param tenantId - Azure AD tenant ID or 'common' for multi-tenant
 */
export function getMicrosoftOAuthUrls(tenantId = "common") {
  const base = `${MICROSOFT_OAUTH_BASE}/${tenantId}`;

  return {
    authorization: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    logout: `${base}/oauth2/v2.0/logout`,
  } as const;
}

/**
 * Generates the Outlook OAuth authorization URL with required parameters.
 *
 * @param state - CSRF protection token (should be cryptographically random)
 * @param options - Additional options for the authorization URL
 */
export function getOutlookAuthorizationUrl(
  state: string,
  options: {
    /** Force consent screen even if previously authorized */
    prompt?: "login" | "consent" | "select_account" | "none";
    /** Pre-fill user's email in consent screen */
    loginHint?: string;
    /** Domain hint for work/school accounts */
    domainHint?: string;
  } = {}
): string {
  const config = getOutlookOAuthConfig();
  const urls = getMicrosoftOAuthUrls(config.tenantId);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    response_mode: "query",
  });

  if (options.prompt) {
    params.set("prompt", options.prompt);
  }

  if (options.loginHint) {
    params.set("login_hint", options.loginHint);
  }

  if (options.domainHint) {
    params.set("domain_hint", options.domainHint);
  }

  return `${urls.authorization}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Access token, refresh token, and expiration
 */
export async function exchangeOutlookCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
  idToken?: string;
}> {
  const config = getOutlookOAuthConfig();
  const urls = getMicrosoftOAuthUrls(config.tenantId);

  const response = await fetch(urls.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Outlook token exchange failed: ${error.error_description || error.error}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    id_token?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    scope: data.scope,
    idToken: data.id_token,
  };
}

/**
 * Refresh an expired access token using the refresh token.
 *
 * @param refreshToken - The refresh token
 * @returns New access token, new refresh token (may rotate), and expiration
 */
export async function refreshOutlookToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}> {
  const config = getOutlookOAuthConfig();
  const urls = getMicrosoftOAuthUrls(config.tenantId);

  const response = await fetch(urls.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: config.scopes.join(" "),
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Outlook token refresh failed: ${error.error_description || error.error}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };

  // Microsoft may return a new refresh token
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/**
 * Revoke an Outlook OAuth token (logout endpoint).
 * Note: Microsoft's logout endpoint doesn't fully revoke tokens like Google.
 * The tokens remain valid until they expire.
 *
 * @param _token - Token to revoke (not actually used by Microsoft)
 */
export async function revokeOutlookToken(_token: string): Promise<void> {
  // Microsoft doesn't have a true token revocation endpoint
  // The logout endpoint only ends the SSO session
  // Tokens remain valid until expiration
  // For security, we rely on:
  // 1. Short token lifetimes
  // 2. Not storing tokens after disconnect
  // 3. Azure AD app-level token revocation if needed
}

/**
 * Get the user's Outlook/Microsoft profile information.
 *
 * @param accessToken - Valid access token
 * @returns User's email and profile info
 */
export async function getOutlookUserInfo(accessToken: string): Promise<{
  id: string;
  email: string;
  displayName: string;
  userPrincipalName: string;
  jobTitle?: string;
  officeLocation?: string;
}> {
  const response = await fetch(`${GRAPH_API_BASE}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = (await response.json()) as { error?: { message?: string } };
    throw new Error(
      `Failed to fetch Outlook user info: ${error.error?.message || "Unknown error"}`
    );
  }

  const data = (await response.json()) as {
    id: string;
    mail?: string;
    userPrincipalName: string;
    displayName: string;
    jobTitle?: string;
    officeLocation?: string;
  };

  return {
    id: data.id,
    email: data.mail || data.userPrincipalName,
    displayName: data.displayName,
    userPrincipalName: data.userPrincipalName,
    jobTitle: data.jobTitle,
    officeLocation: data.officeLocation,
  };
}

/**
 * Validates that all required Outlook scopes were granted.
 *
 * @param grantedScopes - Space-separated string of granted scopes
 * @returns True if all required scopes are present
 */
export function validateOutlookScopes(grantedScopes: string): boolean {
  const granted = new Set(grantedScopes.toLowerCase().split(" "));

  // Required scopes (case-insensitive comparison)
  // Note: Mail.ReadWrite implies Mail.Read, so we check for ReadWrite
  const required = [
    "mail.readwrite",
    "mail.send",
    "user.read",
    "offline_access",
  ];

  for (const scope of required) {
    if (!granted.has(scope)) {
      return false;
    }
  }

  return true;
}

/**
 * Parse the ID token to get user claims.
 * Note: This is a simple decode, not verification. Trust only after token exchange.
 *
 * @param idToken - JWT ID token from token response
 * @returns Decoded claims
 */
export function parseOutlookIdToken(idToken: string): {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  tid?: string; // tenant ID
} {
  try {
    const parts = idToken.split(".");
    const payload = parts[1];
    if (!payload) {
      throw new Error("Invalid ID token format");
    }
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString()
    ) as {
      sub: string;
      email?: string;
      name?: string;
      preferred_username?: string;
      tid?: string;
    };
    return decoded;
  } catch {
    throw new Error("Failed to parse Outlook ID token");
  }
}
