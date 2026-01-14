// =============================================================================
// EMAIL CLIENT ABSTRACTION - TYPE DEFINITIONS
// =============================================================================

/**
 * Supported email providers
 */
export type EmailProvider = "gmail" | "outlook";

/**
 * Email recipient with optional display name
 */
export interface EmailRecipient {
  email: string;
  name?: string;
}

/**
 * Message part for multipart MIME handling
 */
export interface MessagePart {
  partId: string;
  mimeType: string;
  filename?: string;
  headers: Record<string, string>;
  body?: {
    size: number;
    data?: string; // Base64 encoded
    attachmentId?: string;
  };
  parts?: MessagePart[];
}

/**
 * Attachment metadata (without binary content)
 */
export interface AttachmentMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
}

/**
 * Attachment data with content
 */
export type AttachmentData = AttachmentMetadata & {
  data: Buffer;
};

/**
 * Email message representation
 */
export interface EmailMessageData {
  id: string;
  threadId: string;
  /** Provider-specific message ID */
  providerMessageId: string;
  /** Subject line */
  subject: string;
  /** Short snippet/preview */
  snippet: string;
  /** Plain text body */
  bodyText?: string;
  /** HTML body */
  bodyHtml?: string;
  /** Sender */
  from: EmailRecipient;
  /** To recipients */
  to: EmailRecipient[];
  /** CC recipients */
  cc: EmailRecipient[];
  /** BCC recipients (if available) */
  bcc: EmailRecipient[];
  /** When the message was sent */
  sentAt: Date;
  /** When the message was received (if available) */
  receivedAt?: Date;
  /** Message-ID header for threading */
  messageId?: string;
  /** In-Reply-To header */
  inReplyTo?: string;
  /** References header (array of message IDs) */
  references?: string[];
  /** Labels/folder IDs */
  labels: string[];
  /** Size in bytes */
  sizeBytes: number;
  /** Attachment metadata */
  attachments: AttachmentMetadata[];
  /** Full headers (optional, for detailed analysis) */
  headers?: Record<string, string>;
  /** Whether this message is from the authenticated user */
  isFromUser: boolean;
  /** Raw message parts for detailed parsing */
  rawParts?: MessagePart[];
}

/**
 * Email thread representation
 */
export interface EmailThreadData {
  id: string;
  /** Provider-specific thread ID */
  providerThreadId: string;
  /** Thread subject (from first message) */
  subject: string;
  /** Thread snippet (from most recent message) */
  snippet: string;
  /** All participants in the thread */
  participants: EmailRecipient[];
  /** Number of messages in the thread */
  messageCount: number;
  /** First message timestamp */
  firstMessageAt: Date;
  /** Last message timestamp */
  lastMessageAt: Date;
  /** Labels/folders applied to the thread */
  labels: string[];
  /** Whether the thread has any attachments */
  hasAttachments: boolean;
  /** Whether the thread is read */
  isRead: boolean;
  /** Whether the thread is starred/flagged */
  isStarred: boolean;
  /** Whether the thread is archived */
  isArchived: boolean;
  /** Whether the thread is a draft */
  isDraft: boolean;
  /** Whether the thread is in trash */
  isTrashed: boolean;
}

/**
 * Thread with full messages
 */
export type EmailThreadWithMessages = EmailThreadData & {
  messages: EmailMessageData[];
};

/**
 * List options for pagination and filtering
 */
export interface ListOptions {
  /** Maximum number of items to return */
  limit?: number;
  /** Pagination cursor/token */
  cursor?: string;
  /** Filter by label/folder */
  label?: string;
  /** Search query */
  query?: string;
  /** Only include messages after this date */
  after?: Date;
  /** Only include messages before this date */
  before?: Date;
  /** Include spam/trash */
  includeSpamTrash?: boolean;
}

/**
 * Paginated list response
 */
export interface ListResponse<T> {
  items: T[];
  /** Cursor for next page, undefined if no more pages */
  nextCursor?: string;
  /** Total count (if available) */
  totalCount?: number;
  /** Whether there are more items */
  hasMore: boolean;
}

/**
 * Account info from the provider
 */
export interface AccountInfo {
  id: string;
  email: string;
  displayName: string;
  picture?: string;
}

/**
 * Token info for refresh checking
 */
export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Sync delta for incremental sync
 */
export interface SyncDelta {
  /** New cursor position */
  newCursor: string;
  /** Thread IDs that were added or modified */
  changedThreadIds: string[];
  /** Thread IDs that were deleted */
  deletedThreadIds: string[];
  /** Whether the delta was truncated (full sync needed) */
  fullSyncRequired: boolean;
}

// =============================================================================
// COMPOSE INPUT TYPES
// =============================================================================

/**
 * Attachment for composing/sending an email
 */
export interface ComposeAttachment {
  /** Original filename */
  filename: string;
  /** MIME type (e.g., "application/pdf", "image/png") */
  mimeType: string;
  /** Size in bytes */
  size: number;
  /** Base64-encoded file content */
  content: string;
  /** Optional content ID for inline attachments */
  contentId?: string;
  /** Whether this is an inline attachment (embedded in HTML) */
  isInline?: boolean;
}

/**
 * Input for composing/sending an email
 */
export interface EmailComposeInput {
  /** Recipients */
  to: EmailRecipient[];
  /** CC recipients */
  cc?: EmailRecipient[];
  /** BCC recipients */
  bcc?: EmailRecipient[];
  /** Email subject */
  subject: string;
  /** Plain text body */
  bodyText?: string;
  /** HTML body */
  bodyHtml?: string;
  /** Message-ID header for threading (In-Reply-To) */
  inReplyTo?: string;
  /** Reference message IDs for threading */
  references?: string[];
  /** Provider thread ID for replies */
  threadId?: string;
  /** File attachments */
  attachments?: ComposeAttachment[];
}

/**
 * Input for creating/updating a draft
 */
export interface DraftInput extends EmailComposeInput {
  /** Existing draft ID (for updates) */
  draftId?: string;
}

/**
 * Result of sending an email
 */
export interface SendResult {
  /** Provider message ID */
  messageId: string;
  /** Provider thread ID */
  threadId: string;
  /** Timestamp when sent */
  sentAt: Date;
}

/**
 * Result of creating/updating a draft
 */
export interface DraftResult {
  /** Provider draft ID */
  draftId: string;
  /** Provider message ID */
  messageId: string;
  /** Provider thread ID (if part of a thread) */
  threadId?: string;
}

// =============================================================================
// EMAIL CLIENT INTERFACE
// =============================================================================

/**
 * Unified email client interface for provider-agnostic operations.
 * Implementations must handle provider-specific API calls and normalize
 * responses to these standard types.
 */
export interface EmailClient {
  /** The email provider type */
  readonly provider: EmailProvider;

  /** The email address of the connected account */
  readonly email: string;

  // ---------------------------------------------------------------------------
  // Token Management
  // ---------------------------------------------------------------------------

  /**
   * Check if the access token needs to be refreshed.
   * @returns True if token is expired or will expire within 5 minutes
   */
  needsRefresh(): boolean;

  /**
   * Refresh the access token using the refresh token.
   * Updates internal token state.
   * @returns Updated token info
   * @throws AuthenticationError if refresh fails
   */
  refreshToken(): Promise<TokenInfo>;

  /**
   * Get current token info
   */
  getTokenInfo(): TokenInfo;

  // ---------------------------------------------------------------------------
  // Account Info
  // ---------------------------------------------------------------------------

  /**
   * Get profile information for the connected account
   */
  getAccountInfo(): Promise<AccountInfo>;

  // ---------------------------------------------------------------------------
  // Thread Operations
  // ---------------------------------------------------------------------------

  /**
   * List email threads with pagination and filtering
   * @param options - Pagination and filter options
   * @returns Paginated list of threads
   */
  listThreads(options?: ListOptions): Promise<ListResponse<EmailThreadData>>;

  /**
   * Get a single thread with all messages
   * @param threadId - Provider-specific thread ID
   * @returns Thread with messages, or null if not found
   */
  getThread(threadId: string): Promise<EmailThreadWithMessages | null>;

  // ---------------------------------------------------------------------------
  // Message Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a single message by ID
   * @param messageId - Provider-specific message ID
   * @returns Message data, or null if not found
   */
  getMessage(messageId: string): Promise<EmailMessageData | null>;

  /**
   * Get attachment data
   * @param messageId - Provider-specific message ID
   * @param attachmentId - Provider-specific attachment ID
   * @returns Attachment with binary data
   */
  getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<AttachmentData | null>;

  // ---------------------------------------------------------------------------
  // Sync Operations
  // ---------------------------------------------------------------------------

  /**
   * Get changes since last sync (incremental sync)
   * @param cursor - Sync cursor from previous sync, or undefined for initial sync
   * @returns Delta containing changed and deleted thread IDs
   */
  getChanges(cursor?: string): Promise<SyncDelta>;

  /**
   * Get initial sync cursor (for starting incremental sync)
   * @returns Current sync position cursor
   */
  getInitialCursor(): Promise<string>;

  // ---------------------------------------------------------------------------
  // Labels/Folders
  // ---------------------------------------------------------------------------

  /**
   * List available labels/folders
   * @returns Array of label objects with id and name
   */
  listLabels(): Promise<Array<{ id: string; name: string; type: string }>>;

  // ---------------------------------------------------------------------------
  // Compose Operations
  // ---------------------------------------------------------------------------

  /**
   * Send an email message
   * @param input - Email compose input
   * @returns Send result with message ID and thread ID
   */
  sendMessage(input: EmailComposeInput): Promise<SendResult>;

  /**
   * Create a draft email
   * @param input - Draft input
   * @returns Draft result with draft ID
   */
  createDraft(input: DraftInput): Promise<DraftResult>;

  /**
   * Update an existing draft
   * @param draftId - Provider draft ID
   * @param input - Updated draft input
   * @returns Updated draft result
   */
  updateDraft(draftId: string, input: DraftInput): Promise<DraftResult>;

  /**
   * Delete a draft
   * @param draftId - Provider draft ID
   */
  deleteDraft(draftId: string): Promise<void>;

  /**
   * Get a draft by ID
   * @param draftId - Provider draft ID
   * @returns Draft message data, or null if not found
   */
  getDraft(draftId: string): Promise<EmailMessageData | null>;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Base error class for email client errors
 */
export class EmailClientError extends Error {
  readonly provider: EmailProvider;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    provider: EmailProvider,
    code: string,
    retryable = false
  ) {
    super(message);
    this.name = "EmailClientError";
    this.provider = provider;
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Authentication/authorization error
 */
export class AuthenticationError extends EmailClientError {
  constructor(message: string, provider: EmailProvider) {
    super(message, provider, "AUTHENTICATION_ERROR", false);
    this.name = "AuthenticationError";
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends EmailClientError {
  readonly retryAfter?: number;

  constructor(message: string, provider: EmailProvider, retryAfter?: number) {
    super(message, provider, "RATE_LIMIT_ERROR", true);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends EmailClientError {
  readonly resourceType: "thread" | "message" | "attachment" | "label";

  constructor(
    message: string,
    provider: EmailProvider,
    resourceType: "thread" | "message" | "attachment" | "label"
  ) {
    super(message, provider, "NOT_FOUND_ERROR", false);
    this.name = "NotFoundError";
    this.resourceType = resourceType;
  }
}

/**
 * Provider-specific error (catch-all)
 */
export class ProviderError extends EmailClientError {
  readonly originalError?: unknown;

  constructor(
    message: string,
    provider: EmailProvider,
    originalError?: unknown
  ) {
    super(message, provider, "PROVIDER_ERROR", true);
    this.name = "ProviderError";
    this.originalError = originalError;
  }
}
