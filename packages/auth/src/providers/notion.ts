import { env } from "@memorystack/env/server";

// =============================================================================
// NOTION OAUTH CONFIGURATION
// =============================================================================

/**
 * Notion OAuth 2.0 endpoints
 */
export const NOTION_OAUTH_URLS = {
  authorization: "https://api.notion.com/v1/oauth/authorize",
  token: "https://api.notion.com/v1/oauth/token",
} as const;

/**
 * Notion API base URL
 */
export const NOTION_API_BASE = "https://api.notion.com/v1";

/**
 * Notion API version header (required for all requests)
 */
export const NOTION_API_VERSION = "2022-06-28";

/**
 * Notion OAuth configuration
 */
export interface NotionOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Creates Notion OAuth configuration from environment variables.
 * Throws if required credentials are missing.
 */
export function getNotionOAuthConfig(): NotionOAuthConfig {
  const clientId = env.NOTION_CLIENT_ID;
  const clientSecret = env.NOTION_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Notion OAuth not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri =
    env.NOTION_REDIRECT_URI ?? `${baseUrl}/api/oauth/notion/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
}

/**
 * Checks if Notion OAuth is configured
 */
export function isNotionConfigured(): boolean {
  return Boolean(env.NOTION_CLIENT_ID && env.NOTION_CLIENT_SECRET);
}

/**
 * Generates the Notion OAuth authorization URL with required parameters.
 *
 * @param state - CSRF protection token (should be cryptographically random)
 * @param options - Additional options for the authorization URL
 */
export function getNotionAuthorizationUrl(
  state: string,
  _options: {
    /** Request access to a specific workspace */
    workspaceId?: string;
  } = {}
): string {
  const config = getNotionOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    owner: "user", // Request access on behalf of the user
    state,
  });

  return `${NOTION_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * Notion OAuth response types
 */
export interface NotionOAuthResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  owner: {
    type: "user" | "workspace";
    user?: {
      id: string;
      name?: string;
      avatar_url?: string;
      type: "person" | "bot";
      person?: {
        email: string;
      };
    };
  };
  duplicated_template_id?: string;
  request_id: string;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Notion OAuth response with tokens
 */
export async function exchangeNotionCode(
  code: string
): Promise<NotionOAuthResponse> {
  const config = getNotionOAuthConfig();

  // Notion requires Basic auth with client_id:client_secret
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString("base64");

  const response = await fetch(NOTION_OAUTH_URLS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(
      `Notion token exchange failed: HTTP ${response.status} - ${errorData}`
    );
  }

  const data = (await response.json()) as NotionOAuthResponse;

  return data;
}

/**
 * Notion user info from /users/me endpoint
 */
export interface NotionUser {
  id: string;
  type: "person" | "bot";
  name?: string;
  avatar_url?: string;
  person?: {
    email: string;
  };
  bot?: {
    owner: {
      type: "user" | "workspace";
      workspace?: boolean;
      user?: {
        id: string;
        type: "person";
        name?: string;
        avatar_url?: string;
        person?: {
          email: string;
        };
      };
    };
    workspace_name?: string;
  };
}

/**
 * Test authentication and get user info.
 *
 * @param accessToken - Valid access token
 * @returns User info
 */
export async function testNotionAuth(accessToken: string): Promise<NotionUser> {
  const response = await fetch(`${NOTION_API_BASE}/users/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to test Notion authentication");
  }

  const data = (await response.json()) as NotionUser;

  return data;
}

/**
 * Revoke a Notion OAuth token.
 * Note: Notion doesn't have a revoke endpoint - users must disconnect from Notion settings.
 *
 * @param token - Access token (unused, kept for interface consistency)
 */
export async function revokeNotionToken(_token: string): Promise<void> {
  // Notion doesn't support programmatic token revocation
  // Users must disconnect from their Notion integration settings
  // https://www.notion.so/my-integrations
  return;
}

// =============================================================================
// NOTION API HELPERS
// =============================================================================

/**
 * Notion page object
 */
export interface NotionPage {
  id: string;
  object: "page";
  created_time: string;
  last_edited_time: string;
  created_by: { id: string; object: "user" };
  last_edited_by: { id: string; object: "user" };
  parent:
    | { type: "workspace"; workspace: true }
    | { type: "page_id"; page_id: string }
    | { type: "database_id"; database_id: string };
  archived: boolean;
  in_trash: boolean;
  icon?: {
    type: "emoji" | "external" | "file";
    emoji?: string;
    external?: { url: string };
    file?: { url: string; expiry_time: string };
  };
  cover?: {
    type: "external" | "file";
    external?: { url: string };
    file?: { url: string; expiry_time: string };
  };
  properties: Record<string, NotionPropertyValue>;
  url: string;
  public_url?: string;
}

/**
 * Notion property value types (simplified)
 */
export type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "number"; number: number | null }
  | { type: "select"; select: { name: string; color?: string } | null }
  | {
      type: "multi_select";
      multi_select: Array<{ name: string; color?: string }>;
    }
  | { type: "date"; date: { start: string; end?: string } | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "url"; url: string | null }
  | { type: "email"; email: string | null }
  | { type: "phone_number"; phone_number: string | null }
  | { type: "created_time"; created_time: string }
  | { type: "last_edited_time"; last_edited_time: string }
  | { type: "created_by"; created_by: { id: string } }
  | { type: "last_edited_by"; last_edited_by: { id: string } }
  | { type: "people"; people: Array<{ id: string }> }
  | { type: "files"; files: Array<{ name: string; type: string }> }
  | { type: "relation"; relation: Array<{ id: string }> }
  | {
      type: "formula";
      formula: {
        type: string;
        string?: string;
        number?: number;
        boolean?: boolean;
        date?: { start: string };
      };
    }
  | {
      type: "rollup";
      rollup: { type: string; number?: number; array?: NotionPropertyValue[] };
    }
  | { type: "status"; status: { name: string; color?: string } | null };

/**
 * Notion database object
 */
export interface NotionDatabase {
  id: string;
  object: "database";
  created_time: string;
  last_edited_time: string;
  title: Array<{ plain_text: string }>;
  description: Array<{ plain_text: string }>;
  icon?: NotionPage["icon"];
  cover?: NotionPage["cover"];
  parent:
    | { type: "workspace"; workspace: true }
    | { type: "page_id"; page_id: string };
  url: string;
  public_url?: string;
  archived: boolean;
  in_trash: boolean;
  properties: Record<string, NotionDatabaseProperty>;
}

/**
 * Notion database property schema
 */
export interface NotionDatabaseProperty {
  id: string;
  name: string;
  type: string;
  // Type-specific configuration
  [key: string]: unknown;
}

/**
 * Notion block object
 */
export interface NotionBlock {
  id: string;
  object: "block";
  type: string;
  created_time: string;
  last_edited_time: string;
  created_by: { id: string; object: "user" };
  last_edited_by: { id: string; object: "user" };
  has_children: boolean;
  archived: boolean;
  in_trash: boolean;
  parent:
    | { type: "page_id"; page_id: string }
    | { type: "block_id"; block_id: string };
  // Block-specific content
  [key: string]: unknown;
}

/**
 * Notion comment object
 */
export interface NotionComment {
  id: string;
  object: "comment";
  parent:
    | { type: "page_id"; page_id: string }
    | { type: "block_id"; block_id: string };
  discussion_id: string;
  created_time: string;
  last_edited_time: string;
  created_by: { id: string; object: "user" };
  rich_text: Array<{
    type: string;
    plain_text: string;
    annotations?: {
      bold?: boolean;
      italic?: boolean;
      strikethrough?: boolean;
      underline?: boolean;
      code?: boolean;
    };
  }>;
}

/**
 * Notion search response
 */
export interface NotionSearchResponse {
  object: "list";
  results: Array<NotionPage | NotionDatabase>;
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Search Notion workspace for pages and databases.
 *
 * @param accessToken - Valid access token
 * @param options - Search options
 */
export async function searchNotion(
  accessToken: string,
  options: {
    query?: string;
    filter?: { property: "object"; value: "page" | "database" };
    sort?: {
      direction: "ascending" | "descending";
      timestamp: "last_edited_time";
    };
    startCursor?: string;
    pageSize?: number;
  } = {}
): Promise<NotionSearchResponse> {
  const response = await fetch(`${NOTION_API_BASE}/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: options.query,
      filter: options.filter,
      sort: options.sort,
      start_cursor: options.startCursor,
      page_size: options.pageSize ?? 100,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion search failed: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as NotionSearchResponse;
}

/**
 * Get a Notion page by ID.
 *
 * @param accessToken - Valid access token
 * @param pageId - Page ID
 */
export async function getNotionPage(
  accessToken: string,
  pageId: string
): Promise<NotionPage> {
  const response = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Notion page: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as NotionPage;
}

/**
 * Get blocks (content) of a Notion page.
 *
 * @param accessToken - Valid access token
 * @param blockId - Page ID or block ID to get children of
 * @param startCursor - Pagination cursor
 */
export async function getNotionBlocks(
  accessToken: string,
  blockId: string,
  startCursor?: string
): Promise<{
  results: NotionBlock[];
  next_cursor: string | null;
  has_more: boolean;
}> {
  const url = new URL(`${NOTION_API_BASE}/blocks/${blockId}/children`);
  if (startCursor) {
    url.searchParams.set("start_cursor", startCursor);
  }
  url.searchParams.set("page_size", "100");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Notion blocks: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as {
    results: NotionBlock[];
    next_cursor: string | null;
    has_more: boolean;
  };
}

/**
 * Get comments on a Notion page or block.
 *
 * @param accessToken - Valid access token
 * @param blockId - Page ID or block ID
 * @param startCursor - Pagination cursor
 */
export async function getNotionComments(
  accessToken: string,
  blockId: string,
  startCursor?: string
): Promise<{
  results: NotionComment[];
  next_cursor: string | null;
  has_more: boolean;
}> {
  const url = new URL(`${NOTION_API_BASE}/comments`);
  url.searchParams.set("block_id", blockId);
  if (startCursor) {
    url.searchParams.set("start_cursor", startCursor);
  }
  url.searchParams.set("page_size", "100");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Notion comments: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as {
    results: NotionComment[];
    next_cursor: string | null;
    has_more: boolean;
  };
}

/**
 * Query a Notion database.
 *
 * @param accessToken - Valid access token
 * @param databaseId - Database ID
 * @param options - Query options
 */
export async function queryNotionDatabase(
  accessToken: string,
  databaseId: string,
  options: {
    filter?: Record<string, unknown>;
    sorts?: Array<{
      property?: string;
      timestamp?: string;
      direction: "ascending" | "descending";
    }>;
    startCursor?: string;
    pageSize?: number;
  } = {}
): Promise<{
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}> {
  const response = await fetch(
    `${NOTION_API_BASE}/databases/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: options.filter,
        sorts: options.sorts,
        start_cursor: options.startCursor,
        page_size: options.pageSize ?? 100,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to query Notion database: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as {
    results: NotionPage[];
    next_cursor: string | null;
    has_more: boolean;
  };
}

/**
 * Get a Notion user by ID.
 *
 * @param accessToken - Valid access token
 * @param userId - User ID
 */
export async function getNotionUser(
  accessToken: string,
  userId: string
): Promise<NotionUser> {
  const response = await fetch(`${NOTION_API_BASE}/users/${userId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to get Notion user: HTTP ${response.status} - ${errorText}`
    );
  }

  return (await response.json()) as NotionUser;
}

/**
 * Extract plain text from Notion page title property.
 */
export function getNotionPageTitle(page: NotionPage): string {
  for (const [_, value] of Object.entries(page.properties)) {
    if (value.type === "title") {
      return value.title.map((t) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

/**
 * Extract plain text from Notion blocks.
 */
export function extractTextFromBlocks(blocks: NotionBlock[]): string {
  const textParts: string[] = [];

  for (const block of blocks) {
    // Extract text from common block types
    const blockData = block[block.type] as Record<string, unknown> | undefined;
    if (blockData && "rich_text" in blockData) {
      const richText = blockData.rich_text as Array<{ plain_text: string }>;
      const text = richText.map((t) => t.plain_text).join("");
      if (text) {
        textParts.push(text);
      }
    }
  }

  return textParts.join("\n");
}
