import { env } from "@memorystack/env/server";

// =============================================================================
// GMAIL OAUTH CONFIGURATION
// =============================================================================

/**
 * Gmail API scopes for full email access.
 * Includes read, send, modify capabilities for email intelligence and drafting.
 *
 * @see https://developers.google.com/gmail/api/auth/scopes
 */
export const GMAIL_SCOPES = [
  // Full read/write access to emails (read, modify labels, archive, delete)
  "https://www.googleapis.com/auth/gmail.modify",
  // Send emails on behalf of user
  "https://www.googleapis.com/auth/gmail.send",
  // Create, read, update, and delete drafts
  "https://www.googleapis.com/auth/gmail.compose",
  // Full read/write access to Google Calendar events
  "https://www.googleapis.com/auth/calendar",
  // Get user's email address
  "https://www.googleapis.com/auth/userinfo.email",
  // Get user's profile info
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

/**
 * Google Calendar API base URL
 */
export const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/**
 * Google OAuth 2.0 endpoints
 */
export const GOOGLE_OAUTH_URLS = {
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  userinfo: "https://www.googleapis.com/oauth2/v2/userinfo",
} as const;

/**
 * Gmail API base URL
 */
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

/**
 * Gmail OAuth configuration
 */
export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Creates Gmail OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getGmailOAuthConfig(): GmailOAuthConfig {
  const clientId = env.GMAIL_CLIENT_ID;
  const clientSecret = env.GMAIL_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/gmail/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: GMAIL_SCOPES,
  };
}

/**
 * Checks if Gmail OAuth is configured
 */
export function isGmailConfigured(): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET);
}

/**
 * Generates the Gmail OAuth authorization URL with required parameters.
 *
 * @param state - CSRF protection token (should be cryptographically random)
 * @param options - Additional options for the authorization URL
 */
export function getGmailAuthorizationUrl(
  state: string,
  options: {
    /** Request offline access for refresh tokens */
    accessType?: "online" | "offline";
    /** Force consent screen even if previously authorized */
    prompt?: "none" | "consent" | "select_account";
    /** Pre-fill user's email in consent screen */
    loginHint?: string;
  } = {}
): string {
  const config = getGmailOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    access_type: options.accessType ?? "offline",
    prompt: options.prompt ?? "consent",
    include_granted_scopes: "true",
  });

  if (options.loginHint) {
    params.set("login_hint", options.loginHint);
  }

  return `${GOOGLE_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Access token, refresh token, and expiration
 */
export async function exchangeGmailCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
}> {
  const config = getGmailOAuthConfig();

  const response = await fetch(GOOGLE_OAUTH_URLS.token, {
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
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Gmail token exchange failed: ${error.error_description || error.error}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    scope: data.scope,
  };
}

/**
 * Refresh an expired access token using the refresh token.
 *
 * @param refreshToken - The refresh token
 * @returns New access token and expiration
 */
export async function refreshGmailToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
  tokenType: string;
}> {
  const config = getGmailOAuthConfig();

  const response = await fetch(GOOGLE_OAUTH_URLS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as {
      error?: string;
      error_description?: string;
    };
    throw new Error(
      `Gmail token refresh failed: ${error.error_description || error.error}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/**
 * Revoke a Gmail OAuth token (used when disconnecting account).
 *
 * @param token - Access token or refresh token to revoke
 */
export async function revokeGmailToken(token: string): Promise<void> {
  const response = await fetch(`${GOOGLE_OAUTH_URLS.revoke}?token=${token}`, {
    method: "POST",
  });

  // Google returns 200 even if token was already revoked
  if (!response.ok && response.status !== 400) {
    throw new Error("Failed to revoke Gmail token");
  }
}

/**
 * Get the user's Gmail profile information.
 *
 * @param accessToken - Valid access token
 * @returns User's email and profile info
 */
export async function getGmailUserInfo(accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
  picture?: string;
}> {
  const response = await fetch(GOOGLE_OAUTH_URLS.userinfo, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Gmail user info");
  }

  const data = (await response.json()) as {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };

  return {
    id: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture,
  };
}

/**
 * Validates that all required Gmail scopes were granted.
 *
 * @param grantedScopes - Space-separated string of granted scopes
 * @returns True if all required scopes are present
 */
export function validateGmailScopes(grantedScopes: string): boolean {
  const granted = new Set(grantedScopes.split(" "));

  for (const requiredScope of GMAIL_SCOPES) {
    if (!granted.has(requiredScope)) {
      return false;
    }
  }

  return true;
}
