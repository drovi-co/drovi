// =============================================================================
// SLACK ADAPTER
// =============================================================================
//
// Converts Slack messages and channels to generic ConversationInput format for
// multi-source intelligence processing. Slack conversations map to:
// - Channels → channel conversation type
// - DMs → dm conversation type
// - Group DMs → group_dm conversation type
// - Threads → slack_thread conversation type
//

import type {
  ConversationInput,
  MessageInput,
  MessageRecipient,
  Participant,
  SlackConversation,
  SourceAdapter,
} from "../types/content";

// =============================================================================
// SLACK-SPECIFIC INPUT TYPES
// =============================================================================

/**
 * Slack user profile information.
 */
export interface SlackUserData {
  id: string;
  teamId: string;
  name: string;
  realName?: string;
  displayName?: string;
  email?: string;
  image?: string;
  isBot: boolean;
  isAdmin?: boolean;
  isOwner?: boolean;
  deleted?: boolean;
}

/**
 * Slack channel/conversation information.
 */
export interface SlackChannelData {
  id: string;
  name?: string;
  isChannel: boolean;
  isGroup: boolean; // Private channel
  isIm: boolean; // Direct message
  isMpim: boolean; // Multi-person IM (group DM)
  isPrivate: boolean;
  isArchived: boolean;
  isMember: boolean;
  isGeneral?: boolean;
  creator?: string;
  topic?: {
    value: string;
    creator: string;
    lastSet: number;
  };
  purpose?: {
    value: string;
    creator: string;
    lastSet: number;
  };
  numMembers?: number;
  members?: string[];
  created: number;
  updated?: number;
  unreadCount?: number;
  lastRead?: string;
  latest?: SlackMessageData;
}

/**
 * Slack message data.
 */
export interface SlackMessageData {
  type: string;
  subtype?: string;
  ts: string; // Timestamp (unique message ID)
  user?: string; // User ID
  botId?: string;
  text: string;
  threadTs?: string; // Parent thread timestamp
  replyCount?: number;
  replyUsersCount?: number;
  latestReply?: string;
  isStarred?: boolean;
  reactions?: Array<{
    name: string;
    count: number;
    users: string[];
  }>;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    filetype: string;
    size: number;
    urlPrivate?: string;
    urlPrivateDownload?: string;
    thumb360?: string;
  }>;
  attachments?: Array<{
    fallback: string;
    color?: string;
    pretext?: string;
    authorName?: string;
    authorLink?: string;
    authorIcon?: string;
    title?: string;
    titleLink?: string;
    text?: string;
    fields?: Array<{
      title: string;
      value: string;
      short: boolean;
    }>;
    imageUrl?: string;
    thumbUrl?: string;
    footer?: string;
    footerIcon?: string;
    ts?: number;
  }>;
  blocks?: unknown[]; // Block Kit elements
  edited?: {
    user: string;
    ts: string;
  };
}

/**
 * Context for Slack workspace.
 */
export interface SlackWorkspaceContext {
  teamId: string;
  teamName: string;
  teamDomain?: string;
  botUserId: string;
  authedUserId: string;
}

// =============================================================================
// SLACK ADAPTER IMPLEMENTATION
// =============================================================================

/**
 * Slack adapter for converting Slack data to generic format.
 *
 * Slack channels and DMs are treated as conversations where:
 * - Channel messages form the conversation messages
 * - Thread replies are nested or separate conversations
 * - Reactions and mentions can indicate commitments/decisions
 */
export const slackAdapter: SourceAdapter<
  { channel: SlackChannelData; messages: SlackMessageData[] },
  SlackMessageData
> = {
  sourceType: "slack",

  /**
   * Convert Slack channel with messages to generic ConversationInput.
   */
  toConversation(
    data: { channel: SlackChannelData; messages: SlackMessageData[] },
    sourceId: string,
    userIdentifier: string
  ): SlackConversation {
    const { channel, messages } = data;

    // Determine conversation type
    let conversationType: "channel" | "dm" | "group_dm" | "slack_thread" =
      "channel";
    if (channel.isIm) {
      conversationType = "dm";
    } else if (channel.isMpim) {
      conversationType = "group_dm";
    } else if (channel.isGroup) {
      conversationType = "channel"; // Private channels are still channels
    }

    // Build participant list from members or message senders
    const participantIds = channel.members ?? [
      ...new Set(messages.map((m) => m.user).filter(Boolean) as string[]),
    ];

    // Get channel display name
    const title = getChannelDisplayName(channel);

    // Sort messages by timestamp
    const sortedMessages = [...messages].sort((a, b) =>
      a.ts.localeCompare(b.ts)
    );

    return {
      id: channel.id,
      externalId: channel.id,
      sourceId,
      sourceType: "slack",
      organizationId: "", // Will be set by caller
      conversationType,
      title,
      participantIds,
      userIdentifier,
      messages: sortedMessages.map((msg, index) =>
        slackAdapter.toMessage(msg, index)
      ),
      metadata: {
        channelId: channel.id,
        channelName: channel.name,
        threadTs: undefined,
        isPrivate: channel.isPrivate,
        isMember: channel.isMember,
        isArchived: channel.isArchived,
      },
    };
  },

  /**
   * Convert Slack message to generic MessageInput.
   */
  toMessage(msg: SlackMessageData, messageIndex: number): MessageInput {
    // Parse timestamp to Date
    const sentAt = parseSlackTimestamp(msg.ts);
    const editedAt = msg.edited
      ? parseSlackTimestamp(msg.edited.ts)
      : undefined;

    // Build recipients from mentions
    const recipients = extractMentions(msg.text);

    return {
      id: msg.ts,
      externalId: msg.ts,
      senderId: msg.user ?? msg.botId ?? "unknown",
      senderName: undefined, // Will be enriched with user lookup
      senderEmail: undefined,
      isFromUser: false, // Will be set based on userIdentifier
      recipients,
      subject: undefined, // Slack messages don't have subjects
      bodyText: msg.text,
      bodyHtml: undefined,
      sentAt,
      receivedAt: sentAt,
      editedAt,
      messageIndex,
      hasAttachments: (msg.files?.length ?? 0) > 0,
      metadata: {
        ts: msg.ts,
        threadTs: msg.threadTs,
        reactions: msg.reactions,
        files: msg.files?.map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimetype,
          url: f.urlPrivate ?? "",
        })),
      },
    };
  },

  /**
   * Extract participant from Slack user data.
   */
  toParticipant(raw: unknown): Participant {
    if (
      typeof raw === "object" &&
      raw !== null &&
      "id" in raw &&
      typeof (raw as { id: unknown }).id === "string"
    ) {
      const user = raw as SlackUserData;
      return {
        id: user.id,
        email: user.email,
        name: user.displayName ?? user.realName ?? user.name,
        avatarUrl: user.image,
        metadata: {
          teamId: user.teamId,
          isBot: user.isBot,
          isAdmin: user.isAdmin,
          isOwner: user.isOwner,
        },
      };
    }

    throw new Error("Invalid Slack user data");
  },

  /**
   * Get display name for Slack source.
   */
  getSourceDisplayName(conversation: ConversationInput): string {
    const metadata = conversation.metadata as SlackConversation["metadata"];
    if (metadata?.channelName) {
      return `#${metadata.channelName}`;
    }
    return "Slack";
  },

  /**
   * Get deep link URL to Slack conversation/message.
   */
  getSourceUrl(
    conversation: ConversationInput,
    messageId?: string
  ): string | undefined {
    const metadata = conversation.metadata as SlackConversation["metadata"];

    if (!metadata?.channelId) {
      return undefined;
    }

    // Slack deep link format: slack://channel?team=T123&id=C123&message=1234567890.123456
    // Web format: https://app.slack.com/client/T123/C123/1234567890.123456
    const channelId = metadata.channelId;

    if (messageId) {
      // Link to specific message
      return `slack://channel?id=${channelId}&message=${messageId}`;
    }

    // Link to channel
    return `slack://channel?id=${channelId}`;
  },
};

// =============================================================================
// THREAD HANDLING
// =============================================================================

/**
 * Convert a Slack thread to a separate conversation.
 * Threads in Slack are nested conversations within channels.
 */
export function slackThreadToConversation(
  channel: SlackChannelData,
  parentMessage: SlackMessageData,
  replies: SlackMessageData[],
  sourceId: string,
  userIdentifier: string
): SlackConversation {
  // Sort replies by timestamp
  const sortedReplies = [parentMessage, ...replies].sort((a, b) =>
    a.ts.localeCompare(b.ts)
  );

  // Get unique participants
  const participantIds = [
    ...new Set(sortedReplies.map((m) => m.user).filter(Boolean) as string[]),
  ];

  // Thread title from parent message (truncated)
  const title = truncateText(parentMessage.text, 100);

  return {
    id: `${channel.id}_${parentMessage.ts}`,
    externalId: parentMessage.ts,
    sourceId,
    sourceType: "slack",
    organizationId: "", // Will be set by caller
    conversationType: "slack_thread",
    title,
    participantIds,
    userIdentifier,
    messages: sortedReplies.map((msg, index) =>
      slackAdapter.toMessage(msg, index)
    ),
    metadata: {
      channelId: channel.id,
      channelName: channel.name,
      threadTs: parentMessage.ts,
      isPrivate: channel.isPrivate,
      isMember: channel.isMember,
      isArchived: channel.isArchived,
    },
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Parse Slack timestamp to Date.
 * Slack timestamps are Unix timestamps with microseconds: "1234567890.123456"
 */
function parseSlackTimestamp(ts: string): Date {
  const seconds = Number.parseFloat(ts);
  return new Date(seconds * 1000);
}

/**
 * Get display name for a Slack channel.
 */
function getChannelDisplayName(channel: SlackChannelData): string {
  if (channel.name) {
    return channel.isPrivate ? `#${channel.name}` : `#${channel.name}`;
  }
  if (channel.isIm) {
    return "Direct Message";
  }
  if (channel.isMpim) {
    return "Group Message";
  }
  return "Slack Channel";
}

/**
 * Extract @mentions from Slack message text.
 * Slack mentions format: <@U123456>
 */
function extractMentions(text: string): MessageRecipient[] {
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  const mentions: MessageRecipient[] = [];
  let match: RegExpExecArray | null = null;

  match = mentionRegex.exec(text);
  while (match !== null) {
    const userId = match[1];
    if (userId) {
      mentions.push({
        id: userId,
        type: "mention",
      });
    }
    match = mentionRegex.exec(text);
  }

  return mentions;
}

/**
 * Truncate text to a maximum length.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

// =============================================================================
// SLACK API HELPERS
// =============================================================================

/**
 * Slack API response wrapper.
 */
export interface SlackApiResponse<T> {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
  };
  data?: T;
}

/**
 * Paginated list of channels response.
 */
export interface SlackChannelListResponse {
  ok: boolean;
  channels: SlackChannelData[];
  response_metadata?: {
    next_cursor?: string;
  };
}

/**
 * Conversation history response.
 */
export interface SlackHistoryResponse {
  ok: boolean;
  messages: SlackMessageData[];
  has_more: boolean;
  pin_count?: number;
  response_metadata?: {
    next_cursor?: string;
  };
}

/**
 * Thread replies response.
 */
export interface SlackRepliesResponse {
  ok: boolean;
  messages: SlackMessageData[];
  has_more: boolean;
  response_metadata?: {
    next_cursor?: string;
  };
}

/**
 * Users list response.
 */
export interface SlackUsersListResponse {
  ok: boolean;
  members: SlackUserData[];
  response_metadata?: {
    next_cursor?: string;
  };
}
