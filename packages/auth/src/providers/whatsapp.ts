import { env } from "@memorystack/env/server";

// =============================================================================
// WHATSAPP BUSINESS API CONFIGURATION
// =============================================================================
//
// WhatsApp Business API uses Meta's Graph API for OAuth and message access.
// Requires a Meta Business account and WhatsApp Business app.
//
// @see https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
// @see https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow

/**
 * Required permissions for WhatsApp Business API access.
 *
 * @see https://developers.facebook.com/docs/permissions/reference
 */
export const WHATSAPP_PERMISSIONS = [
  "whatsapp_business_messaging", // Send and receive WhatsApp messages
  "whatsapp_business_management", // Manage WhatsApp Business accounts
  "business_management", // Manage business assets
] as const;

/**
 * Meta Graph API OAuth endpoints
 */
export const META_OAUTH_URLS = {
  authorization: "https://www.facebook.com/v18.0/dialog/oauth",
  token: "https://graph.facebook.com/v18.0/oauth/access_token",
  debug: "https://graph.facebook.com/debug_token",
} as const;

/**
 * WhatsApp Cloud API base URL
 */
export const WHATSAPP_API_BASE = "https://graph.facebook.com/v18.0";

/**
 * WhatsApp OAuth configuration
 */
export interface WhatsAppOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  permissions: readonly string[];
}

/**
 * Creates WhatsApp OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getWhatsAppOAuthConfig(): WhatsAppOAuthConfig {
  const appId = env.WHATSAPP_APP_ID;
  const appSecret = env.WHATSAPP_APP_SECRET;

  if (!(appId && appSecret)) {
    throw new Error(
      "WhatsApp OAuth not configured. Set WHATSAPP_APP_ID and WHATSAPP_APP_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/whatsapp/callback`;

  return {
    appId,
    appSecret,
    redirectUri,
    permissions: WHATSAPP_PERMISSIONS,
  };
}

/**
 * Checks if WhatsApp OAuth is configured
 */
export function isWhatsAppConfigured(): boolean {
  return Boolean(env.WHATSAPP_APP_ID && env.WHATSAPP_APP_SECRET);
}

/**
 * Generates the WhatsApp/Meta OAuth authorization URL.
 *
 * @param state - CSRF protection token
 */
export function getWhatsAppAuthorizationUrl(state: string): string {
  const config = getWhatsAppOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    state,
    scope: config.permissions.join(","),
    response_type: "code",
  });

  return `${META_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * Meta OAuth token response
 */
export interface MetaOAuthResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

/**
 * Exchange authorization code for access token.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Access token and expiry
 */
export async function exchangeWhatsAppCode(
  code: string
): Promise<MetaOAuthResponse> {
  const config = getWhatsAppOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(`${META_OAUTH_URLS.token}?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `WhatsApp token exchange failed: ${error.error?.message ?? response.statusText}`
    );
  }

  const data = (await response.json()) as MetaOAuthResponse;

  if (data.error) {
    throw new Error(`WhatsApp token exchange failed: ${data.error.message}`);
  }

  return data;
}

/**
 * WhatsApp Business Account info
 */
export interface WhatsAppBusinessAccount {
  id: string;
  name: string;
  timezone_id: string;
  message_template_namespace: string;
}

/**
 * Get WhatsApp Business Accounts associated with the access token.
 *
 * @param accessToken - Valid access token
 * @returns List of WhatsApp Business Accounts
 */
export async function getWhatsAppBusinessAccounts(
  accessToken: string
): Promise<WhatsAppBusinessAccount[]> {
  // First get the user's business accounts
  const businessResponse = await fetch(
    `${WHATSAPP_API_BASE}/me/businesses?access_token=${accessToken}`
  );

  if (!businessResponse.ok) {
    throw new Error("Failed to fetch business accounts");
  }

  const businessData = (await businessResponse.json()) as {
    data: Array<{ id: string; name: string }>;
    error?: { message: string };
  };

  if (businessData.error) {
    throw new Error(`Failed to fetch business accounts: ${businessData.error.message}`);
  }

  const wabaAccounts: WhatsAppBusinessAccount[] = [];

  // For each business, get WhatsApp Business Accounts
  for (const business of businessData.data) {
    const wabaResponse = await fetch(
      `${WHATSAPP_API_BASE}/${business.id}/owned_whatsapp_business_accounts?access_token=${accessToken}`
    );

    if (wabaResponse.ok) {
      const wabaData = (await wabaResponse.json()) as {
        data: WhatsAppBusinessAccount[];
      };
      wabaAccounts.push(...wabaData.data);
    }
  }

  return wabaAccounts;
}

/**
 * WhatsApp phone number info
 */
export interface WhatsAppPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  code_verification_status: string;
}

/**
 * Get phone numbers for a WhatsApp Business Account.
 *
 * @param wabaId - WhatsApp Business Account ID
 * @param accessToken - Valid access token
 * @returns List of phone numbers
 */
export async function getWhatsAppPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<WhatsAppPhoneNumber[]> {
  const response = await fetch(
    `${WHATSAPP_API_BASE}/${wabaId}/phone_numbers?access_token=${accessToken}`
  );

  if (!response.ok) {
    throw new Error("Failed to fetch WhatsApp phone numbers");
  }

  const data = (await response.json()) as {
    data: WhatsAppPhoneNumber[];
    error?: { message: string };
  };

  if (data.error) {
    throw new Error(`Failed to fetch phone numbers: ${data.error.message}`);
  }

  return data.data;
}

/**
 * WhatsApp message
 */
export interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contacts";
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  // Add other media types as needed
}

/**
 * WhatsApp conversation/thread
 */
export interface WhatsAppConversation {
  id: string;
  origin: {
    type: "business_initiated" | "user_initiated" | "referral_conversion";
  };
  expiration_timestamp?: string;
}

/**
 * Get messages from a WhatsApp conversation.
 * Note: WhatsApp Cloud API doesn't support fetching message history directly.
 * Messages are received via webhooks.
 *
 * @param phoneNumberId - Phone number ID
 * @param accessToken - Valid access token
 */
export async function getWhatsAppMessages(
  _phoneNumberId: string,
  _accessToken: string
): Promise<WhatsAppMessage[]> {
  // WhatsApp Cloud API doesn't provide a messages list endpoint
  // Messages are received via webhooks and should be stored locally
  // This function is a placeholder for the webhook-based architecture
  return [];
}

/**
 * Send a text message via WhatsApp.
 *
 * @param phoneNumberId - Sender phone number ID
 * @param to - Recipient phone number (with country code)
 * @param message - Message text
 * @param accessToken - Valid access token
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  to: string,
  message: string,
  accessToken: string
): Promise<{ messaging_product: string; messages: Array<{ id: string }> }> {
  const response = await fetch(
    `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send WhatsApp message: ${error.error?.message ?? response.statusText}`);
  }

  return response.json();
}

/**
 * Mark a message as read.
 *
 * @param phoneNumberId - Phone number ID
 * @param messageId - Message ID to mark as read
 * @param accessToken - Valid access token
 */
export async function markWhatsAppMessageRead(
  phoneNumberId: string,
  messageId: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(
    `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to mark WhatsApp message as read");
  }
}

/**
 * Verify WhatsApp webhook signature.
 *
 * @param signature - X-Hub-Signature-256 header
 * @param body - Raw request body
 * @returns True if signature is valid
 */
export async function verifyWhatsAppWebhookSignature(
  signature: string,
  body: string
): Promise<boolean> {
  const config = getWhatsAppOAuthConfig();

  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature = signature.slice(7); // Remove "sha256=" prefix

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(config.appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );

  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return computedSignature === expectedSignature;
}

/**
 * Debug/introspect an access token.
 *
 * @param accessToken - Token to debug
 * @returns Token info including expiry and permissions
 */
export async function debugWhatsAppToken(accessToken: string): Promise<{
  isValid: boolean;
  appId: string;
  userId: string;
  expiresAt?: Date;
  scopes: string[];
}> {
  const config = getWhatsAppOAuthConfig();

  const response = await fetch(
    `${META_OAUTH_URLS.debug}?input_token=${accessToken}&access_token=${config.appId}|${config.appSecret}`
  );

  if (!response.ok) {
    throw new Error("Failed to debug WhatsApp token");
  }

  const data = (await response.json()) as {
    data: {
      is_valid: boolean;
      app_id: string;
      user_id: string;
      expires_at?: number;
      scopes: string[];
    };
  };

  return {
    isValid: data.data.is_valid,
    appId: data.data.app_id,
    userId: data.data.user_id,
    expiresAt: data.data.expires_at
      ? new Date(data.data.expires_at * 1000)
      : undefined,
    scopes: data.data.scopes,
  };
}
