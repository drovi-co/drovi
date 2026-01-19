import { env } from "@memorystack/env/server";

// =============================================================================
// GOOGLE DOCS OAUTH CONFIGURATION
// =============================================================================

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
 * Google Drive API base URL
 */
export const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/**
 * Google Docs API base URL
 */
export const GOOGLE_DOCS_API_BASE = "https://docs.googleapis.com/v1";

/**
 * Google Docs OAuth scopes.
 * These provide read-only access to documents and comments.
 */
export const GOOGLE_DOCS_SCOPES = [
  // Read-only access to Drive files (list and download)
  "https://www.googleapis.com/auth/drive.readonly",
  // Read-only access to Google Docs content
  "https://www.googleapis.com/auth/documents.readonly",
  // User email/profile for identification
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

/**
 * Google Docs OAuth configuration
 */
export interface GoogleDocsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: readonly string[];
}

/**
 * Creates Google Docs OAuth configuration from environment variables.
 * Uses the same credentials as Gmail/Google auth but with Docs-specific scopes.
 * Throws if required credentials are missing.
 */
export function getGoogleDocsOAuthConfig(): GoogleDocsOAuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!(clientId && clientSecret)) {
    throw new Error(
      "Google Docs OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables."
    );
  }

  const baseUrl = env.BETTER_AUTH_URL;
  const redirectUri = `${baseUrl}/api/oauth/google-docs/callback`;

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: GOOGLE_DOCS_SCOPES,
  };
}

/**
 * Checks if Google Docs OAuth is configured and enabled
 */
export function isGoogleDocsConfigured(): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_DOCS_ENABLED
  );
}

/**
 * Generates the Google Docs OAuth authorization URL with required parameters.
 *
 * @param state - CSRF protection token (should be cryptographically random)
 * @param options - Additional options for the authorization URL
 */
export function getGoogleDocsAuthorizationUrl(
  state: string,
  options: {
    /** Force account selection even if user is logged in */
    forceConsent?: boolean;
    /** Hint for which account to use */
    loginHint?: string;
  } = {}
): string {
  const config = getGoogleDocsOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    access_type: "offline", // Request refresh token
    prompt: options.forceConsent ? "consent" : "select_account",
  });

  if (options.loginHint) {
    params.set("login_hint", options.loginHint);
  }

  return `${GOOGLE_OAUTH_URLS.authorization}?${params.toString()}`;
}

/**
 * Google OAuth response types
 */
export interface GoogleOAuthResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

/**
 * Exchange authorization code for tokens.
 *
 * @param code - Authorization code from OAuth callback
 * @returns Google OAuth response with tokens
 */
export async function exchangeGoogleDocsCode(
  code: string
): Promise<GoogleOAuthResponse> {
  const config = getGoogleDocsOAuthConfig();

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
    const errorData = await response.text();
    throw new Error(
      `Google Docs token exchange failed: HTTP ${response.status} - ${errorData}`
    );
  }

  return (await response.json()) as GoogleOAuthResponse;
}

/**
 * Refresh an access token using a refresh token.
 *
 * @param refreshToken - Valid refresh token
 * @returns New access token response
 */
export async function refreshGoogleDocsToken(
  refreshToken: string
): Promise<GoogleOAuthResponse> {
  const config = getGoogleDocsOAuthConfig();

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
    const errorData = await response.text();
    throw new Error(
      `Google Docs token refresh failed: HTTP ${response.status} - ${errorData}`
    );
  }

  return (await response.json()) as GoogleOAuthResponse;
}

/**
 * Google user info
 */
export interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

/**
 * Test authentication and get user info.
 *
 * @param accessToken - Valid access token
 * @returns User info
 */
export async function testGoogleDocsAuth(
  accessToken: string
): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_OAUTH_URLS.userinfo, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to test Google Docs authentication");
  }

  return (await response.json()) as GoogleUserInfo;
}

/**
 * Revoke a Google OAuth token.
 *
 * @param token - Access token to revoke
 */
export async function revokeGoogleDocsToken(token: string): Promise<void> {
  const response = await fetch(
    `${GOOGLE_OAUTH_URLS.revoke}?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to revoke Google Docs token");
  }
}

// =============================================================================
// GOOGLE DRIVE API HELPERS
// =============================================================================

/**
 * Google Drive file metadata
 */
export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  starred?: boolean;
  trashed?: boolean;
  parents?: string[];
  version?: string;
  createdTime?: string;
  modifiedTime?: string;
  lastModifyingUser?: {
    displayName?: string;
    emailAddress?: string;
    photoLink?: string;
  };
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
    photoLink?: string;
  }>;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  size?: string;
  capabilities?: {
    canEdit?: boolean;
    canComment?: boolean;
    canShare?: boolean;
    canDownload?: boolean;
  };
}

/**
 * Google Drive files list response
 */
export interface GoogleDriveFilesListResponse {
  files: GoogleDriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

/**
 * List Google Docs documents.
 *
 * @param accessToken - Valid access token
 * @param options - List options
 */
export async function listGoogleDocs(
  accessToken: string,
  options: {
    pageToken?: string;
    pageSize?: number;
    orderBy?: string;
    query?: string;
  } = {}
): Promise<GoogleDriveFilesListResponse> {
  const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files`);

  // Only fetch Google Docs documents
  const mimeTypeQuery = "mimeType='application/vnd.google-apps.document'";
  const fullQuery = options.query
    ? `${mimeTypeQuery} and ${options.query}`
    : mimeTypeQuery;

  url.searchParams.set("q", fullQuery);
  url.searchParams.set(
    "fields",
    "nextPageToken,files(id,name,mimeType,description,starred,trashed,parents,version,createdTime,modifiedTime,lastModifyingUser,owners,webViewLink,iconLink,thumbnailLink,size,capabilities)"
  );
  url.searchParams.set("pageSize", String(options.pageSize ?? 100));
  url.searchParams.set("orderBy", options.orderBy ?? "modifiedTime desc");

  if (options.pageToken) {
    url.searchParams.set("pageToken", options.pageToken);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list Google Docs: HTTP ${response.status} - ${errorText}`);
  }

  return (await response.json()) as GoogleDriveFilesListResponse;
}

// =============================================================================
// GOOGLE DOCS API HELPERS
// =============================================================================

/**
 * Google Doc document structure
 */
export interface GoogleDoc {
  documentId: string;
  title: string;
  body?: {
    content: GoogleDocElement[];
  };
  headers?: Record<string, { content: GoogleDocElement[] }>;
  footers?: Record<string, { content: GoogleDocElement[] }>;
  footnotes?: Record<string, { content: GoogleDocElement[] }>;
  documentStyle?: Record<string, unknown>;
  namedStyles?: Record<string, unknown>;
  revisionId?: string;
  suggestionsViewMode?: string;
}

/**
 * Google Doc content element (simplified)
 */
export interface GoogleDocElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements: Array<{
      startIndex?: number;
      endIndex?: number;
      textRun?: {
        content: string;
        textStyle?: Record<string, unknown>;
      };
    }>;
    paragraphStyle?: Record<string, unknown>;
  };
  table?: {
    rows: number;
    columns: number;
    tableRows: Array<{
      tableCells: Array<{
        content: GoogleDocElement[];
      }>;
    }>;
  };
  sectionBreak?: Record<string, unknown>;
  tableOfContents?: { content: GoogleDocElement[] };
}

/**
 * Get a Google Doc document content.
 *
 * @param accessToken - Valid access token
 * @param documentId - Document ID
 */
export async function getGoogleDocContent(
  accessToken: string,
  documentId: string
): Promise<GoogleDoc> {
  const response = await fetch(
    `${GOOGLE_DOCS_API_BASE}/documents/${documentId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Google Doc: HTTP ${response.status} - ${errorText}`);
  }

  return (await response.json()) as GoogleDoc;
}

/**
 * Google Drive comment
 */
export interface GoogleDriveComment {
  id: string;
  author: {
    displayName: string;
    emailAddress?: string;
    photoLink?: string;
  };
  content: string;
  createdTime: string;
  modifiedTime: string;
  resolved?: boolean;
  quotedFileContent?: {
    mimeType: string;
    value: string;
  };
  anchor?: string;
  replies?: GoogleDriveReply[];
}

/**
 * Google Drive comment reply
 */
export interface GoogleDriveReply {
  id: string;
  author: {
    displayName: string;
    emailAddress?: string;
    photoLink?: string;
  };
  content: string;
  createdTime: string;
  modifiedTime: string;
  deleted?: boolean;
}

/**
 * Google Drive comments list response
 */
export interface GoogleDriveCommentsListResponse {
  comments: GoogleDriveComment[];
  nextPageToken?: string;
}

/**
 * Get comments on a Google Doc.
 *
 * @param accessToken - Valid access token
 * @param fileId - File/Document ID
 * @param options - List options
 */
export async function getGoogleDocComments(
  accessToken: string,
  fileId: string,
  options: {
    pageToken?: string;
    pageSize?: number;
    includeDeleted?: boolean;
  } = {}
): Promise<GoogleDriveCommentsListResponse> {
  const url = new URL(`${GOOGLE_DRIVE_API_BASE}/files/${fileId}/comments`);

  url.searchParams.set(
    "fields",
    "nextPageToken,comments(id,author,content,createdTime,modifiedTime,resolved,quotedFileContent,anchor,replies(id,author,content,createdTime,modifiedTime,deleted))"
  );
  url.searchParams.set("pageSize", String(options.pageSize ?? 100));
  url.searchParams.set("includeDeleted", String(options.includeDeleted ?? false));

  if (options.pageToken) {
    url.searchParams.set("pageToken", options.pageToken);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Google Doc comments: HTTP ${response.status} - ${errorText}`);
  }

  return (await response.json()) as GoogleDriveCommentsListResponse;
}

/**
 * Extract plain text from Google Doc content.
 */
export function extractTextFromGoogleDoc(doc: GoogleDoc): string {
  const textParts: string[] = [];

  function extractFromElements(elements: GoogleDocElement[]): void {
    for (const element of elements) {
      if (element.paragraph?.elements) {
        for (const paraElement of element.paragraph.elements) {
          if (paraElement.textRun?.content) {
            textParts.push(paraElement.textRun.content);
          }
        }
      }
      if (element.table?.tableRows) {
        for (const row of element.table.tableRows) {
          for (const cell of row.tableCells) {
            if (cell.content) {
              extractFromElements(cell.content);
            }
          }
        }
      }
      if (element.tableOfContents?.content) {
        extractFromElements(element.tableOfContents.content);
      }
    }
  }

  if (doc.body?.content) {
    extractFromElements(doc.body.content);
  }

  return textParts.join("").trim();
}
