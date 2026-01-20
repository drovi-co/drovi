// =============================================================================
// UNIFIED INBOX ROUTER
// =============================================================================
//
// Multi-source unified inbox API that combines conversations from all connected
// sources (Email, Slack, Calendar, WhatsApp, Notion, etc.) into a single stream.
//
// This is the core router for the unified smart inbox experience.
//

import type { SourceType } from "@memorystack/ai";
import { db } from "@memorystack/db";
import {
  commitment,
  conversation,
  decision,
  emailAccount,
  emailThread,
  member,
  message,
  sourceAccount,
  task,
  unifiedIntelligenceObject,
  unifiedObjectSource,
  user,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Unified feed item that can represent a conversation from any source.
 */
/**
 * Task priority and status types for inbox items
 */
export type TaskPriority = "no_priority" | "low" | "medium" | "high" | "urgent";
export type TaskStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "cancelled";

/**
 * Task data for an inbox item
 */
export interface LinkedTask {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
}

/**
 * Source breadcrumb for cross-source UIOs
 */
export interface SourceBreadcrumb {
  sourceType: string;
  count: number;
  sourceName: string;
}

/**
 * Unified Intelligence Object linked to a conversation
 */
export interface LinkedUIO {
  id: string;
  type: "commitment" | "decision" | "topic";
  title: string;
  dueDate?: Date | null;
  status: string;
  sourceBreadcrumbs: SourceBreadcrumb[];
}

export interface UnifiedFeedItem {
  id: string;
  sourceType: SourceType;
  sourceAccountId: string;
  sourceAccountName?: string;
  externalId: string;
  conversationType: string | null;
  title: string;
  snippet: string;
  brief?: string | null;
  participants: Array<{ id: string; name?: string; email?: string }>;
  messageCount: number;
  lastMessageAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  // Intelligence metadata
  priorityTier: string | null;
  urgencyScore: number | null;
  importanceScore: number | null;
  hasOpenLoops: boolean | null;
  openLoopCount: number | null;
  suggestedAction: string | null;
  hasCommitments: boolean;
  hasDecisions: boolean;
  // Linked task data - if present, shows task controls
  task?: LinkedTask;
  // Unified Intelligence Objects linked to this conversation
  unifiedObjects?: LinkedUIO[];
  // Source-specific metadata
  metadata?: Record<string, unknown>;
}

/**
 * Stats for the unified inbox.
 */
export interface UnifiedInboxStats {
  total: number;
  unread: number;
  bySource: Record<string, { total: number; unread: number }>;
  byPriority: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
}

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const sourceTypeSchema = z.enum([
  "email",
  "slack",
  "calendar",
  "whatsapp",
  "notion",
  "google_docs",
  "google_sheets",
  "meeting_transcript",
  "teams",
  "discord",
  "linear",
  "github",
]);

const listInboxSchema = z.object({
  // Filter by source types
  sourceTypes: z.array(sourceTypeSchema).optional(),
  // Filter by specific source accounts
  accountIds: z.array(z.string()).optional(),
  // Priority filters
  priority: z.array(z.enum(["urgent", "high", "medium", "low"])).optional(),
  // Status filters
  status: z.array(z.enum(["unread", "starred", "archived", "read"])).optional(),
  // Intelligence filters
  hasCommitments: z.boolean().optional(),
  hasDecisions: z.boolean().optional(),
  hasOpenLoops: z.boolean().optional(),
  needsResponse: z.boolean().optional(),
  // Search
  search: z.string().optional(),
  // Date range
  after: z.date().optional(),
  before: z.date().optional(),
  // Pagination
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

const getConversationSchema = z.object({
  conversationId: z.string(),
});

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get the active organization ID from session.
 */
async function getActiveOrgId(ctx: {
  session: { session: { activeOrganizationId: string | null } };
}): Promise<string> {
  const orgId = ctx.session.session.activeOrganizationId;
  if (!orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No organization selected. Please select an organization first.",
    });
  }
  return orgId;
}

/**
 * Verify user has access to this organization.
 */
async function verifyOrgMembership(
  userId: string,
  organizationId: string
): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.userId, userId),
      eq(member.organizationId, organizationId)
    ),
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this organization.",
    });
  }
}

/**
 * Get all source account IDs for an organization.
 */
async function getSourceAccountIds(
  organizationId: string,
  sourceTypes?: string[],
  specificAccountIds?: string[]
): Promise<string[]> {
  const conditions = [eq(sourceAccount.organizationId, organizationId)];

  if (sourceTypes && sourceTypes.length > 0) {
    conditions.push(
      inArray(
        sourceAccount.type,
        sourceTypes as typeof sourceAccount.type.enumValues
      )
    );
  }

  if (specificAccountIds && specificAccountIds.length > 0) {
    conditions.push(inArray(sourceAccount.id, specificAccountIds));
  }

  const accounts = await db
    .select({ id: sourceAccount.id })
    .from(sourceAccount)
    .where(and(...conditions));

  return accounts.map((a) => a.id);
}

/**
 * Map source type to display configuration.
 */
function getSourceDisplayName(sourceType: string): string {
  const displayNames: Record<string, string> = {
    email: "Email",
    slack: "Slack",
    calendar: "Calendar",
    whatsapp: "WhatsApp",
    notion: "Notion",
    google_docs: "Google Docs",
    google_sheets: "Google Sheets",
    meeting_transcript: "Meeting",
    teams: "Teams",
    discord: "Discord",
    linear: "Linear",
    github: "GitHub",
  };
  return displayNames[sourceType] ?? sourceType;
}

/**
 * Extract participants with names from conversation metadata.
 * For calendar events, names are stored in metadata.organizer and metadata.attendees.
 * For other sources, we fall back to email-only participants.
 */
function extractParticipants(
  participantIds: unknown[],
  metadata: Record<string, unknown> | undefined,
  sourceType: SourceType
): Array<{ id: string; name?: string; email?: string }> {
  // For calendar events, extract names from metadata
  if (sourceType === "calendar" && metadata) {
    const organizer = metadata.organizer as
      | { email?: string; name?: string }
      | undefined;
    const attendees = metadata.attendees as
      | Array<{ email?: string; name?: string }>
      | undefined;

    // Build a name lookup map from metadata
    const nameMap = new Map<string, string>();

    if (organizer?.email) {
      nameMap.set(organizer.email.toLowerCase(), organizer.name ?? "");
    }

    if (attendees && Array.isArray(attendees)) {
      for (const attendee of attendees) {
        if (attendee.email) {
          nameMap.set(attendee.email.toLowerCase(), attendee.name ?? "");
        }
      }
    }

    // Map participant IDs to participants with names
    return (participantIds ?? []).map((id) => {
      const email = String(id);
      const name = nameMap.get(email.toLowerCase());
      return {
        id: email,
        name: name || undefined,
        email,
      };
    });
  }

  // Default: email-only participants
  return (participantIds ?? []).map((id) => ({
    id: String(id),
    name: undefined,
    email: String(id),
  }));
}

// =============================================================================
// ROUTER
// =============================================================================

export const unifiedInboxRouter = router({
  /**
   * List unified inbox items from all connected sources.
   * This is the main query for the unified smart inbox.
   */
  list: protectedProcedure
    .input(listInboxSchema)
    .query(async ({ ctx, input }) => {
      const orgId = await getActiveOrgId(ctx);
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, orgId);

      // Build conditions for the conversation query
      const conditions = [];

      // Get source account IDs for this organization
      const accountIds = await getSourceAccountIds(
        orgId,
        input.sourceTypes,
        input.accountIds
      );

      // Check if we should include legacy email threads
      // Only include emails when:
      // 1. No source type filter (showing "all") - include legacy emails
      // 2. Source type filter explicitly includes "email"
      const shouldIncludeLegacyEmails =
        !input.sourceTypes || input.sourceTypes.includes("email");

      // If no source accounts found for the requested types
      if (accountIds.length === 0) {
        // Only fall back to email if we're looking for emails or "all"
        if (shouldIncludeLegacyEmails) {
          return await getEmailFallbackInbox(ctx, input, orgId);
        }
        // Otherwise return empty - no source accounts for this type
        return { items: [], total: 0, hasMore: false };
      }

      // If showing "all" or "email" and there are legacy email accounts,
      // we need to merge results from both conversation table AND emailThread table
      if (shouldIncludeLegacyEmails) {
        // Check for legacy email accounts not yet migrated to sourceAccount
        const legacyEmailAccounts = await db.query.emailAccount.findMany({
          where: eq(emailAccount.organizationId, orgId),
          columns: { id: true },
        });

        // If there are legacy email accounts, use the combined approach
        if (legacyEmailAccounts.length > 0) {
          return await getCombinedInbox(ctx, input, orgId, accountIds);
        }
      }

      conditions.push(inArray(conversation.sourceAccountId, accountIds));

      // Status filters
      if (input.status && input.status.length > 0) {
        const statusConditions = [];
        if (input.status.includes("unread")) {
          statusConditions.push(eq(conversation.isRead, false));
        }
        if (input.status.includes("read")) {
          statusConditions.push(eq(conversation.isRead, true));
        }
        if (input.status.includes("starred")) {
          statusConditions.push(eq(conversation.isStarred, true));
        }
        if (input.status.includes("archived")) {
          statusConditions.push(eq(conversation.isArchived, true));
        }
        if (statusConditions.length > 0) {
          conditions.push(or(...statusConditions));
        }
      } else {
        // Default: exclude archived
        conditions.push(eq(conversation.isArchived, false));
      }

      // Priority filters
      if (input.priority && input.priority.length > 0) {
        conditions.push(inArray(conversation.priorityTier, input.priority));
      }

      // Intelligence filters
      if (input.hasOpenLoops !== undefined) {
        conditions.push(eq(conversation.hasOpenLoops, input.hasOpenLoops));
      }

      if (input.needsResponse) {
        conditions.push(eq(conversation.suggestedAction, "respond"));
      }

      // Date range
      if (input.after) {
        conditions.push(gte(conversation.lastMessageAt, input.after));
      }

      if (input.before) {
        conditions.push(lte(conversation.lastMessageAt, input.before));
      }

      // Search
      if (input.search) {
        const searchPattern = `%${input.search}%`;
        conditions.push(
          or(
            sql`${conversation.title} ILIKE ${searchPattern}`,
            sql`${conversation.snippet} ILIKE ${searchPattern}`
          )
        );
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversation)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Get conversations with source account info
      const conversations = await db
        .select({
          id: conversation.id,
          sourceAccountId: conversation.sourceAccountId,
          externalId: conversation.externalId,
          conversationType: conversation.conversationType,
          title: conversation.title,
          snippet: conversation.snippet,
          briefSummary: conversation.briefSummary,
          participantIds: conversation.participantIds,
          messageCount: conversation.messageCount,
          lastMessageAt: conversation.lastMessageAt,
          isRead: conversation.isRead,
          isStarred: conversation.isStarred,
          isArchived: conversation.isArchived,
          priorityTier: conversation.priorityTier,
          urgencyScore: conversation.urgencyScore,
          importanceScore: conversation.importanceScore,
          hasOpenLoops: conversation.hasOpenLoops,
          openLoopCount: conversation.openLoopCount,
          suggestedAction: conversation.suggestedAction,
          metadata: conversation.metadata,
          // Source account info
          sourceType: sourceAccount.type,
          sourceDisplayName: sourceAccount.displayName,
        })
        .from(conversation)
        .innerJoin(
          sourceAccount,
          eq(conversation.sourceAccountId, sourceAccount.id)
        )
        .where(and(...conditions))
        .orderBy(desc(conversation.lastMessageAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get conversation IDs for commitment/decision lookup
      const conversationIds = conversations.map((c) => c.id);

      // Batch lookup for commitments per conversation
      const commitmentCounts =
        conversationIds.length > 0
          ? await db
              .select({
                conversationId: commitment.sourceConversationId,
                count: sql<number>`count(*)::int`,
              })
              .from(commitment)
              .where(inArray(commitment.sourceConversationId, conversationIds))
              .groupBy(commitment.sourceConversationId)
          : [];

      // Batch lookup for decisions per conversation
      const decisionCounts =
        conversationIds.length > 0
          ? await db
              .select({
                conversationId: decision.sourceConversationId,
                count: sql<number>`count(*)::int`,
              })
              .from(decision)
              .where(inArray(decision.sourceConversationId, conversationIds))
              .groupBy(decision.sourceConversationId)
          : [];

      // Batch lookup for tasks linked to conversations
      const linkedTasks =
        conversationIds.length > 0
          ? await db
              .select({
                conversationId: task.sourceConversationId,
                taskId: task.id,
                status: task.status,
                priority: task.priority,
                assigneeId: task.assigneeId,
                assigneeName: user.name,
                assigneeEmail: user.email,
                assigneeImage: user.image,
              })
              .from(task)
              .leftJoin(user, eq(task.assigneeId, user.id))
              .where(inArray(task.sourceConversationId, conversationIds))
          : [];

      // Batch lookup for UIOs linked to conversations
      const linkedUIOs =
        conversationIds.length > 0
          ? await db
              .select({
                conversationId: unifiedObjectSource.conversationId,
                uioId: unifiedIntelligenceObject.id,
                type: unifiedIntelligenceObject.type,
                title: unifiedIntelligenceObject.canonicalTitle,
                dueDate: unifiedIntelligenceObject.dueDate,
                status: unifiedIntelligenceObject.status,
              })
              .from(unifiedObjectSource)
              .innerJoin(
                unifiedIntelligenceObject,
                eq(
                  unifiedObjectSource.unifiedObjectId,
                  unifiedIntelligenceObject.id
                )
              )
              .where(
                and(
                  inArray(unifiedObjectSource.conversationId, conversationIds),
                  eq(unifiedIntelligenceObject.status, "active")
                )
              )
          : [];

      // Get all UIO IDs for source breadcrumb lookup
      const uioIds = [...new Set(linkedUIOs.map((u) => u.uioId))];
      const uioSources =
        uioIds.length > 0
          ? await db
              .select({
                unifiedObjectId: unifiedObjectSource.unifiedObjectId,
                sourceType: unifiedObjectSource.sourceType,
              })
              .from(unifiedObjectSource)
              .where(inArray(unifiedObjectSource.unifiedObjectId, uioIds))
          : [];

      // Build UIO source breadcrumb map
      const uioSourceMap = new Map<string, Map<string, number>>();
      for (const source of uioSources) {
        if (!uioSourceMap.has(source.unifiedObjectId)) {
          uioSourceMap.set(source.unifiedObjectId, new Map());
        }
        const sourceTypeMap = uioSourceMap.get(source.unifiedObjectId)!;
        sourceTypeMap.set(
          source.sourceType,
          (sourceTypeMap.get(source.sourceType) ?? 0) + 1
        );
      }

      // Create lookup maps
      const commitmentMap = new Map(
        commitmentCounts.map((c) => [c.conversationId, c.count])
      );
      const decisionMap = new Map(
        decisionCounts.map((d) => [d.conversationId, d.count])
      );
      const taskMap = new Map(
        linkedTasks.map((t) => [
          t.conversationId,
          {
            id: t.taskId,
            status: t.status as TaskStatus,
            priority: t.priority as TaskPriority,
            assignee: t.assigneeId
              ? {
                  id: t.assigneeId,
                  name: t.assigneeName,
                  email: t.assigneeEmail ?? "",
                  image: t.assigneeImage,
                }
              : null,
          },
        ])
      );

      // Build UIO map by conversation ID
      const uioMap = new Map<string, LinkedUIO[]>();
      for (const uio of linkedUIOs) {
        if (!uio.conversationId) continue;
        if (!uioMap.has(uio.conversationId)) {
          uioMap.set(uio.conversationId, []);
        }
        // Get source breadcrumbs for this UIO
        const sourceTypeMap = uioSourceMap.get(uio.uioId);
        const sourceBreadcrumbs: SourceBreadcrumb[] = sourceTypeMap
          ? Array.from(sourceTypeMap.entries()).map(([sourceType, count]) => ({
              sourceType,
              count,
              sourceName: getSourceDisplayName(sourceType),
            }))
          : [];

        // Only add if not already in the list (avoid duplicates)
        const existingUios = uioMap.get(uio.conversationId)!;
        if (!existingUios.some((u) => u.id === uio.uioId)) {
          existingUios.push({
            id: uio.uioId,
            type: uio.type as "commitment" | "decision" | "topic",
            title: uio.title,
            dueDate: uio.dueDate,
            status: uio.status,
            sourceBreadcrumbs,
          });
        }
      }

      // Transform to UnifiedFeedItem format
      const items: UnifiedFeedItem[] = conversations.map((c) => {
        // Extract participant names from metadata for calendar events
        const participants = extractParticipants(
          c.participantIds ?? [],
          c.metadata as Record<string, unknown> | undefined,
          c.sourceType as SourceType
        );

        const linkedTask = taskMap.get(c.id);

        return {
          id: c.id,
          sourceType: c.sourceType as SourceType,
          sourceAccountId: c.sourceAccountId,
          sourceAccountName:
            c.sourceDisplayName ?? getSourceDisplayName(c.sourceType),
          externalId: c.externalId,
          conversationType: c.conversationType,
          title: c.title ?? "No subject",
          snippet: c.snippet ?? "",
          brief: c.briefSummary,
          participants,
          messageCount: c.messageCount ?? 0,
          lastMessageAt: c.lastMessageAt,
          isRead: c.isRead ?? false,
          isStarred: c.isStarred ?? false,
          isArchived: c.isArchived ?? false,
          priorityTier: c.priorityTier,
          urgencyScore: c.urgencyScore,
          importanceScore: c.importanceScore,
          hasOpenLoops: c.hasOpenLoops,
          openLoopCount: c.openLoopCount,
          suggestedAction: c.suggestedAction,
          hasCommitments: (commitmentMap.get(c.id) ?? 0) > 0,
          hasDecisions: (decisionMap.get(c.id) ?? 0) > 0,
          task: linkedTask,
          unifiedObjects: uioMap.get(c.id),
          metadata: c.metadata as Record<string, unknown> | undefined,
        };
      });

      return {
        items,
        total,
        hasMore: input.offset + items.length < total,
      };
    }),

  /**
   * Get inbox statistics across all sources.
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const orgId = await getActiveOrgId(ctx);
    const userId = ctx.session.user.id;
    await verifyOrgMembership(userId, orgId);

    // Get source account IDs
    const accountIds = await getSourceAccountIds(orgId);

    // If no source accounts, fall back to email stats
    if (accountIds.length === 0) {
      return await getEmailFallbackStats(ctx, orgId);
    }

    // Get total and unread counts
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(
        and(
          inArray(conversation.sourceAccountId, accountIds),
          eq(conversation.isArchived, false)
        )
      );

    const [unreadResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(
        and(
          inArray(conversation.sourceAccountId, accountIds),
          eq(conversation.isArchived, false),
          eq(conversation.isRead, false)
        )
      );

    // Get counts by source type
    const bySourceResults = await db
      .select({
        sourceType: sourceAccount.type,
        total: sql<number>`count(*)::int`,
        unread: sql<number>`sum(case when ${conversation.isRead} = false then 1 else 0 end)::int`,
      })
      .from(conversation)
      .innerJoin(
        sourceAccount,
        eq(conversation.sourceAccountId, sourceAccount.id)
      )
      .where(
        and(
          inArray(conversation.sourceAccountId, accountIds),
          eq(conversation.isArchived, false)
        )
      )
      .groupBy(sourceAccount.type);

    // Get counts by priority
    const priorityResults = await db
      .select({
        priority: conversation.priorityTier,
        count: sql<number>`count(*)::int`,
      })
      .from(conversation)
      .where(
        and(
          inArray(conversation.sourceAccountId, accountIds),
          eq(conversation.isArchived, false),
          isNotNull(conversation.priorityTier)
        )
      )
      .groupBy(conversation.priorityTier);

    const bySource: Record<string, { total: number; unread: number }> = {};
    for (const row of bySourceResults) {
      bySource[row.sourceType] = {
        total: row.total,
        unread: row.unread ?? 0,
      };
    }

    const byPriority = {
      urgent: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    for (const row of priorityResults) {
      if (row.priority && row.priority in byPriority) {
        byPriority[row.priority as keyof typeof byPriority] = row.count;
      }
    }

    return {
      total: totalResult?.count ?? 0,
      unread: unreadResult?.count ?? 0,
      bySource,
      byPriority,
    } satisfies UnifiedInboxStats;
  }),

  /**
   * Get connected sources for the current organization.
   */
  getSources: protectedProcedure.query(async ({ ctx }) => {
    const orgId = await getActiveOrgId(ctx);
    const userId = ctx.session.user.id;
    await verifyOrgMembership(userId, orgId);

    // Get source accounts
    const sources = await db.query.sourceAccount.findMany({
      where: eq(sourceAccount.organizationId, orgId),
      columns: {
        id: true,
        type: true,
        provider: true,
        externalId: true,
        displayName: true,
        status: true,
        lastSyncAt: true,
      },
    });

    // Also check legacy email accounts for backward compatibility
    const emailAccounts = await db.query.emailAccount.findMany({
      where: eq(emailAccount.organizationId, orgId),
      columns: {
        id: true,
        email: true,
        provider: true,
        status: true,
        lastSyncAt: true,
      },
    });

    // Combine sources
    const allSources = [
      ...sources.map((s) => ({
        id: s.id,
        type: s.type as SourceType,
        provider: s.provider,
        identifier: s.externalId,
        displayName: s.displayName ?? getSourceDisplayName(s.type),
        status: s.status,
        lastSyncAt: s.lastSyncAt,
        isLegacy: false,
      })),
      // Add email accounts not yet migrated to sourceAccount table
      ...emailAccounts
        .filter((e) => !sources.some((s) => s.externalId === e.email))
        .map((e) => ({
          id: e.id,
          type: "email" as SourceType,
          provider: e.provider ?? "gmail",
          identifier: e.email,
          displayName: e.email,
          status: e.status,
          lastSyncAt: e.lastSyncAt,
          isLegacy: true,
        })),
    ];

    return {
      sources: allSources,
      availableTypes: [
        { type: "email", label: "Email", description: "Gmail, Outlook" },
        { type: "slack", label: "Slack", description: "Channels and DMs" },
        {
          type: "calendar",
          label: "Calendar",
          description: "Google Calendar, Outlook",
        },
        {
          type: "whatsapp",
          label: "WhatsApp",
          description: "Messages and groups",
        },
        { type: "notion", label: "Notion", description: "Pages and databases" },
        {
          type: "google_docs",
          label: "Google Docs",
          description: "Documents and comments",
        },
        {
          type: "meeting_transcript",
          label: "Meetings",
          description: "Transcripts and recordings",
        },
      ],
    };
  }),

  /**
   * Get a single conversation by ID.
   */
  get: protectedProcedure
    .input(getConversationSchema)
    .query(async ({ ctx, input }) => {
      const orgId = await getActiveOrgId(ctx);
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, orgId);

      // Try to get from conversation table
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, input.conversationId),
        with: {
          sourceAccount: {
            columns: {
              type: true,
              displayName: true,
              organizationId: true,
            },
          },
        },
      });

      // Verify access
      if (!conv || conv.sourceAccount.organizationId !== orgId) {
        // Try legacy email thread
        const thread = await db.query.emailThread.findFirst({
          where: eq(emailThread.id, input.conversationId),
          with: {
            account: {
              columns: { organizationId: true },
            },
          },
        });

        if (!thread || thread.account.organizationId !== orgId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found.",
          });
        }

        // Return email thread in unified format
        return {
          id: thread.id,
          sourceType: "email" as SourceType,
          sourceAccountId: thread.accountId,
          externalId: thread.providerThreadId,
          conversationType: "thread",
          title: thread.subject ?? "No subject",
          snippet: thread.snippet ?? "",
          brief: thread.briefSummary,
          participantIds: thread.participantEmails ?? [],
          messageCount: thread.messageCount ?? 0,
          lastMessageAt: thread.lastMessageAt,
          isRead: thread.isRead ?? false,
          isStarred: thread.isStarred ?? false,
          isArchived: thread.isArchived ?? false,
          priorityTier: thread.priorityTier,
          urgencyScore: thread.urgencyScore,
          importanceScore: thread.importanceScore,
          hasOpenLoops: thread.hasOpenLoops,
          openLoopCount: thread.openLoopCount,
          suggestedAction: thread.suggestedAction,
          isLegacy: true,
        };
      }

      return {
        id: conv.id,
        sourceType: conv.sourceAccount.type as SourceType,
        sourceAccountId: conv.sourceAccountId,
        externalId: conv.externalId,
        conversationType: conv.conversationType,
        title: conv.title ?? "No subject",
        snippet: conv.snippet ?? "",
        brief: conv.briefSummary,
        participantIds: conv.participantIds ?? [],
        messageCount: conv.messageCount ?? 0,
        lastMessageAt: conv.lastMessageAt,
        isRead: conv.isRead ?? false,
        isStarred: conv.isStarred ?? false,
        isArchived: conv.isArchived ?? false,
        priorityTier: conv.priorityTier,
        urgencyScore: conv.urgencyScore,
        importanceScore: conv.importanceScore,
        hasOpenLoops: conv.hasOpenLoops,
        openLoopCount: conv.openLoopCount,
        suggestedAction: conv.suggestedAction,
        isLegacy: false,
      };
    }),

  /**
   * Get messages for a conversation.
   */
  getMessages: protectedProcedure
    .input(getConversationSchema)
    .query(async ({ ctx, input }) => {
      const orgId = await getActiveOrgId(ctx);
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, orgId);

      // Try generic conversation first
      const conv = await db.query.conversation.findFirst({
        where: eq(conversation.id, input.conversationId),
        with: {
          sourceAccount: {
            columns: { organizationId: true, type: true },
          },
        },
      });

      if (conv && conv.sourceAccount.organizationId === orgId) {
        // Get messages from generic message table
        const messages = await db.query.message.findMany({
          where: eq(message.conversationId, input.conversationId),
          orderBy: (m, { asc }) => [asc(m.messageIndex)],
        });

        return {
          messages: messages.map((m) => ({
            id: m.id,
            conversationId: m.conversationId,
            externalId: m.externalId,
            from: {
              id: m.senderExternalId,
              email: m.senderEmail,
              name: m.senderName,
            },
            recipients: m.recipientIds as Array<{
              id: string;
              name?: string;
              type: string;
            }> | null,
            subject: m.subject,
            body: m.bodyText ?? "",
            bodyHtml: m.bodyHtml,
            date: m.sentAt ?? new Date(),
            isFromUser: m.isFromUser ?? false,
            messageIndex: m.messageIndex ?? 0,
          })),
          sourceType: conv.sourceAccount.type,
        };
      }

      // Fall back to email thread
      const thread = await db.query.emailThread.findFirst({
        where: eq(emailThread.id, input.conversationId),
        with: {
          account: {
            columns: { organizationId: true },
          },
          messages: {
            orderBy: (m, { asc }) => [asc(m.messageIndex)],
          },
        },
      });

      if (!thread || thread.account.organizationId !== orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }

      return {
        messages: thread.messages.map((m) => ({
          id: m.id,
          conversationId: input.conversationId,
          externalId: m.providerMessageId,
          from: {
            id: m.fromEmail,
            email: m.fromEmail,
            name: m.fromName,
          },
          recipients: [
            ...(
              (m.toRecipients as Array<{ email: string; name?: string }>) ?? []
            ).map((r) => ({
              id: r.email,
              email: r.email,
              name: r.name,
              type: "to",
            })),
            ...(
              (m.ccRecipients as Array<{ email: string; name?: string }>) ?? []
            ).map((r) => ({
              id: r.email,
              email: r.email,
              name: r.name,
              type: "cc",
            })),
          ],
          subject: m.subject,
          body: m.bodyText ?? "",
          bodyHtml: m.bodyHtml,
          date: m.sentAt ?? m.receivedAt ?? new Date(),
          isFromUser: m.isFromUser ?? false,
          messageIndex: m.messageIndex ?? 0,
        })),
        sourceType: "email",
      };
    }),

  /**
   * Mark conversation as read/unread.
   * Uses transaction to ensure both tables are updated atomically.
   */
  markRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        read: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        // Update in conversation table
        await tx
          .update(conversation)
          .set({ isRead: input.read, updatedAt: new Date() })
          .where(eq(conversation.id, input.conversationId));

        // Also try email thread (for backward compatibility)
        await tx
          .update(emailThread)
          .set({ isRead: input.read, updatedAt: new Date() })
          .where(eq(emailThread.id, input.conversationId));
      });

      return { success: true };
    }),

  /**
   * Star/unstar conversation.
   * Uses transaction to ensure both tables are updated atomically.
   */
  star: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        starred: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        await tx
          .update(conversation)
          .set({ isStarred: input.starred, updatedAt: new Date() })
          .where(eq(conversation.id, input.conversationId));

        await tx
          .update(emailThread)
          .set({ isStarred: input.starred, updatedAt: new Date() })
          .where(eq(emailThread.id, input.conversationId));
      });

      return { success: true };
    }),

  /**
   * Archive conversation.
   * Uses transaction to ensure both tables are updated atomically.
   */
  archive: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        await tx
          .update(conversation)
          .set({ isArchived: true, updatedAt: new Date() })
          .where(eq(conversation.id, input.conversationId));

        await tx
          .update(emailThread)
          .set({ isArchived: true, updatedAt: new Date() })
          .where(eq(emailThread.id, input.conversationId));
      });

      return { success: true };
    }),

  /**
   * Delete/trash conversation.
   * Uses transaction to ensure both tables are updated atomically.
   */
  delete: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        // Soft delete in conversation table
        await tx
          .update(conversation)
          .set({ isTrashed: true, updatedAt: new Date() })
          .where(eq(conversation.id, input.conversationId));

        // Also soft delete in emailThread table (for backward compatibility)
        await tx
          .update(emailThread)
          .set({ isTrashed: true, updatedAt: new Date() })
          .where(eq(emailThread.id, input.conversationId));
      });

      return { success: true };
    }),

  /**
   * Restore a trashed conversation.
   * Uses transaction to ensure both tables are updated atomically.
   */
  restore: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx, input }) => {
      await db.transaction(async (tx) => {
        // Restore in conversation table
        await tx
          .update(conversation)
          .set({ isTrashed: false, updatedAt: new Date() })
          .where(eq(conversation.id, input.conversationId));

        // Also restore in emailThread table (for backward compatibility)
        await tx
          .update(emailThread)
          .set({ isTrashed: false, updatedAt: new Date() })
          .where(eq(emailThread.id, input.conversationId));
      });

      return { success: true };
    }),
});

// =============================================================================
// FALLBACK FUNCTIONS (for backward compatibility with email-only)
// =============================================================================

/**
 * Fall back to email-based inbox when no source accounts are configured.
 */
async function getEmailFallbackInbox(
  ctx: {
    session: {
      user: { id: string };
      session: { activeOrganizationId: string | null };
    };
  },
  input: z.infer<typeof listInboxSchema>,
  orgId: string
): Promise<{ items: UnifiedFeedItem[]; total: number; hasMore: boolean }> {
  // Get email accounts
  const accounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, orgId),
    columns: { id: true },
  });

  if (accounts.length === 0) {
    return { items: [], total: 0, hasMore: false };
  }

  const accountIds = accounts.map((a) => a.id);

  // Build conditions
  const conditions = [inArray(emailThread.accountId, accountIds)];

  // Status filters
  if (input.status && input.status.length > 0) {
    const statusConditions = [];
    if (input.status.includes("unread")) {
      statusConditions.push(eq(emailThread.isRead, false));
    }
    if (input.status.includes("starred")) {
      statusConditions.push(eq(emailThread.isStarred, true));
    }
    if (input.status.includes("archived")) {
      statusConditions.push(eq(emailThread.isArchived, true));
    }
    if (statusConditions.length > 0) {
      conditions.push(or(...statusConditions));
    }
  } else {
    conditions.push(eq(emailThread.isArchived, false));
  }

  // Priority filters
  if (input.priority && input.priority.length > 0) {
    conditions.push(inArray(emailThread.priorityTier, input.priority));
  }

  // Intelligence filters
  if (input.hasOpenLoops !== undefined) {
    conditions.push(eq(emailThread.hasOpenLoops, input.hasOpenLoops));
  }

  if (input.needsResponse) {
    conditions.push(eq(emailThread.suggestedAction, "respond"));
  }

  // Date range
  if (input.after) {
    conditions.push(gte(emailThread.lastMessageAt, input.after));
  }
  if (input.before) {
    conditions.push(lte(emailThread.lastMessageAt, input.before));
  }

  // Search
  if (input.search) {
    const searchPattern = `%${input.search}%`;
    conditions.push(
      or(
        sql`${emailThread.subject} ILIKE ${searchPattern}`,
        sql`${emailThread.snippet} ILIKE ${searchPattern}`
      )
    );
  }

  // Count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThread)
    .where(and(...conditions));

  const total = countResult?.count ?? 0;

  // Get threads
  const threads = await db.query.emailThread.findMany({
    where: and(...conditions),
    limit: input.limit,
    offset: input.offset,
    orderBy: [desc(emailThread.lastMessageAt)],
  });

  // Batch lookup commitments and decisions for these threads
  // For legacy emailThread, we need to find matching conversations by externalId
  const threadExternalIds = threads
    .map((t) => t.providerThreadId)
    .filter(Boolean) as string[];

  // Find conversations that match these email threads
  const matchingConversations =
    threadExternalIds.length > 0
      ? await db
          .select({ id: conversation.id, externalId: conversation.externalId })
          .from(conversation)
          .where(inArray(conversation.externalId, threadExternalIds))
      : [];

  const conversationIds = matchingConversations.map((c) => c.id);
  const externalIdToConversationId = new Map(
    matchingConversations.map((c) => [c.externalId, c.id])
  );

  // Batch lookup commitments
  const commitmentCounts =
    conversationIds.length > 0
      ? await db
          .select({
            conversationId: commitment.sourceConversationId,
            count: sql<number>`count(*)::int`,
          })
          .from(commitment)
          .where(inArray(commitment.sourceConversationId, conversationIds))
          .groupBy(commitment.sourceConversationId)
      : [];

  const commitmentMap = new Map(
    commitmentCounts.map((c) => [c.conversationId, c.count])
  );

  // Batch lookup decisions
  const decisionCounts =
    conversationIds.length > 0
      ? await db
          .select({
            conversationId: decision.sourceConversationId,
            count: sql<number>`count(*)::int`,
          })
          .from(decision)
          .where(inArray(decision.sourceConversationId, conversationIds))
          .groupBy(decision.sourceConversationId)
      : [];

  const decisionMap = new Map(
    decisionCounts.map((d) => [d.conversationId, d.count])
  );

  // Batch lookup for tasks linked to conversations
  const linkedTasks =
    conversationIds.length > 0
      ? await db
          .select({
            conversationId: task.sourceConversationId,
            taskId: task.id,
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            assigneeName: user.name,
            assigneeEmail: user.email,
            assigneeImage: user.image,
          })
          .from(task)
          .leftJoin(user, eq(task.assigneeId, user.id))
          .where(inArray(task.sourceConversationId, conversationIds))
      : [];

  const taskMap = new Map(
    linkedTasks.map((t) => [
      t.conversationId,
      {
        id: t.taskId,
        status: t.status as TaskStatus,
        priority: t.priority as TaskPriority,
        assignee: t.assigneeId
          ? {
              id: t.assigneeId,
              name: t.assigneeName,
              email: t.assigneeEmail ?? "",
              image: t.assigneeImage,
            }
          : null,
      },
    ])
  );

  // Transform to UnifiedFeedItem
  const items: UnifiedFeedItem[] = threads.map((t) => {
    const convId = t.providerThreadId
      ? externalIdToConversationId.get(t.providerThreadId)
      : undefined;
    const linkedTask = convId ? taskMap.get(convId) : undefined;
    return {
      id: t.id,
      sourceType: "email" as SourceType,
      sourceAccountId: t.accountId,
      externalId: t.providerThreadId,
      conversationType: "thread",
      title: t.subject ?? "No subject",
      snippet: t.snippet ?? "",
      brief: t.briefSummary,
      participants: (t.participantEmails ?? []).map((email) => ({
        id: email as string,
        email: email as string,
      })),
      messageCount: t.messageCount ?? 0,
      lastMessageAt: t.lastMessageAt,
      isRead: t.isRead ?? false,
      isStarred: t.isStarred ?? false,
      isArchived: t.isArchived ?? false,
      priorityTier: t.priorityTier,
      urgencyScore: t.urgencyScore,
      importanceScore: t.importanceScore,
      hasOpenLoops: t.hasOpenLoops,
      openLoopCount: t.openLoopCount,
      suggestedAction: t.suggestedAction,
      hasCommitments: convId ? (commitmentMap.get(convId) ?? 0) > 0 : false,
      hasDecisions: convId ? (decisionMap.get(convId) ?? 0) > 0 : false,
      task: linkedTask,
    };
  });

  return { items, total, hasMore: input.offset + items.length < total };
}

/**
 * Fall back to email stats when no source accounts are configured.
 */
async function getEmailFallbackStats(
  ctx: { session: { user: { id: string } } },
  orgId: string
): Promise<UnifiedInboxStats> {
  const accounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, orgId),
    columns: { id: true },
  });

  if (accounts.length === 0) {
    return {
      total: 0,
      unread: 0,
      bySource: {},
      byPriority: { urgent: 0, high: 0, medium: 0, low: 0 },
    };
  }

  const accountIds = accounts.map((a) => a.id);

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThread)
    .where(
      and(
        inArray(emailThread.accountId, accountIds),
        eq(emailThread.isArchived, false)
      )
    );

  const [unreadResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThread)
    .where(
      and(
        inArray(emailThread.accountId, accountIds),
        eq(emailThread.isArchived, false),
        eq(emailThread.isRead, false)
      )
    );

  return {
    total: totalResult?.count ?? 0,
    unread: unreadResult?.count ?? 0,
    bySource: {
      email: {
        total: totalResult?.count ?? 0,
        unread: unreadResult?.count ?? 0,
      },
    },
    byPriority: { urgent: 0, high: 0, medium: 0, low: 0 },
  };
}

/**
 * Get combined inbox from both conversation table and legacy emailThread table.
 * This is used when showing "all" sources and there are both new source accounts
 * and legacy email accounts.
 */
async function getCombinedInbox(
  _ctx: unknown,
  input: z.infer<typeof listInboxSchema>,
  orgId: string,
  sourceAccountIds: string[]
): Promise<{ items: UnifiedFeedItem[]; total: number; hasMore: boolean }> {
  // Get legacy email accounts
  const emailAccounts = await db.query.emailAccount.findMany({
    where: eq(emailAccount.organizationId, orgId),
    columns: { id: true },
  });
  const emailAccountIds = emailAccounts.map((a) => a.id);

  // Build base conditions for status filters
  const buildStatusConditions = (
    isReadCol: any,
    isStarredCol: any,
    isArchivedCol: any
  ) => {
    if (input.status && input.status.length > 0) {
      const statusConditions = [];
      if (input.status.includes("unread")) {
        statusConditions.push(eq(isReadCol, false));
      }
      if (input.status.includes("read")) {
        statusConditions.push(eq(isReadCol, true));
      }
      if (input.status.includes("starred")) {
        statusConditions.push(eq(isStarredCol, true));
      }
      if (input.status.includes("archived")) {
        statusConditions.push(eq(isArchivedCol, true));
      }
      return statusConditions.length > 0 ? or(...statusConditions) : undefined;
    }
    // Default: exclude archived
    return eq(isArchivedCol, false);
  };

  // Get items from conversation table (new sources)
  const convConditions = [
    inArray(conversation.sourceAccountId, sourceAccountIds),
  ];
  const convStatusCond = buildStatusConditions(
    conversation.isRead,
    conversation.isStarred,
    conversation.isArchived
  );
  if (convStatusCond) convConditions.push(convStatusCond);
  if (input.priority && input.priority.length > 0) {
    convConditions.push(inArray(conversation.priorityTier, input.priority));
  }

  // Fetch enough items to cover offset + limit from each table
  // This ensures we can properly merge and paginate across both sources
  const fetchLimit = input.offset + input.limit + 1;

  const conversations = await db
    .select({
      id: conversation.id,
      sourceAccountId: conversation.sourceAccountId,
      externalId: conversation.externalId,
      conversationType: conversation.conversationType,
      title: conversation.title,
      snippet: conversation.snippet,
      briefSummary: conversation.briefSummary,
      participantIds: conversation.participantIds,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt,
      isRead: conversation.isRead,
      isStarred: conversation.isStarred,
      isArchived: conversation.isArchived,
      priorityTier: conversation.priorityTier,
      urgencyScore: conversation.urgencyScore,
      importanceScore: conversation.importanceScore,
      hasOpenLoops: conversation.hasOpenLoops,
      openLoopCount: conversation.openLoopCount,
      suggestedAction: conversation.suggestedAction,
      metadata: conversation.metadata,
      sourceType: sourceAccount.type,
      sourceDisplayName: sourceAccount.displayName,
    })
    .from(conversation)
    .innerJoin(
      sourceAccount,
      eq(conversation.sourceAccountId, sourceAccount.id)
    )
    .where(and(...convConditions))
    .orderBy(desc(conversation.lastMessageAt))
    .limit(fetchLimit);

  // Get items from emailThread table (legacy emails)
  const emailConditions = [inArray(emailThread.accountId, emailAccountIds)];
  const emailStatusCond = buildStatusConditions(
    emailThread.isRead,
    emailThread.isStarred,
    emailThread.isArchived
  );
  if (emailStatusCond) emailConditions.push(emailStatusCond);
  if (input.priority && input.priority.length > 0) {
    emailConditions.push(inArray(emailThread.priorityTier, input.priority));
  }

  const threads = await db.query.emailThread.findMany({
    where: and(...emailConditions),
    limit: fetchLimit,
    orderBy: [desc(emailThread.lastMessageAt)],
  });

  // Get all IDs for commitment/decision lookup
  const allConvIds = conversations.map((c) => c.id);
  const allThreadIds = threads.map((t) => t.id);
  const allIds = [...allConvIds, ...allThreadIds];

  // Batch lookup for commitments
  const commitmentCounts =
    allIds.length > 0
      ? await db
          .select({
            conversationId: commitment.sourceConversationId,
            count: sql<number>`count(*)::int`,
          })
          .from(commitment)
          .where(inArray(commitment.sourceConversationId, allIds))
          .groupBy(commitment.sourceConversationId)
      : [];

  // Batch lookup for decisions
  const decisionCounts =
    allIds.length > 0
      ? await db
          .select({
            conversationId: decision.sourceConversationId,
            count: sql<number>`count(*)::int`,
          })
          .from(decision)
          .where(inArray(decision.sourceConversationId, allIds))
          .groupBy(decision.sourceConversationId)
      : [];

  // Batch lookup for tasks linked to conversations
  const linkedTasks =
    allConvIds.length > 0
      ? await db
          .select({
            conversationId: task.sourceConversationId,
            taskId: task.id,
            status: task.status,
            priority: task.priority,
            assigneeId: task.assigneeId,
            assigneeName: user.name,
            assigneeEmail: user.email,
            assigneeImage: user.image,
          })
          .from(task)
          .leftJoin(user, eq(task.assigneeId, user.id))
          .where(inArray(task.sourceConversationId, allConvIds))
      : [];

  // Create lookup maps
  const commitmentMap = new Map(
    commitmentCounts.map((c) => [c.conversationId, c.count])
  );
  const decisionMap = new Map(
    decisionCounts.map((d) => [d.conversationId, d.count])
  );
  const taskMap = new Map(
    linkedTasks.map((t) => [
      t.conversationId,
      {
        id: t.taskId,
        status: t.status as TaskStatus,
        priority: t.priority as TaskPriority,
        assignee: t.assigneeId
          ? {
              id: t.assigneeId,
              name: t.assigneeName,
              email: t.assigneeEmail ?? "",
              image: t.assigneeImage,
            }
          : null,
      },
    ])
  );

  // Transform and merge results
  const convItems: UnifiedFeedItem[] = conversations.map((c) => ({
    id: c.id,
    sourceType: c.sourceType as SourceType,
    sourceAccountId: c.sourceAccountId,
    sourceAccountName:
      c.sourceDisplayName ?? getSourceDisplayName(c.sourceType),
    externalId: c.externalId,
    conversationType: c.conversationType,
    title: c.title ?? "No subject",
    snippet: c.snippet ?? "",
    brief: c.briefSummary,
    participants: (c.participantIds ?? []).map((id) => ({
      id: id as string,
      name: undefined,
      email: id as string,
    })),
    messageCount: c.messageCount ?? 0,
    lastMessageAt: c.lastMessageAt,
    isRead: c.isRead ?? false,
    isStarred: c.isStarred ?? false,
    isArchived: c.isArchived ?? false,
    priorityTier: c.priorityTier,
    urgencyScore: c.urgencyScore,
    importanceScore: c.importanceScore,
    hasOpenLoops: c.hasOpenLoops,
    openLoopCount: c.openLoopCount,
    suggestedAction: c.suggestedAction,
    hasCommitments: (commitmentMap.get(c.id) ?? 0) > 0,
    hasDecisions: (decisionMap.get(c.id) ?? 0) > 0,
    task: taskMap.get(c.id),
    metadata: c.metadata as Record<string, unknown> | undefined,
  }));

  const emailItems: UnifiedFeedItem[] = threads.map((t) => ({
    id: t.id,
    sourceType: "email" as SourceType,
    sourceAccountId: t.accountId,
    externalId: t.providerThreadId,
    conversationType: "thread",
    title: t.subject ?? "No subject",
    snippet: t.snippet ?? "",
    brief: t.briefSummary,
    participants: (t.participantEmails ?? []).map((email) => ({
      id: email as string,
      email: email as string,
    })),
    messageCount: t.messageCount ?? 0,
    lastMessageAt: t.lastMessageAt,
    isRead: t.isRead ?? false,
    isStarred: t.isStarred ?? false,
    isArchived: t.isArchived ?? false,
    priorityTier: t.priorityTier,
    urgencyScore: t.urgencyScore,
    importanceScore: t.importanceScore,
    hasOpenLoops: t.hasOpenLoops,
    openLoopCount: t.openLoopCount,
    suggestedAction: t.suggestedAction,
    hasCommitments: (commitmentMap.get(t.id) ?? 0) > 0,
    hasDecisions: (decisionMap.get(t.id) ?? 0) > 0,
  }));

  // Merge and sort by lastMessageAt
  const allItems = [...convItems, ...emailItems].sort((a, b) => {
    const aTime = a.lastMessageAt?.getTime() ?? 0;
    const bTime = b.lastMessageAt?.getTime() ?? 0;
    return bTime - aTime; // Descending order
  });

  // Apply pagination - start at offset, take limit items
  const paginatedItems = allItems.slice(
    input.offset,
    input.offset + input.limit
  );

  // Determine if there are more items after this page
  const hasMore = allItems.length > input.offset + input.limit;

  // Get total counts for accurate pagination info
  const [convCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(conversation)
    .where(and(...convConditions));

  const [emailCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(emailThread)
    .where(and(...emailConditions));

  const total = (convCount?.count ?? 0) + (emailCount?.count ?? 0);

  return {
    items: paginatedItems,
    total,
    hasMore,
  };
}
