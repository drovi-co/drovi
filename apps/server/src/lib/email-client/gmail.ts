import {
  GMAIL_API_BASE,
  refreshGmailToken as refreshGmailOAuth,
} from "@memorystack/auth/providers";
import { log } from "../logger";
import type {
  AccountInfo,
  AttachmentData,
  AttachmentMetadata,
  DraftInput,
  DraftResult,
  EmailClient,
  EmailComposeInput,
  EmailMessageData,
  EmailRecipient,
  EmailThreadData,
  EmailThreadWithMessages,
  ListOptions,
  ListResponse,
  MessagePart,
  SendResult,
  SyncDelta,
  TokenInfo,
} from "./types";
import {
  AuthenticationError,
  NotFoundError,
  ProviderError,
  RateLimitError,
} from "./types";

// =============================================================================
// GMAIL API RESPONSE TYPES
// =============================================================================

interface GmailThread {
  id: string;
  historyId: string;
  messages?: GmailMessage[];
  snippet?: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  raw?: string;
  payload?: GmailMessagePart;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: {
    size: number;
    data?: string;
    attachmentId?: string;
  };
  parts?: GmailMessagePart[];
}

interface GmailListThreadsResponse {
  threads?: Array<{ id: string; snippet?: string; historyId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailLabel {
  id: string;
  name: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  type?: string;
}

interface GmailHistoryResponse {
  history?: Array<{
    id: string;
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
    messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
    labelsAdded?: Array<{ message: { id: string; threadId: string } }>;
    labelsRemoved?: Array<{ message: { id: string; threadId: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function parseEmailAddress(raw: string): EmailRecipient {
  // Parse "Name <email@example.com>" format
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match?.[1] && match[2]) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2] };
  }
  return { email: raw.trim() };
}

function parseEmailAddresses(raw: string): EmailRecipient[] {
  if (!raw) {
    return [];
  }
  // Split by comma, but handle quoted commas
  const addresses = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return addresses
    .map((a) => parseEmailAddress(a.trim()))
    .filter((a) => a.email);
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
    ?.value;
}

function extractBodyFromParts(
  parts: GmailMessagePart[] | undefined,
  mimeType: "text/plain" | "text/html"
): string | undefined {
  if (!parts) {
    return undefined;
  }

  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts, mimeType);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function extractAttachments(
  parts: GmailMessagePart[] | undefined
): AttachmentMetadata[] {
  const attachments: AttachmentMetadata[] = [];

  function processPartRecursive(part: GmailMessagePart, index: number) {
    const contentDisposition =
      getHeader(part.headers, "Content-Disposition") ?? "";
    const contentId = getHeader(part.headers, "Content-ID")?.replace(
      /[<>]/g,
      ""
    );
    const isInline = contentDisposition.startsWith("inline") || !!contentId;
    const isAttachment =
      contentDisposition.startsWith("attachment") || part.body?.attachmentId;

    if ((isAttachment || isInline) && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename || `attachment-${index}`,
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body.size,
        contentId,
        isInline,
      });
    }

    if (part.parts) {
      for (const [i, p] of part.parts.entries()) {
        processPartRecursive(p, i);
      }
    }
  }

  if (parts) {
    for (const [i, p] of parts.entries()) {
      processPartRecursive(p, i);
    }
  }
  return attachments;
}

function convertGmailMessagePart(part: GmailMessagePart): MessagePart {
  const headers: Record<string, string> = {};
  for (const h of part.headers ?? []) {
    headers[h.name] = h.value;
  }

  return {
    partId: part.partId ?? "",
    mimeType: part.mimeType ?? "text/plain",
    filename: part.filename,
    headers,
    body: part.body
      ? {
          size: part.body.size,
          data: part.body.data,
          attachmentId: part.body.attachmentId,
        }
      : undefined,
    parts: part.parts?.map((p) => convertGmailMessagePart(p)),
  };
}

/**
 * Format an email recipient for MIME headers
 */
function formatRecipient(recipient: EmailRecipient): string {
  if (recipient.name) {
    // Encode name if it contains special characters
    const encodedName = recipient.name.includes(",") || recipient.name.includes('"')
      ? `"${recipient.name.replace(/"/g, '\\"')}"`
      : recipient.name;
    return `${encodedName} <${recipient.email}>`;
  }
  return recipient.email;
}

/**
 * Format an array of recipients for MIME headers
 */
function formatRecipients(recipients: EmailRecipient[]): string {
  return recipients.map(formatRecipient).join(", ");
}

/**
 * Strip HTML tags for plain text fallback
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Encode filename for Content-Disposition header (RFC 2231)
 */
function encodeFilename(filename: string): string {
  // Check if filename needs encoding
  if (/^[\x20-\x7E]+$/.test(filename) && !filename.includes('"')) {
    return `"${filename}"`;
  }
  // Use RFC 2231 encoding for non-ASCII filenames
  const encoded = encodeURIComponent(filename).replace(/'/g, "%27");
  return `*=UTF-8''${encoded}`;
}

/**
 * Build an RFC 2822 MIME message for Gmail API
 * Supports attachments via multipart/mixed structure
 */
function buildMimeMessage(input: EmailComposeInput, fromEmail: string): string {
  const hasAttachments = input.attachments && input.attachments.length > 0;
  const mixedBoundary = `----=_Mixed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const altBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [];

  // Headers
  lines.push(`From: ${fromEmail}`);
  lines.push(`To: ${formatRecipients(input.to)}`);

  if (input.cc && input.cc.length > 0) {
    lines.push(`Cc: ${formatRecipients(input.cc)}`);
  }

  if (input.bcc && input.bcc.length > 0) {
    lines.push(`Bcc: ${formatRecipients(input.bcc)}`);
  }

  // Encode subject for non-ASCII characters
  const subject = input.subject;
  if (/[^\x00-\x7F]/.test(subject)) {
    lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`);
  } else {
    lines.push(`Subject: ${subject}`);
  }

  lines.push("MIME-Version: 1.0");

  // Threading headers
  if (input.inReplyTo) {
    lines.push(`In-Reply-To: ${input.inReplyTo}`);
  }

  if (input.references && input.references.length > 0) {
    lines.push(`References: ${input.references.join(" ")}`);
  }

  // Structure depends on whether we have attachments
  if (hasAttachments) {
    // multipart/mixed (top level) containing:
    //   1. multipart/alternative (body with text + HTML)
    //   2. attachment parts
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    lines.push("");

    // Body part (multipart/alternative for text + HTML)
    lines.push(`--${mixedBoundary}`);

    if (input.bodyHtml) {
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push("");

      // Plain text part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyText || stripHtml(input.bodyHtml)).toString("base64"));

      // HTML part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyHtml).toString("base64"));

      lines.push(`--${altBoundary}--`);
    } else {
      // Plain text only
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyText || "").toString("base64"));
    }

    // Attachment parts
    for (const attachment of input.attachments ?? []) {
      lines.push(`--${mixedBoundary}`);

      // Content-Type with filename
      lines.push(`Content-Type: ${attachment.mimeType}; name=${encodeFilename(attachment.filename)}`);

      // Content-Disposition
      const disposition = attachment.isInline ? "inline" : "attachment";
      lines.push(`Content-Disposition: ${disposition}; filename=${encodeFilename(attachment.filename)}`);

      // Content-ID for inline attachments
      if (attachment.contentId) {
        lines.push(`Content-ID: <${attachment.contentId}>`);
      }

      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");

      // Split base64 content into 76-character lines per RFC 2045
      const base64Content = attachment.content;
      for (let i = 0; i < base64Content.length; i += 76) {
        lines.push(base64Content.slice(i, i + 76));
      }
    }

    lines.push(`--${mixedBoundary}--`);
  } else {
    // No attachments - simple structure
    if (input.bodyHtml) {
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
      lines.push("");

      // Plain text part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyText || stripHtml(input.bodyHtml)).toString("base64"));

      // HTML part
      lines.push(`--${altBoundary}`);
      lines.push("Content-Type: text/html; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyHtml).toString("base64"));

      lines.push(`--${altBoundary}--`);
    } else {
      // Plain text only
      lines.push("Content-Type: text/plain; charset=UTF-8");
      lines.push("Content-Transfer-Encoding: base64");
      lines.push("");
      lines.push(Buffer.from(input.bodyText || "").toString("base64"));
    }
  }

  return lines.join("\r\n");
}

// =============================================================================
// GMAIL EMAIL CLIENT
// =============================================================================

export class GmailEmailClient implements EmailClient {
  readonly provider = "gmail" as const;
  private accessToken: string;
  private readonly refreshTokenValue: string;
  private tokenExpiresAt: Date;
  readonly email: string;

  constructor(
    email: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: Date
  ) {
    this.email = email;
    this.accessToken = accessToken;
    this.refreshTokenValue = refreshToken;
    this.tokenExpiresAt = expiresAt;
  }

  // ---------------------------------------------------------------------------
  // Token Management
  // ---------------------------------------------------------------------------

  needsRefresh(): boolean {
    // Refresh if token expires in less than 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    return this.tokenExpiresAt.getTime() - Date.now() < fiveMinutes;
  }

  async refreshToken(): Promise<TokenInfo> {
    try {
      const result = await refreshGmailOAuth(this.refreshTokenValue);
      this.accessToken = result.accessToken;
      this.tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
      return this.getTokenInfo();
    } catch (error) {
      throw new AuthenticationError(
        `Failed to refresh Gmail token: ${error instanceof Error ? error.message : "Unknown error"}`,
        "gmail"
      );
    }
  }

  getTokenInfo(): TokenInfo {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshTokenValue,
      expiresAt: this.tokenExpiresAt,
    };
  }

  // ---------------------------------------------------------------------------
  // API Helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (this.needsRefresh()) {
      await this.refreshToken();
    }

    const url = `${GMAIL_API_BASE}/users/me${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorData: { error?: { message?: string; code?: number } } = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        // Not JSON
      }

      if (response.status === 401) {
        throw new AuthenticationError(
          errorData.error?.message || "Authentication failed",
          "gmail"
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(
          "Gmail API rate limit exceeded",
          "gmail",
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined
        );
      }

      if (response.status === 404) {
        throw new NotFoundError(
          errorData.error?.message || "Resource not found",
          "gmail",
          "message"
        );
      }

      throw new ProviderError(
        errorData.error?.message || `Gmail API error: ${response.status}`,
        "gmail",
        errorData
      );
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Account Info
  // ---------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const profile = await this.request<{
      emailAddress: string;
      messagesTotal: number;
      threadsTotal: number;
      historyId: string;
    }>("/profile");

    return {
      id: profile.emailAddress,
      email: profile.emailAddress,
      displayName: profile.emailAddress.split("@")[0] ?? profile.emailAddress,
    };
  }

  // ---------------------------------------------------------------------------
  // Thread Operations
  // ---------------------------------------------------------------------------

  async listThreads(
    options: ListOptions = {}
  ): Promise<ListResponse<EmailThreadData>> {
    const params = new URLSearchParams();

    if (options.limit) {
      params.set("maxResults", Math.min(options.limit, 100).toString());
    }
    if (options.cursor) {
      params.set("pageToken", options.cursor);
    }
    if (options.label) {
      params.set("labelIds", options.label);
    }
    if (options.query) {
      params.set("q", options.query);
    }
    if (!options.includeSpamTrash) {
      params.set("includeSpamTrash", "false");
    }

    const endpoint = `/threads?${params.toString()}`;
    const response = await this.request<GmailListThreadsResponse>(endpoint);

    // Fetch full thread data for each thread
    const threads: EmailThreadData[] = [];
    for (const thread of response.threads ?? []) {
      const fullThread = await this.getThreadMetadata(thread.id);
      if (fullThread) {
        threads.push(fullThread);
      }
    }

    return {
      items: threads,
      nextCursor: response.nextPageToken,
      hasMore: !!response.nextPageToken,
      totalCount: response.resultSizeEstimate,
    };
  }

  private async getThreadMetadata(
    threadId: string
  ): Promise<EmailThreadData | null> {
    try {
      const thread = await this.request<GmailThread>(
        `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
      );

      const messages = thread.messages ?? [];
      const firstMessage = messages[0];
      const lastMessage = messages.at(-1);

      if (!(firstMessage && lastMessage)) {
        return null;
      }

      // Collect all participants
      const participantSet = new Set<string>();
      const participants: EmailRecipient[] = [];

      for (const msg of messages) {
        const fromHeader = getHeader(msg.payload?.headers, "From");
        const toHeader = getHeader(msg.payload?.headers, "To");

        if (fromHeader) {
          const from = parseEmailAddress(fromHeader);
          if (!participantSet.has(from.email)) {
            participantSet.add(from.email);
            participants.push(from);
          }
        }

        if (toHeader) {
          for (const to of parseEmailAddresses(toHeader)) {
            if (!participantSet.has(to.email)) {
              participantSet.add(to.email);
              participants.push(to);
            }
          }
        }
      }

      // Check labels for status
      const labels = new Set(messages.flatMap((m) => m.labelIds ?? []));

      return {
        id: thread.id,
        providerThreadId: thread.id,
        subject:
          getHeader(firstMessage.payload?.headers, "Subject") ?? "(No subject)",
        snippet: thread.snippet ?? "",
        participants,
        messageCount: messages.length,
        firstMessageAt: new Date(
          Number.parseInt(firstMessage.internalDate ?? "0", 10)
        ),
        lastMessageAt: new Date(
          Number.parseInt(lastMessage.internalDate ?? "0", 10)
        ),
        labels: Array.from(labels),
        hasAttachments: messages.some(
          (m) =>
            extractAttachments(m.payload?.parts ? [m.payload] : undefined)
              .length > 0
        ),
        isRead: !labels.has("UNREAD"),
        isStarred: labels.has("STARRED"),
        isArchived: !labels.has("INBOX"),
        isDraft: labels.has("DRAFT"),
        isTrashed: labels.has("TRASH"),
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async getThread(threadId: string): Promise<EmailThreadWithMessages | null> {
    try {
      const thread = await this.request<GmailThread>(
        `/threads/${threadId}?format=full`
      );

      const messages = thread.messages ?? [];
      if (messages.length === 0) {
        log.warn("Thread returned with 0 messages from API", { threadId });
        return null;
      }

      // Log successful fetch for debugging
      log.debug("Fetched thread with messages", { threadId, messageCount: messages.length });

      const firstMessage = messages[0];
      const lastMessage = messages.at(-1);

      if (!(firstMessage && lastMessage)) {
        return null;
      }

      // Collect all participants
      const participantSet = new Set<string>();
      const participants: EmailRecipient[] = [];
      const convertedMessages: EmailMessageData[] = [];

      for (const msg of messages) {
        const converted = this.convertMessage(msg);
        convertedMessages.push(converted);

        // Collect participants
        if (!participantSet.has(converted.from.email)) {
          participantSet.add(converted.from.email);
          participants.push(converted.from);
        }
        for (const to of converted.to) {
          if (!participantSet.has(to.email)) {
            participantSet.add(to.email);
            participants.push(to);
          }
        }
      }

      const labels = new Set(messages.flatMap((m) => m.labelIds ?? []));

      return {
        id: thread.id,
        providerThreadId: thread.id,
        subject:
          getHeader(firstMessage.payload?.headers, "Subject") ?? "(No subject)",
        snippet: thread.snippet ?? "",
        participants,
        messageCount: messages.length,
        firstMessageAt: new Date(
          Number.parseInt(firstMessage.internalDate ?? "0", 10)
        ),
        lastMessageAt: new Date(
          Number.parseInt(lastMessage.internalDate ?? "0", 10)
        ),
        labels: Array.from(labels),
        hasAttachments: convertedMessages.some((m) => m.attachments.length > 0),
        isRead: !labels.has("UNREAD"),
        isStarred: labels.has("STARRED"),
        isArchived: !labels.has("INBOX"),
        isDraft: labels.has("DRAFT"),
        isTrashed: labels.has("TRASH"),
        messages: convertedMessages,
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Message Operations
  // ---------------------------------------------------------------------------

  async getMessage(messageId: string): Promise<EmailMessageData | null> {
    try {
      const message = await this.request<GmailMessage>(
        `/messages/${messageId}?format=full`
      );
      return this.convertMessage(message);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private convertMessage(msg: GmailMessage): EmailMessageData {
    const headers = msg.payload?.headers ?? [];
    const fromHeader = getHeader(headers, "From") ?? "";
    const toHeader = getHeader(headers, "To") ?? "";
    const ccHeader = getHeader(headers, "Cc") ?? "";
    const bccHeader = getHeader(headers, "Bcc") ?? "";
    const subject = getHeader(headers, "Subject") ?? "";
    const messageIdHeader = getHeader(headers, "Message-ID");
    const inReplyTo = getHeader(headers, "In-Reply-To");
    const references = getHeader(headers, "References")
      ?.split(/\s+/)
      .filter(Boolean);

    // Extract body
    let bodyText: string | undefined;
    let bodyHtml: string | undefined;

    if (msg.payload) {
      if (msg.payload.mimeType === "text/plain" && msg.payload.body?.data) {
        bodyText = Buffer.from(msg.payload.body.data, "base64url").toString(
          "utf-8"
        );
      } else if (
        msg.payload.mimeType === "text/html" &&
        msg.payload.body?.data
      ) {
        bodyHtml = Buffer.from(msg.payload.body.data, "base64url").toString(
          "utf-8"
        );
      } else if (msg.payload.parts) {
        bodyText = extractBodyFromParts(msg.payload.parts, "text/plain");
        bodyHtml = extractBodyFromParts(msg.payload.parts, "text/html");
      }
    }

    const from = parseEmailAddress(fromHeader);
    const attachments = extractAttachments(
      msg.payload?.parts
        ? [msg.payload]
        : msg.payload?.body?.attachmentId
          ? [msg.payload]
          : undefined
    );

    return {
      id: msg.id,
      threadId: msg.threadId,
      providerMessageId: msg.id,
      subject,
      snippet: msg.snippet ?? "",
      bodyText,
      bodyHtml,
      from,
      to: parseEmailAddresses(toHeader),
      cc: parseEmailAddresses(ccHeader),
      bcc: parseEmailAddresses(bccHeader),
      sentAt: new Date(Number.parseInt(msg.internalDate ?? "0", 10)),
      messageId: messageIdHeader,
      inReplyTo,
      references,
      labels: msg.labelIds ?? [],
      sizeBytes: msg.sizeEstimate ?? 0,
      attachments,
      isFromUser: (msg.labelIds ?? []).includes("SENT"),
      rawParts: msg.payload
        ? [convertGmailMessagePart(msg.payload)]
        : undefined,
    };
  }

  async getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<AttachmentData | null> {
    try {
      // First get the message to get attachment metadata
      const message = await this.getMessage(messageId);
      if (!message) {
        return null;
      }

      const attachmentMeta = message.attachments.find(
        (a) => a.id === attachmentId
      );
      if (!attachmentMeta) {
        return null;
      }

      // Fetch attachment data
      const attachment = await this.request<{ size: number; data: string }>(
        `/messages/${messageId}/attachments/${attachmentId}`
      );

      return {
        ...attachmentMeta,
        data: Buffer.from(attachment.data, "base64url"),
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Sync Operations
  // ---------------------------------------------------------------------------

  async getChanges(cursor?: string): Promise<SyncDelta> {
    if (!cursor) {
      // No cursor means we need to do initial sync
      return {
        newCursor: await this.getInitialCursor(),
        changedThreadIds: [],
        deletedThreadIds: [],
        fullSyncRequired: true,
      };
    }

    try {
      const params = new URLSearchParams({
        startHistoryId: cursor,
      });

      const response = await this.request<GmailHistoryResponse>(
        `/history?${params.toString()}`
      );

      const changedThreadIds = new Set<string>();
      const deletedThreadIds = new Set<string>();

      for (const history of response.history ?? []) {
        // Messages added
        for (const added of history.messagesAdded ?? []) {
          changedThreadIds.add(added.message.threadId);
        }
        // Messages deleted
        for (const deleted of history.messagesDeleted ?? []) {
          deletedThreadIds.add(deleted.message.threadId);
        }
        // Labels changed
        for (const labeled of history.labelsAdded ?? []) {
          changedThreadIds.add(labeled.message.threadId);
        }
        for (const unlabeled of history.labelsRemoved ?? []) {
          changedThreadIds.add(unlabeled.message.threadId);
        }
      }

      // Remove deleted from changed
      for (const deleted of deletedThreadIds) {
        changedThreadIds.delete(deleted);
      }

      return {
        newCursor: response.historyId ?? cursor,
        changedThreadIds: Array.from(changedThreadIds),
        deletedThreadIds: Array.from(deletedThreadIds),
        fullSyncRequired: false,
      };
    } catch (error) {
      // If history ID is too old, Gmail returns 404
      if (error instanceof NotFoundError) {
        return {
          newCursor: await this.getInitialCursor(),
          changedThreadIds: [],
          deletedThreadIds: [],
          fullSyncRequired: true,
        };
      }
      throw error;
    }
  }

  async getInitialCursor(): Promise<string> {
    const profile = await this.request<{
      emailAddress: string;
      historyId: string;
    }>("/profile");
    return profile.historyId;
  }

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  async listLabels(): Promise<
    Array<{ id: string; name: string; type: string }>
  > {
    const response = await this.request<{ labels: GmailLabel[] }>("/labels");

    return (response.labels ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type ?? "user",
    }));
  }

  // ---------------------------------------------------------------------------
  // Watch API - Real-time Push Notifications
  // ---------------------------------------------------------------------------

  /**
   * Set up a watch on the user's mailbox to receive push notifications.
   *
   * Gmail will send notifications to the specified Pub/Sub topic when changes occur.
   * Watch expires after 7 days and must be renewed.
   *
   * @param topicName - Full Pub/Sub topic name (e.g., "projects/my-project/topics/gmail-notifications")
   * @param labelIds - Optional array of label IDs to watch (default: INBOX)
   * @returns Watch details including expiration and historyId
   */
  async setupWatch(
    topicName: string,
    labelIds: string[] = ["INBOX"]
  ): Promise<{
    historyId: string;
    expiration: string; // Unix timestamp in milliseconds
  }> {
    const response = await this.request<{
      historyId: string;
      expiration: string;
    }>("/watch", {
      method: "POST",
      body: JSON.stringify({
        topicName,
        labelIds,
        labelFilterBehavior: "include",
      }),
    });

    return {
      historyId: response.historyId,
      expiration: response.expiration,
    };
  }

  /**
   * Stop receiving push notifications for this mailbox.
   * Call this when disconnecting an account.
   */
  async stopWatch(): Promise<void> {
    await this.request("/stop", {
      method: "POST",
    });
  }

  // ---------------------------------------------------------------------------
  // Compose Operations
  // ---------------------------------------------------------------------------

  /**
   * Send an email message via Gmail API
   */
  async sendMessage(input: EmailComposeInput): Promise<SendResult> {
    const mimeMessage = buildMimeMessage(input, this.email);
    const raw = Buffer.from(mimeMessage).toString("base64url");

    const body: { raw: string; threadId?: string } = { raw };
    if (input.threadId) {
      body.threadId = input.threadId;
    }

    const response = await this.request<{
      id: string;
      threadId: string;
      labelIds: string[];
    }>("/messages/send", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      messageId: response.id,
      threadId: response.threadId,
      sentAt: new Date(),
    };
  }

  /**
   * Create a draft email in Gmail
   */
  async createDraft(input: DraftInput): Promise<DraftResult> {
    const mimeMessage = buildMimeMessage(input, this.email);
    const raw = Buffer.from(mimeMessage).toString("base64url");

    const messageBody: { raw: string; threadId?: string } = { raw };
    if (input.threadId) {
      messageBody.threadId = input.threadId;
    }

    const response = await this.request<{
      id: string;
      message: {
        id: string;
        threadId?: string;
        labelIds?: string[];
      };
    }>("/drafts", {
      method: "POST",
      body: JSON.stringify({ message: messageBody }),
    });

    return {
      draftId: response.id,
      messageId: response.message.id,
      threadId: response.message.threadId,
    };
  }

  /**
   * Update an existing draft in Gmail
   */
  async updateDraft(draftId: string, input: DraftInput): Promise<DraftResult> {
    const mimeMessage = buildMimeMessage(input, this.email);
    const raw = Buffer.from(mimeMessage).toString("base64url");

    const response = await this.request<{
      id: string;
      message: {
        id: string;
        threadId?: string;
        labelIds?: string[];
      };
    }>(`/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({ message: { raw } }),
    });

    return {
      draftId: response.id,
      messageId: response.message.id,
      threadId: response.message.threadId,
    };
  }

  /**
   * Delete a draft from Gmail
   */
  async deleteDraft(draftId: string): Promise<void> {
    await this.request(`/drafts/${draftId}`, {
      method: "DELETE",
    });
  }

  /**
   * Get a draft by ID from Gmail
   */
  async getDraft(draftId: string): Promise<EmailMessageData | null> {
    try {
      const response = await this.request<{
        id: string;
        message: GmailMessage;
      }>(`/drafts/${draftId}?format=full`);

      return this.convertMessage(response.message);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }
}
