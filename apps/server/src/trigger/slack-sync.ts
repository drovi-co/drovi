// =============================================================================
// SLACK SYNC TRIGGER TASKS
// =============================================================================
//
// Trigger.dev tasks for syncing Slack channels and messages into the
// multi-source intelligence platform.
//

import { randomUUID } from "node:crypto";
import {
  type SlackChannelData,
  type SlackMessageData,
  slackAdapter,
} from "@memorystack/ai";
import { SLACK_API_BASE } from "@memorystack/auth/providers/slack";
import { db } from "@memorystack/db";
import {
  type ConversationMetadata,
  contact,
  conversation,
  message,
  slackChannel,
  slackTeam,
  slackUserCache,
  sourceAccount,
} from "@memorystack/db/schema";
import { logger, schedules, task } from "@trigger.dev/sdk/v3";
import { and, eq, isNull, sql } from "drizzle-orm";
import { safeDecryptToken } from "../lib/crypto/tokens";
import {
  callPythonIntelligence,
  checkIntelligenceBackendHealth,
} from "../lib/intelligence-backend";

const log = logger;

// =============================================================================
// TYPES
// =============================================================================

interface SlackSyncPayload {
  /** Source account ID for Slack workspace */
  sourceAccountId: string;
  /** Whether to do a full sync (backfill) vs incremental */
  fullSync?: boolean;
  /** Only sync specific channel IDs */
  channelIds?: string[];
  /** Maximum messages to sync per channel */
  maxMessagesPerChannel?: number;
}

interface SlackSyncResult {
  success: boolean;
  sourceAccountId: string;
  channelsSynced: number;
  messagesSynced: number;
  conversationsCreated: number;
  conversationsUpdated: number;
  errors: string[];
}

// =============================================================================
// MAIN SLACK SYNC TASK
// =============================================================================

/**
 * Sync Slack channels and messages for a source account.
 */
export const syncSlackTask = task({
  id: "slack-sync",
  queue: { name: "slack-sync", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (payload: SlackSyncPayload): Promise<SlackSyncResult> => {
    const {
      sourceAccountId,
      fullSync = false,
      channelIds,
      maxMessagesPerChannel = 100,
    } = payload;

    const result: SlackSyncResult = {
      success: false,
      sourceAccountId,
      channelsSynced: 0,
      messagesSynced: 0,
      conversationsCreated: 0,
      conversationsUpdated: 0,
      errors: [],
    };

    log.info("Starting Slack sync", { sourceAccountId, fullSync });

    try {
      // Get source account
      const account = await db.query.sourceAccount.findFirst({
        where: eq(sourceAccount.id, sourceAccountId),
      });

      if (!account) {
        result.errors.push("Source account not found");
        return result;
      }

      if (account.type !== "slack") {
        result.errors.push("Source account is not a Slack account");
        return result;
      }

      // Decrypt access token
      const accessToken = account.accessToken
        ? await safeDecryptToken(account.accessToken)
        : null;

      if (!accessToken) {
        result.errors.push("No access token found");
        return result;
      }

      // Get or sync team info
      await syncTeamInfo(sourceAccountId, accessToken);

      // Get channels to sync
      const channelsToSync = await getChannelsToSync(
        sourceAccountId,
        accessToken,
        channelIds
      );

      log.info("Found channels to sync", { count: channelsToSync.length });

      // Sync each channel
      for (const channel of channelsToSync) {
        try {
          const channelResult = await syncChannel(
            sourceAccountId,
            account.organizationId,
            accessToken,
            channel,
            fullSync,
            maxMessagesPerChannel
          );

          result.channelsSynced++;
          result.messagesSynced += channelResult.messagesSynced;
          result.conversationsCreated += channelResult.created ? 1 : 0;
          result.conversationsUpdated += channelResult.updated ? 1 : 0;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          result.errors.push(`Channel ${channel.id}: ${errorMsg}`);
          log.error("Failed to sync channel", {
            channelId: channel.id,
            error: errorMsg,
          });
        }
      }

      // Update last sync timestamp
      await db
        .update(sourceAccount)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: "success",
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, sourceAccountId));

      result.success = true;

      log.info("Slack sync completed", {
        sourceAccountId,
        channelsSynced: result.channelsSynced,
        messagesSynced: result.messagesSynced,
        conversationsCreated: result.conversationsCreated,
        conversationsUpdated: result.conversationsUpdated,
        errors: result.errors.length,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.errors.push(errorMsg);

      await db
        .update(sourceAccount)
        .set({
          lastSyncStatus: "error",
          lastSyncError: errorMsg,
          updatedAt: new Date(),
        })
        .where(eq(sourceAccount.id, sourceAccountId));

      log.error("Slack sync failed", { sourceAccountId, error: errorMsg });
    }

    return result;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sync workspace/team information.
 */
async function syncTeamInfo(
  sourceAccountId: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(`${SLACK_API_BASE}/team.info`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch team info: ${response.status}`);
  }

  const data = (await response.json()) as {
    ok: boolean;
    error?: string;
    team: {
      id: string;
      name: string;
      domain: string;
      email_domain?: string;
      icon?: { image_132?: string };
      enterprise_id?: string;
      enterprise_name?: string;
    };
  };

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  const team = data.team;

  // Upsert team record
  await db
    .insert(slackTeam)
    .values({
      id: randomUUID(),
      sourceAccountId,
      slackTeamId: team.id,
      name: team.name,
      domain: team.domain,
      emailDomain: team.email_domain,
      iconUrl: team.icon?.image_132,
      enterpriseId: team.enterprise_id,
      enterpriseName: team.enterprise_name,
      isEnterpriseInstall: Boolean(team.enterprise_id),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [slackTeam.sourceAccountId, slackTeam.slackTeamId],
      set: {
        name: team.name,
        domain: team.domain,
        emailDomain: team.email_domain,
        iconUrl: team.icon?.image_132,
        enterpriseId: team.enterprise_id,
        enterpriseName: team.enterprise_name,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get channels to sync from Slack API.
 */
async function getChannelsToSync(
  sourceAccountId: string,
  accessToken: string,
  specificChannelIds?: string[]
): Promise<SlackChannelData[]> {
  const channels: SlackChannelData[] = [];
  let cursor: string | undefined;

  // Fetch all accessible channels
  do {
    const params = new URLSearchParams({
      types: "public_channel,private_channel,mpim,im",
      exclude_archived: "false",
      limit: "200",
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(
      `${SLACK_API_BASE}/conversations.list?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch channels: ${response.status}`);
    }

    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      channels: Array<{
        id: string;
        name?: string;
        is_channel: boolean;
        is_group: boolean;
        is_im: boolean;
        is_mpim: boolean;
        is_private: boolean;
        is_archived: boolean;
        is_member: boolean;
        is_general?: boolean;
        creator?: string;
        topic?: { value: string; creator: string; last_set: number };
        purpose?: { value: string; creator: string; last_set: number };
        num_members?: number;
        created: number;
        updated?: number;
      }>;
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    for (const ch of data.channels) {
      // Map to our type
      const channel: SlackChannelData = {
        id: ch.id,
        name: ch.name,
        isChannel: ch.is_channel,
        isGroup: ch.is_group,
        isIm: ch.is_im,
        isMpim: ch.is_mpim,
        isPrivate: ch.is_private,
        isArchived: ch.is_archived,
        isMember: ch.is_member,
        isGeneral: ch.is_general,
        creator: ch.creator,
        topic: ch.topic
          ? {
              value: ch.topic.value,
              creator: ch.topic.creator,
              lastSet: ch.topic.last_set,
            }
          : undefined,
        purpose: ch.purpose
          ? {
              value: ch.purpose.value,
              creator: ch.purpose.creator,
              lastSet: ch.purpose.last_set,
            }
          : undefined,
        numMembers: ch.num_members,
        created: ch.created,
        updated: ch.updated,
      };

      // Filter to member channels unless specific IDs requested
      if (specificChannelIds) {
        if (specificChannelIds.includes(ch.id)) {
          channels.push(channel);
        }
      } else if (ch.is_member) {
        channels.push(channel);
      }
    }

    cursor = data.response_metadata?.next_cursor;
  } while (cursor);

  // Update local channel records
  for (const channel of channels) {
    await upsertSlackChannel(sourceAccountId, channel);
  }

  return channels;
}

/**
 * Upsert a Slack channel record.
 */
async function upsertSlackChannel(
  sourceAccountId: string,
  channel: SlackChannelData
): Promise<void> {
  // Get team ID from source account
  const team = await db.query.slackTeam.findFirst({
    where: eq(slackTeam.sourceAccountId, sourceAccountId),
    columns: { slackTeamId: true },
  });

  await db
    .insert(slackChannel)
    .values({
      id: randomUUID(),
      sourceAccountId,
      slackChannelId: channel.id,
      slackTeamId: team?.slackTeamId ?? "",
      name: channel.name,
      topic: channel.topic?.value,
      purpose: channel.purpose?.value,
      isChannel: channel.isChannel,
      isGroup: channel.isGroup,
      isIm: channel.isIm,
      isMpim: channel.isMpim,
      isPrivate: channel.isPrivate,
      isArchived: channel.isArchived,
      isGeneral: channel.isGeneral ?? false,
      isMember: channel.isMember,
      memberCount: channel.numMembers,
      creatorUserId: channel.creator,
      slackCreatedAt: new Date(channel.created * 1000),
      slackUpdatedAt: channel.updated
        ? new Date(channel.updated * 1000)
        : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [slackChannel.sourceAccountId, slackChannel.slackChannelId],
      set: {
        name: channel.name,
        topic: channel.topic?.value,
        purpose: channel.purpose?.value,
        isArchived: channel.isArchived,
        isMember: channel.isMember,
        memberCount: channel.numMembers,
        slackUpdatedAt: channel.updated
          ? new Date(channel.updated * 1000)
          : undefined,
        updatedAt: new Date(),
      },
    });
}

/**
 * Sync messages from a channel.
 */
async function syncChannel(
  sourceAccountId: string,
  organizationId: string,
  accessToken: string,
  channel: SlackChannelData,
  fullSync: boolean,
  maxMessages: number
): Promise<{ created: boolean; updated: boolean; messagesSynced: number }> {
  const result = { created: false, updated: false, messagesSynced: 0 };

  // Get existing conversation for this channel
  const existingConversation = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, channel.id)
    ),
    columns: { id: true },
  });

  // Get last synced message timestamp and team info
  const [channelRecord, teamRecord] = await Promise.all([
    db.query.slackChannel.findFirst({
      where: and(
        eq(slackChannel.sourceAccountId, sourceAccountId),
        eq(slackChannel.slackChannelId, channel.id)
      ),
      columns: { lastMessageTs: true },
    }),
    db.query.slackTeam.findFirst({
      where: eq(slackTeam.sourceAccountId, sourceAccountId),
      columns: { domain: true, slackTeamId: true },
    }),
  ]);

  // Fetch messages from Slack
  const messages = await fetchChannelMessages(
    accessToken,
    channel.id,
    fullSync ? undefined : (channelRecord?.lastMessageTs ?? undefined),
    maxMessages
  );

  if (messages.length === 0) {
    return result;
  }

  result.messagesSynced = messages.length;

  // Convert to conversation format
  const conversationData = slackAdapter.toConversation(
    { channel, messages },
    sourceAccountId,
    "" // Will be enriched later
  );

  conversationData.organizationId = organizationId;

  const now = new Date();
  const convType = channel.isIm
    ? ("dm" as const)
    : channel.isMpim
      ? ("group_dm" as const)
      : ("channel" as const);

  // Enrich metadata with team domain for navigation
  const enrichedMetadata: ConversationMetadata = {
    ...(conversationData.metadata as ConversationMetadata),
    teamDomain: teamRecord?.domain ?? undefined,
    teamId: teamRecord?.slackTeamId,
  };

  if (existingConversation) {
    // Update existing conversation (include metadata to backfill team domain)
    await db
      .update(conversation)
      .set({
        title: conversationData.title,
        snippet: messages.at(-1)?.text?.slice(0, 200),
        participantIds: conversationData.participantIds,
        messageCount: sql`${conversation.messageCount} + ${messages.length}`,
        lastMessageAt: new Date(
          Number.parseFloat(messages.at(-1)?.ts ?? "0") * 1000
        ),
        metadata: enrichedMetadata,
        updatedAt: now,
      })
      .where(eq(conversation.id, existingConversation.id));

    result.updated = true;

    // Insert new messages
    for (const msg of messages) {
      await upsertMessage(
        existingConversation.id,
        msg,
        conversationData.userIdentifier
      );
    }
  } else {
    // Create new conversation
    const conversationId = randomUUID();

    await db.insert(conversation).values({
      id: conversationId,
      sourceAccountId,
      externalId: channel.id,
      conversationType: convType,
      title: conversationData.title,
      snippet: messages.at(-1)?.text?.slice(0, 200),
      participantIds: conversationData.participantIds,
      messageCount: messages.length,
      firstMessageAt: new Date(
        Number.parseFloat(messages[0]?.ts ?? "0") * 1000
      ),
      lastMessageAt: new Date(
        Number.parseFloat(messages.at(-1)?.ts ?? "0") * 1000
      ),
      isRead: false,
      isStarred: false,
      isArchived: channel.isArchived,
      metadata: enrichedMetadata,
      createdAt: now,
      updatedAt: now,
    });

    result.created = true;

    // Insert messages
    for (const msg of messages) {
      await upsertMessage(conversationId, msg, conversationData.userIdentifier);
    }
  }

  // Update last synced message timestamp
  const lastMsg = messages.at(-1);
  if (lastMsg) {
    await db
      .update(slackChannel)
      .set({
        lastMessageTs: lastMsg.ts,
        lastSyncAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(slackChannel.sourceAccountId, sourceAccountId),
          eq(slackChannel.slackChannelId, channel.id)
        )
      );
  }

  // Trigger conversation analysis for intelligence extraction
  // Use the conversation ID from either existing or newly created
  const conversationId =
    existingConversation?.id ??
    (result.created
      ? await getConversationIdByExternalId(sourceAccountId, channel.id)
      : null);
  if (conversationId) {
    try {
      await analyzeSlackConversationTask.trigger(
        { conversationId },
        {
          debounce: {
            key: `slack-analysis-${conversationId}`,
            delay: "30s", // Wait 30 seconds for more messages before analyzing
            mode: "trailing", // Use the latest trigger
          },
        }
      );
      log.info("Triggered Slack conversation analysis", {
        conversationId,
        channelId: channel.id,
      });
    } catch (e) {
      log.warn("Failed to trigger Slack conversation analysis", {
        conversationId,
        error: e,
      });
    }
  }

  return result;
}

/**
 * Helper to get conversation ID by external ID.
 */
async function getConversationIdByExternalId(
  sourceAccountId: string,
  externalId: string
): Promise<string | null> {
  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.sourceAccountId, sourceAccountId),
      eq(conversation.externalId, externalId)
    ),
    columns: { id: true },
  });
  return conv?.id ?? null;
}

/**
 * Fetch messages from a Slack channel.
 */
async function fetchChannelMessages(
  accessToken: string,
  channelId: string,
  oldest?: string,
  limit = 100
): Promise<SlackMessageData[]> {
  const messages: SlackMessageData[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      channel: channelId,
      limit: String(Math.min(limit - messages.length, 200)),
    });

    if (oldest) {
      params.set("oldest", oldest);
    }

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetch(
      `${SLACK_API_BASE}/conversations.history?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }

    const data = (await response.json()) as {
      ok: boolean;
      error?: string;
      messages: Array<{
        type: string;
        subtype?: string;
        ts: string;
        user?: string;
        bot_id?: string;
        text: string;
        thread_ts?: string;
        reply_count?: number;
        reply_users_count?: number;
        latest_reply?: string;
        is_starred?: boolean;
        reactions?: Array<{ name: string; count: number; users: string[] }>;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          filetype: string;
          size: number;
          url_private?: string;
          url_private_download?: string;
          thumb_360?: string;
        }>;
        edited?: { user: string; ts: string };
      }>;
      has_more: boolean;
      response_metadata?: { next_cursor?: string };
    };

    if (!data.ok) {
      // Handle rate limits gracefully
      if (data.error === "ratelimited") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw new Error(`Slack API error: ${data.error}`);
    }

    for (const msg of data.messages) {
      // Skip system messages
      if (
        msg.subtype &&
        ["channel_join", "channel_leave", "bot_add", "bot_remove"].includes(
          msg.subtype
        )
      ) {
        continue;
      }

      messages.push({
        type: msg.type,
        subtype: msg.subtype,
        ts: msg.ts,
        user: msg.user,
        botId: msg.bot_id,
        text: msg.text,
        threadTs: msg.thread_ts,
        replyCount: msg.reply_count,
        replyUsersCount: msg.reply_users_count,
        latestReply: msg.latest_reply,
        isStarred: msg.is_starred,
        reactions: msg.reactions,
        files: msg.files?.map((f) => ({
          id: f.id,
          name: f.name,
          mimetype: f.mimetype,
          filetype: f.filetype,
          size: f.size,
          urlPrivate: f.url_private,
          urlPrivateDownload: f.url_private_download,
          thumb360: f.thumb_360,
        })),
        edited: msg.edited
          ? { user: msg.edited.user, ts: msg.edited.ts }
          : undefined,
      });
    }

    cursor = data.has_more ? data.response_metadata?.next_cursor : undefined;
  } while (cursor && messages.length < limit);

  // Sort by timestamp ascending
  return messages.sort(
    (a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts)
  );
}

/**
 * Upsert a message record.
 */
async function upsertMessage(
  conversationId: string,
  msg: SlackMessageData,
  userIdentifier: string
): Promise<void> {
  const sentAt = new Date(Number.parseFloat(msg.ts) * 1000);

  await db
    .insert(message)
    .values({
      id: randomUUID(),
      conversationId,
      externalId: msg.ts,
      senderExternalId: msg.user ?? msg.botId ?? "unknown",
      senderName: undefined, // Will be enriched later
      senderEmail: undefined,
      subject: undefined,
      bodyText: msg.text,
      sentAt,
      receivedAt: sentAt,
      isFromUser: msg.user === userIdentifier,
      messageIndex: 0, // Will be updated
      hasAttachments: (msg.files?.length ?? 0) > 0,
      metadata: {
        ts: msg.ts,
        reactions: msg.reactions,
        files: msg.files?.map(
          (f: {
            id: string;
            name: string;
            mimetype: string;
            urlPrivate?: string;
          }) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimetype,
            url: f.urlPrivate ?? "",
          })
        ),
        customMetadata: {
          threadTs: msg.threadTs,
          replyCount: msg.replyCount,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [message.conversationId, message.externalId],
      set: {
        bodyText: msg.text,
        metadata: {
          ts: msg.ts,
          reactions: msg.reactions,
          files: msg.files?.map(
            (f: {
              id: string;
              name: string;
              mimetype: string;
              urlPrivate?: string;
            }) => ({
              id: f.id,
              name: f.name,
              mimeType: f.mimetype,
              url: f.urlPrivate ?? "",
            })
          ),
          customMetadata: {
            threadTs: msg.threadTs,
            replyCount: msg.replyCount,
          },
        },
        updatedAt: new Date(),
      },
    });
}

// =============================================================================
// SCHEDULED SYNC
// =============================================================================

/**
 * Scheduled task to sync all Slack accounts.
 * Runs every 5 minutes.
 */
export const syncSlackSchedule = schedules.task({
  id: "slack-sync-schedule",
  cron: "*/5 * * * *", // Every 5 minutes
  run: async () => {
    log.info("Starting scheduled Slack sync");

    // Get all active Slack source accounts
    const slackAccounts = await db.query.sourceAccount.findMany({
      where: and(
        eq(sourceAccount.type, "slack"),
        eq(sourceAccount.status, "connected")
      ),
      columns: { id: true },
    });

    if (slackAccounts.length === 0) {
      log.info("No Slack accounts to sync");
      return { scheduled: true, accountsTriggered: 0 };
    }

    // Trigger sync for each account
    for (const account of slackAccounts) {
      await syncSlackTask.trigger({
        sourceAccountId: account.id,
        fullSync: false,
        maxMessagesPerChannel: 50, // Incremental sync - fewer messages
      });

      // Also trigger batch analysis for any unprocessed conversations
      await analyzeSlackConversationsBatchTask.trigger({
        sourceAccountId: account.id,
        limit: 20, // Process up to 20 unanalyzed conversations per sync
      });
    }

    log.info("Scheduled Slack sync triggered", {
      accounts: slackAccounts.length,
    });

    return { scheduled: true, accountsTriggered: slackAccounts.length };
  },
});

// =============================================================================
// ON-DEMAND SYNC TASK
// =============================================================================

/**
 * On-demand Slack sync task.
 * Can be triggered via API for immediate sync.
 */
export const syncSlackOnDemandTask = task({
  id: "slack-sync-on-demand",
  queue: { name: "slack-sync", concurrencyLimit: 3 },
  maxDuration: 300,

  run: async (payload: {
    sourceAccountId: string;
    fullSync?: boolean;
    channelIds?: string[];
  }): Promise<SlackSyncResult> => {
    const result = await syncSlackTask.triggerAndWait({
      sourceAccountId: payload.sourceAccountId,
      fullSync: payload.fullSync ?? true,
      channelIds: payload.channelIds,
      maxMessagesPerChannel: 200, // Full sync - more messages
    });

    if (result.ok) {
      return result.output;
    }

    return {
      success: false,
      sourceAccountId: payload.sourceAccountId,
      channelsSynced: 0,
      messagesSynced: 0,
      conversationsCreated: 0,
      conversationsUpdated: 0,
      errors: [String(result.error ?? "Unknown error")],
    };
  },
});

// =============================================================================
// CONVERSATION ANALYSIS TASK
// =============================================================================

interface SlackConversationAnalysisPayload {
  conversationId: string;
  force?: boolean;
}

interface SlackConversationAnalysisResult {
  success: boolean;
  conversationId: string;
  claimsCreated: number;
  commitmentsCreated: number;
  decisionsCreated: number;
  contactsCreated: number;
  error?: string;
}

/**
 * Analyze a Slack conversation for intelligence extraction.
 * Uses Python backend for extraction - creates UIOs directly.
 */
export const analyzeSlackConversationTask = task({
  id: "slack-conversation-analysis",
  queue: { name: "slack-analysis", concurrencyLimit: 10 },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 180, // 3 minutes max

  run: async (
    payload: SlackConversationAnalysisPayload
  ): Promise<SlackConversationAnalysisResult> => {
    const { conversationId, force = false } = payload;

    log.info("Starting Slack conversation analysis via Python backend", {
      conversationId,
      force,
    });

    const result: SlackConversationAnalysisResult = {
      success: false,
      conversationId,
      claimsCreated: 0,
      commitmentsCreated: 0,
      decisionsCreated: 0,
      contactsCreated: 0,
    };

    try {
      // Verify Python backend is available
      const isHealthy = await checkIntelligenceBackendHealth();
      if (!isHealthy) {
        result.error = "Python intelligence backend is not available";
        return result;
      }

      // Get conversation with messages and source account
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, conversationId),
        with: {
          messages: {
            orderBy: (m, { asc }) => [asc(m.sentAt)],
          },
          sourceAccount: true,
        },
      });

      if (!conv) {
        result.error = "Conversation not found";
        return result;
      }

      // Skip if recently analyzed (unless forced)
      if (!force && conv.lastAnalyzedAt) {
        const hoursSinceAnalysis =
          (Date.now() - conv.lastAnalyzedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceAnalysis < 24) {
          log.info("Skipping recently analyzed conversation", {
            conversationId,
            hoursSinceAnalysis,
          });
          result.success = true;
          return result;
        }
      }

      // Skip analysis if not enough content
      if (conv.messages.length === 0) {
        log.info("Skipping analysis - no messages", { conversationId });
        result.success = true;
        return result;
      }

      // Build content string from messages
      const content = conv.messages
        .map((msg) => {
          const sender = msg.senderName ?? msg.senderExternalId ?? "Unknown";
          const timestamp = msg.sentAt?.toISOString() ?? "";
          return `[${timestamp}] ${sender}: ${msg.bodyText ?? ""}`;
        })
        .join("\n");

      // Get the authenticated user email from source account settings
      const settings = conv.sourceAccount.settings as {
        customSettings?: { authedUserId?: string };
      } | null;
      const userEmail = settings?.customSettings?.authedUserId ?? "";

      // Call Python backend for intelligence extraction
      // Python backend handles: extraction, PostgreSQL persistence, FalkorDB graph, memory episodes
      log.info("Calling Python intelligence backend", {
        conversationId,
        messageCount: conv.messages.length,
        contentLength: content.length,
      });

      const analysis = await callPythonIntelligence({
        content,
        organization_id: conv.sourceAccount.organizationId,
        source_type: "slack",
        source_id: conv.externalId ?? conversationId,
        source_account_id: conv.sourceAccountId,
        conversation_id: conversationId,
        message_ids: conv.messages.map((m) => m.id),
        user_email: userEmail,
      });

      log.info("Python intelligence analysis completed", {
        conversationId,
        analysisId: analysis.analysis_id,
        claims: analysis.claims.length,
        commitments: analysis.commitments.length,
        decisions: analysis.decisions.length,
        risks: analysis.risks.length,
        contacts: analysis.contacts.length,
        confidence: analysis.overall_confidence,
      });

      // Update result counts (Python already persisted to DB)
      result.claimsCreated = analysis.claims.length;
      result.commitmentsCreated = analysis.commitments.length;
      result.decisionsCreated = analysis.decisions.length;

      // Update conversation with analysis results
      const urgencyScore = analysis.overall_confidence;
      const priorityTier =
        urgencyScore >= 0.8
          ? "urgent"
          : urgencyScore >= 0.6
            ? "high"
            : urgencyScore >= 0.4
              ? "medium"
              : "low";

      await db
        .update(conversation)
        .set({
          hasOpenLoops: analysis.risks.length > 0,
          openLoopCount: analysis.risks.length,
          priorityTier,
          urgencyScore,
          importanceScore: urgencyScore,
          lastAnalyzedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversation.id, conversationId));

      // Extract and create/update contacts from Slack users
      // Note: Commitments, decisions, and memory episodes are created by Python backend
      const slackUserIds = new Set<string>();
      for (const msg of conv.messages) {
        if (msg.senderExternalId && msg.senderExternalId !== "unknown") {
          slackUserIds.add(msg.senderExternalId);
        }
      }

      // Get Slack user info and create contacts
      for (const slackUserId of slackUserIds) {
        // Check if contact exists
        const existingContact = await db.query.contact.findFirst({
          where: and(
            eq(contact.organizationId, conv.sourceAccount.organizationId),
            eq(contact.primaryEmail, `slack:${slackUserId}`)
          ),
        });

        // Try to get cached user info
        const cachedUser = await db.query.slackUserCache.findFirst({
          where: and(
            eq(slackUserCache.sourceAccountId, conv.sourceAccountId),
            eq(slackUserCache.slackUserId, slackUserId)
          ),
        });

        if (existingContact) {
          // Update existing contact
          await db
            .update(contact)
            .set({
              lastInteractionAt: conv.lastMessageAt ?? new Date(),
              totalMessages: sql`${contact.totalMessages} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(contact.id, existingContact.id));
        } else {
          await db.insert(contact).values({
            id: randomUUID(),
            organizationId: conv.sourceAccount.organizationId,
            primaryEmail: `slack:${slackUserId}`,
            displayName:
              cachedUser?.realName ?? cachedUser?.displayName ?? slackUserId,
            enrichmentSource: "slack",
            lastInteractionAt: conv.lastMessageAt ?? new Date(),
            totalMessages: conv.messageCount ?? 1,
            metadata: {
              slackUserId,
              sourceAccountId: conv.sourceAccountId,
              source: "slack",
              slackTeamId: (conv.metadata as { teamId?: string } | undefined)
                ?.teamId,
            },
          });
          result.contactsCreated++;
        }
      }

      result.success = true;

      log.info("Slack conversation analysis completed", {
        conversationId,
        claimsCreated: result.claimsCreated,
        commitmentsCreated: result.commitmentsCreated,
        decisionsCreated: result.decisionsCreated,
        contactsCreated: result.contactsCreated,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result.error = errorMsg;
      log.error("Slack conversation analysis failed", {
        conversationId,
        error: errorMsg,
      });
      return result;
    }
  },
});

/**
 * Batch analyze unprocessed Slack conversations.
 */
export const analyzeSlackConversationsBatchTask = task({
  id: "slack-conversation-analysis-batch",
  queue: { name: "slack-analysis", concurrencyLimit: 3 },
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 10_000,
    maxTimeoutInMs: 120_000,
    factor: 2,
  },
  maxDuration: 600, // 10 minutes max

  run: async (payload: {
    sourceAccountId: string;
    limit?: number;
    force?: boolean;
  }) => {
    const { sourceAccountId, limit = 50, force = false } = payload;

    log.info("Starting batch Slack conversation analysis", {
      sourceAccountId,
      limit,
      force,
    });

    // Get unanalyzed conversations
    const whereClause = force
      ? eq(conversation.sourceAccountId, sourceAccountId)
      : and(
          eq(conversation.sourceAccountId, sourceAccountId),
          isNull(conversation.lastAnalyzedAt)
        );

    const conversations = await db.query.conversation.findMany({
      where: whereClause,
      orderBy: (c, { desc }) => [desc(c.lastMessageAt)],
      limit,
      columns: { id: true },
    });

    log.info("Found conversations for batch analysis", {
      sourceAccountId,
      count: conversations.length,
    });

    let processed = 0;
    let failed = 0;

    for (const conv of conversations) {
      try {
        await analyzeSlackConversationTask.trigger({
          conversationId: conv.id,
          force,
        });
        processed++;
      } catch (error) {
        failed++;
        log.error("Failed to queue conversation for analysis", {
          conversationId: conv.id,
          error,
        });
      }
    }

    return {
      total: conversations.length,
      processed,
      failed,
    };
  },
});

// =============================================================================
// EXPORTS
// =============================================================================

export type {
  SlackSyncPayload,
  SlackSyncResult,
  SlackConversationAnalysisPayload,
  SlackConversationAnalysisResult,
};
