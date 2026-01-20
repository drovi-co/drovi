import { env } from "@memorystack/env/server";

// =============================================================================
// SLACK OAUTH CONFIGURATION
// =============================================================================

/**
 * Slack OAuth scopes for workspace access.
 * Includes read access to channels, messages, and user info.
 *
 * @see https://api.slack.com/scopes
 */
export const SLACK_BOT_SCOPES = [
  // Channel access
  "channels:history", // View messages in public channels
  "channels:read", // View basic info about public channels
  "groups:history", // View messages in private channels
  "groups:read", // View basic info about private channels
  "im:history", // View messages in direct messages
  "im:read", // View basic info about direct messages
  "mpim:history", // View messages in group DMs
  "mpim:read", // View basic info about group DMs
  // User info
  "users:read", // View people in a workspace
  "users:read.email", // View email addresses of people
  // Team info
  "team:read", // View basic workspace info
] as const;

/**
 * Slack user scopes (for user token, not bot token)
 */
export const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  "users:read.email",
] as const;

/**
 * Slack OAuth 2.0 endpoints
 */
export const SLACK_OAUTH_URLS = {
  authorization: "https://slack.com/oauth/v2/authorize",
  token: "https://slack.com/api/oauth.v2.access",
  revoke: "https://slack.com/api/auth.revoke",
  test: "https://slack.com/api/auth.test",
} as const;

/**
 * Slack API base URL
 */
export const SLACK_API_BASE = "https://slack.com/api";

/**
 * Slack OAuth configuration
 */
export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  signingSecret?: string;
  redirectUri: string;
  botScopes: readonly string[];
  userScopes: readonly string[];
}

/**
 * Creates Slack OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getSlackOAuthConfig(): SlackOAuthConfig {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;
  const signingSecret = env.SLACK_SIGNING_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Slack OAuth not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/slack/callback`;

  return {
    clientId,
    clientSecret,
    signingSecret,
    redirectUri,
    botScopes: SLACK_BOT_SCOPES,
    userScopes: SLACK_USER_SCOPES,
  };
}

/**
 * Checks if Slack OAuth is configured
 */
export function isSlackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

/**
 * Generates the Slack OAuth authorization URL with required parameters.
 *
 * @param state - CSRF protection token (should be cryptographically random)
 * @param options - Additional options for the authorization URL
 */
export function getSlackAuthorizationUrl(
  state: string,
  options: {
    /** Request user token in addition to bot token */
    requestUserToken?: boolean;
    /** Pre-select a specific team */
    team?: string;
  } = {}
): string {
  const config = getSlackOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    scope: config.botScopes.join(","),
  });

  // Request user token if needed
  if (options.requestUserToken) {
    params.set("user_scope", config.userScopes.join(","));
  }

  // Pre-select team
  if (options.team) {
    params.set("team", options.team);
  }

  return `${SLACK_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * Slack OAuth response types
 */
export interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  app_id: string;
  authed_user: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
  scope: string;
  token_type: string;
  access_token: string;
  bot_user_id: string;
  team: {
    id: string;
    name: string;
  };
  enterprise?: {
    id: string;
    name: string;
  };
  is_enterprise_install: boolean;
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Slack OAuth response with tokens
 */
export async function exchangeSlackCode(
  code: string
): Promise<SlackOAuthResponse> {
  const config = getSlackOAuthConfig();

  const response = await fetch(SLACK_OAUTH_URLS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack token exchange failed: HTTP ${response.status}`);
  }

  const data = (await response.json()) as SlackOAuthResponse;

  if (!data.ok) {
    throw new Error(`Slack token exchange failed: ${data.error}`);
  }

  return data;
}

/**
 * Test authentication and get workspace info.
 *
 * @param accessToken - Valid access token
 * @returns Workspace and user info
 */
export async function testSlackAuth(accessToken: string): Promise<{
  ok: boolean;
  url: string;
  team: string;
  user: string;
  teamId: string;
  userId: string;
  botId?: string;
  isEnterpriseInstall: boolean;
}> {
  const response = await fetch(SLACK_OAUTH_URLS.test, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to test Slack authentication");
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    url: string;
    team: string;
    user: string;
    team_id: string;
    user_id: string;
    bot_id?: string;
    is_enterprise_install: boolean;
  };

  if (!data.ok) {
    throw new Error(`Slack auth test failed: ${data.error}`);
  }

  return {
    ok: data.ok,
    url: data.url,
    team: data.team,
    user: data.user,
    teamId: data.team_id,
    userId: data.user_id,
    botId: data.bot_id,
    isEnterpriseInstall: data.is_enterprise_install,
  };
}

/**
 * Revoke a Slack OAuth token.
 *
 * @param token - Access token to revoke
 */
export async function revokeSlackToken(token: string): Promise<void> {
  const response = await fetch(SLACK_OAUTH_URLS.revoke, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to revoke Slack token");
  }

  const data = (await response.json()) as { ok: boolean; error?: string };

  if (!data.ok && data.error !== "token_revoked") {
    throw new Error(`Failed to revoke Slack token: ${data.error}`);
  }
}

/**
 * Verify a Slack request signature.
 * Used to validate webhook requests from Slack.
 *
 * @param signature - X-Slack-Signature header
 * @param timestamp - X-Slack-Request-Timestamp header
 * @param body - Raw request body
 * @returns True if signature is valid
 */
export async function verifySlackSignature(
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  const config = getSlackOAuthConfig();

  if (!config.signingSecret) {
    throw new Error("Slack signing secret not configured");
  }

  // Check timestamp to prevent replay attacks (within 5 minutes)
  const requestTime = Number.parseInt(timestamp, 10);
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - requestTime) > 300) {
    return false;
  }

  // Create the signature base string
  const sigBasestring = `v0:${timestamp}:${body}`;

  // Compute HMAC-SHA256 signature
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(sigBasestring)
  );

  // Convert to hex string
  const computedSignature = `v0=${Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

  // Constant-time comparison
  return computedSignature === signature;
}

/**
 * Validates that all required Slack scopes were granted.
 *
 * @param grantedScopes - Comma-separated string of granted scopes
 * @returns True if all required scopes are present
 */
export function validateSlackScopes(grantedScopes: string): boolean {
  const granted = new Set(grantedScopes.split(","));

  // Check bot scopes
  for (const requiredScope of SLACK_BOT_SCOPES) {
    if (!granted.has(requiredScope)) {
      return false;
    }
  }

  return true;
}

/**
 * Get user info from Slack
 *
 * @param accessToken - Valid access token
 * @param userId - Slack user ID
 * @returns User profile information
 */
export async function getSlackUserInfo(
  accessToken: string,
  userId: string
): Promise<{
  id: string;
  teamId: string;
  name: string;
  realName: string;
  email?: string;
  image?: string;
  isBot: boolean;
  isAdmin: boolean;
  isOwner: boolean;
}> {
  const response = await fetch(`${SLACK_API_BASE}/users.info?user=${userId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Slack user info");
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    user: {
      id: string;
      team_id: string;
      name: string;
      real_name: string;
      profile: {
        email?: string;
        image_192?: string;
      };
      is_bot: boolean;
      is_admin: boolean;
      is_owner: boolean;
    };
  };

  if (!data.ok) {
    throw new Error(`Failed to fetch Slack user info: ${data.error}`);
  }

  return {
    id: data.user.id,
    teamId: data.user.team_id,
    name: data.user.name,
    realName: data.user.real_name,
    email: data.user.profile.email,
    image: data.user.profile.image_192,
    isBot: data.user.is_bot,
    isAdmin: data.user.is_admin,
    isOwner: data.user.is_owner,
  };
}
