import {
  GRAPH_API_BASE,
  refreshOutlookToken as refreshOutlookOAuth,
} from "@memorystack/auth/providers";
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
// MICROSOFT GRAPH API RESPONSE TYPES
// =============================================================================

interface GraphUser {
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName: string;
}

interface GraphEmailAddress {
  address: string;
  name?: string;
}

interface GraphRecipient {
  emailAddress: GraphEmailAddress;
}

interface GraphItemBody {
  contentType: "text" | "html";
  content: string;
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId?: string;
  contentBytes?: string;
}

interface GraphMessage {
  id: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body?: GraphItemBody;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  sentDateTime?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus: string };
  hasAttachments?: boolean;
  internetMessageId?: string;
  parentFolderId?: string;
  categories?: string[];
  attachments?: GraphAttachment[];
}

interface GraphMessageListResponse {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
  "@odata.count"?: number;
}

interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function convertGraphRecipient(
  recipient?: GraphRecipient
): EmailRecipient | undefined {
  if (!recipient?.emailAddress) {
    return undefined;
  }
  return {
    email: recipient.emailAddress.address,
    name: recipient.emailAddress.name,
  };
}

function convertGraphRecipients(
  recipients?: GraphRecipient[]
): EmailRecipient[] {
  return (recipients ?? [])
    .map((r) => convertGraphRecipient(r))
    .filter((r): r is EmailRecipient => r !== undefined);
}

function extractNextCursor(nextLink?: string): string | undefined {
  if (!nextLink) {
    return undefined;
  }
  // Extract $skiptoken from the URL
  const url = new URL(nextLink);
  const skipToken = url.searchParams.get("$skiptoken");
  if (skipToken) {
    return skipToken;
  }
  // For delta links, return the full link
  if (nextLink.includes("delta")) {
    return nextLink;
  }
  return nextLink;
}

/**
 * Convert EmailRecipient to Graph API recipient format
 */
function toGraphRecipient(recipient: EmailRecipient): GraphRecipient {
  return {
    emailAddress: {
      address: recipient.email,
      name: recipient.name,
    },
  };
}

/**
 * Convert EmailRecipient array to Graph API recipient array
 */
function toGraphRecipients(recipients?: EmailRecipient[]): GraphRecipient[] {
  return (recipients ?? []).map(toGraphRecipient);
}

// =============================================================================
// OUTLOOK EMAIL CLIENT
// =============================================================================

export class OutlookEmailClient implements EmailClient {
  readonly provider = "outlook" as const;
  private accessToken: string;
  private refreshTokenValue: string;
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
    const fiveMinutes = 5 * 60 * 1000;
    return this.tokenExpiresAt.getTime() - Date.now() < fiveMinutes;
  }

  async refreshToken(): Promise<TokenInfo> {
    try {
      const result = await refreshOutlookOAuth(this.refreshTokenValue);
      this.accessToken = result.accessToken;
      this.refreshTokenValue = result.refreshToken;
      this.tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000);
      return this.getTokenInfo();
    } catch (error) {
      throw new AuthenticationError(
        `Failed to refresh Outlook token: ${error instanceof Error ? error.message : "Unknown error"}`,
        "outlook"
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

    const url = endpoint.startsWith("http")
      ? endpoint
      : `${GRAPH_API_BASE}${endpoint}`;

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
      let errorData: { error?: { message?: string; code?: string } } = {};
      try {
        errorData = JSON.parse(errorBody);
      } catch {
        // Not JSON
      }

      if (response.status === 401) {
        throw new AuthenticationError(
          errorData.error?.message || "Authentication failed",
          "outlook"
        );
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(
          "Microsoft Graph API rate limit exceeded",
          "outlook",
          retryAfter ? Number.parseInt(retryAfter, 10) : undefined
        );
      }

      if (response.status === 404) {
        throw new NotFoundError(
          errorData.error?.message || "Resource not found",
          "outlook",
          "message"
        );
      }

      throw new ProviderError(
        errorData.error?.message || `Graph API error: ${response.status}`,
        "outlook",
        errorData
      );
    }

    return (await response.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Account Info
  // ---------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const user = await this.request<GraphUser>("/me");

    return {
      id: user.id,
      email: user.mail || user.userPrincipalName,
      displayName: user.displayName,
    };
  }

  // ---------------------------------------------------------------------------
  // Thread Operations
  // ---------------------------------------------------------------------------

  async listThreads(
    options: ListOptions = {}
  ): Promise<ListResponse<EmailThreadData>> {
    // Outlook doesn't have a native thread concept, so we group by conversationId
    // We first get messages, then group them by conversation

    const params = new URLSearchParams();
    const top = Math.min(options.limit ?? 25, 100);
    params.set("$top", top.toString());
    params.set("$orderby", "receivedDateTime desc");
    params.set(
      "$select",
      "id,conversationId,subject,bodyPreview,from,receivedDateTime,isRead,isDraft,flag,hasAttachments,parentFolderId"
    );

    if (options.cursor) {
      params.set("$skiptoken", options.cursor);
    }

    if (options.query) {
      params.set("$search", `"${options.query}"`);
    }

    let endpoint = `/me/messages?${params.toString()}`;

    // Filter by folder if label specified
    if (options.label) {
      endpoint = `/me/mailFolders/${options.label}/messages?${params.toString()}`;
    }

    const response = await this.request<GraphMessageListResponse>(endpoint);

    // Group messages by conversationId
    const conversationMap = new Map<string, GraphMessage[]>();
    for (const msg of response.value) {
      const existing = conversationMap.get(msg.conversationId) ?? [];
      existing.push(msg);
      conversationMap.set(msg.conversationId, existing);
    }

    // Convert to threads
    const threads: EmailThreadData[] = [];
    for (const [conversationId, messages] of conversationMap) {
      const firstMsg = messages.at(-1); // Oldest
      const lastMsg = messages[0]; // Newest

      if (!(firstMsg && lastMsg)) {
        continue;
      }

      const participants: EmailRecipient[] = [];
      const participantSet = new Set<string>();

      for (const msg of messages) {
        const from = convertGraphRecipient(msg.from);
        if (from && !participantSet.has(from.email)) {
          participantSet.add(from.email);
          participants.push(from);
        }
        for (const to of convertGraphRecipients(msg.toRecipients)) {
          if (!participantSet.has(to.email)) {
            participantSet.add(to.email);
            participants.push(to);
          }
        }
      }

      // Determine folder-based status
      const isArchived =
        lastMsg.parentFolderId?.toLowerCase().includes("archive") ?? false;
      const isTrashed =
        lastMsg.parentFolderId?.toLowerCase().includes("deleteditems") ?? false;

      threads.push({
        id: conversationId,
        providerThreadId: conversationId,
        subject: firstMsg.subject ?? "(No subject)",
        snippet: lastMsg.bodyPreview ?? "",
        participants,
        messageCount: messages.length,
        firstMessageAt: new Date(firstMsg.receivedDateTime ?? Date.now()),
        lastMessageAt: new Date(lastMsg.receivedDateTime ?? Date.now()),
        labels: lastMsg.categories ?? [],
        hasAttachments: messages.some((m) => m.hasAttachments),
        isRead: messages.every((m) => m.isRead !== false),
        isStarred: messages.some((m) => m.flag?.flagStatus === "flagged"),
        isArchived,
        isDraft: messages.some((m) => m.isDraft),
        isTrashed,
      });
    }

    return {
      items: threads,
      nextCursor: extractNextCursor(response["@odata.nextLink"]),
      hasMore: !!response["@odata.nextLink"],
      totalCount: response["@odata.count"],
    };
  }

  async getThread(threadId: string): Promise<EmailThreadWithMessages | null> {
    try {
      // Fetch all messages in the conversation
      const params = new URLSearchParams({
        $filter: `conversationId eq '${threadId}'`,
        $orderby: "receivedDateTime asc",
        $select:
          "id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,isRead,isDraft,flag,hasAttachments,internetMessageId,parentFolderId,categories",
        $expand:
          "attachments($select=id,name,contentType,size,isInline,contentId)",
      });

      const response = await this.request<GraphMessageListResponse>(
        `/me/messages?${params.toString()}`
      );

      if (response.value.length === 0) {
        return null;
      }

      const messages = response.value;
      const firstMsg = messages[0];
      const lastMsg = messages.at(-1);

      if (!(firstMsg && lastMsg)) {
        return null;
      }

      const participants: EmailRecipient[] = [];
      const participantSet = new Set<string>();
      const convertedMessages: EmailMessageData[] = [];

      for (const msg of messages) {
        const converted = this.convertMessage(msg);
        convertedMessages.push(converted);

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

      const isArchived =
        lastMsg.parentFolderId?.toLowerCase().includes("archive") ?? false;
      const isTrashed =
        lastMsg.parentFolderId?.toLowerCase().includes("deleteditems") ?? false;

      return {
        id: threadId,
        providerThreadId: threadId,
        subject: firstMsg.subject ?? "(No subject)",
        snippet: lastMsg.bodyPreview ?? "",
        participants,
        messageCount: messages.length,
        firstMessageAt: new Date(firstMsg.receivedDateTime ?? Date.now()),
        lastMessageAt: new Date(lastMsg.receivedDateTime ?? Date.now()),
        labels: lastMsg.categories ?? [],
        hasAttachments: convertedMessages.some((m) => m.attachments.length > 0),
        isRead: messages.every((m) => m.isRead !== false),
        isStarred: messages.some((m) => m.flag?.flagStatus === "flagged"),
        isArchived,
        isDraft: messages.some((m) => m.isDraft),
        isTrashed,
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
      const message = await this.request<GraphMessage>(
        `/me/messages/${messageId}?$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,isRead,isDraft,flag,hasAttachments,internetMessageId,parentFolderId,categories&$expand=attachments($select=id,name,contentType,size,isInline,contentId)`
      );
      return this.convertMessage(message);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private convertMessage(msg: GraphMessage): EmailMessageData {
    const from = convertGraphRecipient(msg.from) ?? {
      email: "unknown@unknown.com",
    };

    // Determine if message is from user by checking sent folder
    const isFromUser =
      msg.parentFolderId?.toLowerCase().includes("sentitems") ?? false;

    const attachments: AttachmentMetadata[] = (msg.attachments ?? []).map(
      (att) => ({
        id: att.id,
        filename: att.name,
        mimeType: att.contentType,
        size: att.size,
        contentId: att.contentId,
        isInline: att.isInline,
      })
    );

    return {
      id: msg.id,
      threadId: msg.conversationId,
      providerMessageId: msg.id,
      subject: msg.subject ?? "",
      snippet: msg.bodyPreview ?? "",
      bodyText: msg.body?.contentType === "text" ? msg.body.content : undefined,
      bodyHtml: msg.body?.contentType === "html" ? msg.body.content : undefined,
      from,
      to: convertGraphRecipients(msg.toRecipients),
      cc: convertGraphRecipients(msg.ccRecipients),
      bcc: convertGraphRecipients(msg.bccRecipients),
      sentAt: new Date(msg.sentDateTime ?? msg.receivedDateTime ?? Date.now()),
      receivedAt: msg.receivedDateTime
        ? new Date(msg.receivedDateTime)
        : undefined,
      messageId: msg.internetMessageId,
      labels: msg.categories ?? [],
      sizeBytes: 0, // Not available from Graph API
      attachments,
      isFromUser,
    };
  }

  async getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<AttachmentData | null> {
    try {
      const attachment = await this.request<GraphAttachment>(
        `/me/messages/${messageId}/attachments/${attachmentId}`
      );

      if (!attachment.contentBytes) {
        return null;
      }

      return {
        id: attachment.id,
        filename: attachment.name,
        mimeType: attachment.contentType,
        size: attachment.size,
        contentId: attachment.contentId,
        isInline: attachment.isInline,
        data: Buffer.from(attachment.contentBytes, "base64"),
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
    try {
      let endpoint: string;

      if (!cursor) {
        // Initial delta request
        endpoint =
          "/me/mailFolders/inbox/messages/delta?$select=id,conversationId";
      } else if (cursor.startsWith("http")) {
        // Delta link from previous request
        endpoint = cursor;
      } else {
        // Skip token
        endpoint = `/me/mailFolders/inbox/messages/delta?$select=id,conversationId&$skiptoken=${cursor}`;
      }

      const response = await this.request<GraphMessageListResponse>(endpoint);

      const changedThreadIds = new Set<string>();

      for (const msg of response.value) {
        if (msg.conversationId) {
          changedThreadIds.add(msg.conversationId);
        }
      }

      // Get the next cursor
      const nextCursor =
        response["@odata.deltaLink"] || response["@odata.nextLink"];

      return {
        newCursor: nextCursor ?? cursor ?? "",
        changedThreadIds: Array.from(changedThreadIds),
        deletedThreadIds: [], // Delta doesn't clearly indicate deletions
        fullSyncRequired: false,
      };
    } catch (error) {
      // If delta sync fails, request full sync
      if (error instanceof NotFoundError || error instanceof ProviderError) {
        return {
          newCursor: "",
          changedThreadIds: [],
          deletedThreadIds: [],
          fullSyncRequired: true,
        };
      }
      throw error;
    }
  }

  async getInitialCursor(): Promise<string> {
    // Get the delta link by doing an empty delta request
    const response = await this.request<GraphMessageListResponse>(
      "/me/mailFolders/inbox/messages/delta?$select=id&$top=1"
    );
    return response["@odata.deltaLink"] ?? "";
  }

  // ---------------------------------------------------------------------------
  // Labels/Folders
  // ---------------------------------------------------------------------------

  async listLabels(): Promise<
    Array<{ id: string; name: string; type: string }>
  > {
    const response = await this.request<{ value: GraphFolder[] }>(
      "/me/mailFolders"
    );

    return (response.value ?? []).map((folder) => ({
      id: folder.id,
      name: folder.displayName,
      type: "folder",
    }));
  }

  // ---------------------------------------------------------------------------
  // Compose Operations
  // ---------------------------------------------------------------------------

  /**
   * Send an email message via Microsoft Graph API
   */
  async sendMessage(input: EmailComposeInput): Promise<SendResult> {
    // Build message object
    const message: Record<string, unknown> = {
      subject: input.subject,
      body: {
        contentType: input.bodyHtml ? "html" : "text",
        content: input.bodyHtml || input.bodyText || "",
      },
      toRecipients: toGraphRecipients(input.to),
      ccRecipients: toGraphRecipients(input.cc),
      bccRecipients: toGraphRecipients(input.bcc),
    };

    // Add attachments if present
    if (input.attachments && input.attachments.length > 0) {
      message.attachments = input.attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename,
        contentType: att.mimeType,
        contentBytes: att.content, // Already base64 encoded
        isInline: att.isInline ?? false,
        contentId: att.contentId,
      }));
    }

    // For replies, add conversation ID
    if (input.threadId) {
      message.conversationId = input.threadId;
    }

    // Send the message
    await this.request("/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message,
        saveToSentItems: true,
      }),
    });

    // sendMail returns 202 Accepted with no body, so we need to find the sent message
    // Fetch the most recent message from sent items
    const sentItems = await this.request<GraphMessageListResponse>(
      "/me/mailFolders/sentitems/messages?$top=1&$orderby=sentDateTime desc&$select=id,conversationId,sentDateTime"
    );

    const sentMessage = sentItems.value[0];

    return {
      messageId: sentMessage?.id ?? "",
      threadId: sentMessage?.conversationId ?? input.threadId ?? "",
      sentAt: sentMessage?.sentDateTime
        ? new Date(sentMessage.sentDateTime)
        : new Date(),
    };
  }

  /**
   * Create a draft email in Outlook
   */
  async createDraft(input: DraftInput): Promise<DraftResult> {
    const message: Record<string, unknown> = {
      subject: input.subject,
      body: {
        contentType: input.bodyHtml ? "html" : "text",
        content: input.bodyHtml || input.bodyText || "",
      },
      toRecipients: toGraphRecipients(input.to),
      ccRecipients: toGraphRecipients(input.cc),
      bccRecipients: toGraphRecipients(input.bcc),
      isDraft: true,
    };

    // Add attachments if present
    if (input.attachments && input.attachments.length > 0) {
      message.attachments = input.attachments.map((att) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename,
        contentType: att.mimeType,
        contentBytes: att.content,
        isInline: att.isInline ?? false,
        contentId: att.contentId,
      }));
    }

    const response = await this.request<GraphMessage>(
      "/me/mailFolders/drafts/messages",
      {
        method: "POST",
        body: JSON.stringify(message),
      }
    );

    return {
      draftId: response.id,
      messageId: response.id,
      threadId: response.conversationId,
    };
  }

  /**
   * Update an existing draft in Outlook
   */
  async updateDraft(draftId: string, input: DraftInput): Promise<DraftResult> {
    const message = {
      subject: input.subject,
      body: {
        contentType: input.bodyHtml ? "html" : "text",
        content: input.bodyHtml || input.bodyText || "",
      },
      toRecipients: toGraphRecipients(input.to),
      ccRecipients: toGraphRecipients(input.cc),
      bccRecipients: toGraphRecipients(input.bcc),
    };

    const response = await this.request<GraphMessage>(
      `/me/messages/${draftId}`,
      {
        method: "PATCH",
        body: JSON.stringify(message),
      }
    );

    return {
      draftId: response.id,
      messageId: response.id,
      threadId: response.conversationId,
    };
  }

  /**
   * Delete a draft from Outlook
   */
  async deleteDraft(draftId: string): Promise<void> {
    await this.request(`/me/messages/${draftId}`, {
      method: "DELETE",
    });
  }

  /**
   * Get a draft by ID from Outlook
   */
  async getDraft(draftId: string): Promise<EmailMessageData | null> {
    try {
      const message = await this.request<GraphMessage>(
        `/me/messages/${draftId}?$select=id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,isRead,isDraft,flag,hasAttachments,internetMessageId,parentFolderId,categories&$expand=attachments($select=id,name,contentType,size,isInline,contentId)`
      );

      return this.convertMessage(message);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }
}
