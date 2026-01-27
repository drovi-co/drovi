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
  isDone: boolean;
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
  starred: number;
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
  status: z
    .array(z.enum(["unread", "starred", "archived", "read", "done"]))
    .optional(),
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
  session: { session: { activeOrganizationId?: string | null } };
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

      // If no source accounts found for the requested types
      if (accountIds.length === 0) {
        // Return empty - no source accounts for this type
        return { items: [], total: 0, hasMore: false };
      }

      // All email accounts are now in the unified sourceAccount table
      // No need for legacy emailAccount checking

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
        if (input.status.includes("done")) {
          statusConditions.push(eq(conversation.isDone, true));
        }
        if (statusConditions.length > 0) {
          conditions.push(or(...statusConditions));
        }
      } else {
        // Default: exclude archived and done
        conditions.push(eq(conversation.isArchived, false));
        conditions.push(eq(conversation.isDone, false));
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
          isDone: conversation.isDone,
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
        if (!uio.conversationId) {
          continue;
        }
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
          isDone: c.isDone ?? false,
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

    // If no source accounts, return empty stats
    if (accountIds.length === 0) {
      return { total: 0, unread: 0, starred: 0, bySource: {}, byPriority: {} };
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

    const [starredResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(
        and(
          inArray(conversation.sourceAccountId, accountIds),
          eq(conversation.isArchived, false),
          eq(conversation.isStarred, true)
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
      starred: starredResult?.count ?? 0,
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

    // Build sources list from unified sourceAccount table
    const allSources = sources.map((s) => ({
      id: s.id,
      type: s.type as SourceType,
      provider: s.provider,
      identifier: s.externalId,
      displayName: s.displayName ?? getSourceDisplayName(s.type),
      status: s.status,
      lastSyncAt: s.lastSyncAt,
      isLegacy: false,
    }));

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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }

      // Fetch linked UIOs for this conversation
      const linkedUIOs = await db
        .select({
          uioId: unifiedIntelligenceObject.id,
          type: unifiedIntelligenceObject.type,
          title: unifiedIntelligenceObject.canonicalTitle,
          status: unifiedIntelligenceObject.status,
          dueDate: unifiedIntelligenceObject.dueDate,
          conversationId: unifiedObjectSource.conversationId,
        })
        .from(unifiedObjectSource)
        .innerJoin(
          unifiedIntelligenceObject,
          eq(unifiedObjectSource.unifiedObjectId, unifiedIntelligenceObject.id)
        )
        .where(
          and(
            eq(unifiedObjectSource.conversationId, input.conversationId),
            eq(unifiedIntelligenceObject.organizationId, orgId)
          )
        );

      // Get UIO IDs for source breadcrumb lookup
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

      // Build unified objects array
      const unifiedObjects: LinkedUIO[] = linkedUIOs.map((uio) => {
        const sourceTypeMap = uioSourceMap.get(uio.uioId);
        const sourceBreadcrumbs: SourceBreadcrumb[] = sourceTypeMap
          ? Array.from(sourceTypeMap.entries()).map(([sourceType, count]) => ({
              sourceType,
              count,
              sourceName: getSourceDisplayName(sourceType),
            }))
          : [];

        return {
          id: uio.uioId,
          type: uio.type as "commitment" | "decision" | "topic",
          title: uio.title ?? "Untitled",
          dueDate: uio.dueDate,
          status: uio.status,
          sourceBreadcrumbs,
        };
      });

      // Extract participant names from metadata
      const participants = extractParticipants(
        conv.participantIds ?? [],
        conv.metadata as Record<string, unknown> | undefined,
        conv.sourceAccount.type as SourceType
      );

      return {
        id: conv.id,
        sourceType: conv.sourceAccount.type as SourceType,
        sourceAccountId: conv.sourceAccountId,
        sourceAccountName:
          conv.sourceAccount.displayName ??
          getSourceDisplayName(conv.sourceAccount.type),
        externalId: conv.externalId,
        conversationType: conv.conversationType,
        title: conv.title ?? "No subject",
        snippet: conv.snippet ?? "",
        brief: conv.briefSummary,
        participants,
        participantIds: conv.participantIds ?? [],
        messageCount: conv.messageCount ?? 0,
        lastMessageAt: conv.lastMessageAt,
        isRead: conv.isRead ?? false,
        isStarred: conv.isStarred ?? false,
        isArchived: conv.isArchived ?? false,
        isDone: conv.isDone ?? false,
        priorityTier: conv.priorityTier,
        urgencyScore: conv.urgencyScore,
        importanceScore: conv.importanceScore,
        hasOpenLoops: conv.hasOpenLoops,
        openLoopCount: conv.openLoopCount,
        suggestedAction: conv.suggestedAction,
        unifiedObjects,
        isLegacy: false,
      };
    }),

  /**
   * Get related conversations that share UIOs with the given conversation.
   * Only considers meaningful UIO types (commitment, decision, task) - not briefs or topics
   * which are often 1:1 with conversations or too generic.
   */
  getRelatedConversations: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        limit: z.number().int().min(1).max(20).default(5),
      })
    )
    .query(async ({ ctx, input }) => {
      const orgId = await getActiveOrgId(ctx);
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, orgId);

      // Only consider meaningful UIO types that create real relationships
      // Excludes: brief (1:1 with conversation), topic (too generic), claim (too granular)
      const meaningfulTypes = [
        "commitment",
        "decision",
        "task",
        "risk",
        "project",
      ] as const;

      // First, get meaningful UIOs linked to this conversation
      const linkedUIOs = await db
        .select({
          uioId: unifiedObjectSource.unifiedObjectId,
          uioType: unifiedIntelligenceObject.type,
          uioTitle: unifiedIntelligenceObject.canonicalTitle,
        })
        .from(unifiedObjectSource)
        .innerJoin(
          unifiedIntelligenceObject,
          eq(unifiedObjectSource.unifiedObjectId, unifiedIntelligenceObject.id)
        )
        .where(
          and(
            eq(unifiedObjectSource.conversationId, input.conversationId),
            eq(unifiedIntelligenceObject.organizationId, orgId),
            eq(unifiedIntelligenceObject.status, "active"),
            inArray(unifiedIntelligenceObject.type, meaningfulTypes)
          )
        );

      if (linkedUIOs.length === 0) {
        return { conversations: [] };
      }

      const uioIds = linkedUIOs.map((u) => u.uioId);

      // Find other conversations that share these specific UIOs
      const relatedSources = await db
        .select({
          conversationId: unifiedObjectSource.conversationId,
          uioId: unifiedObjectSource.unifiedObjectId,
          uioType: unifiedIntelligenceObject.type,
        })
        .from(unifiedObjectSource)
        .innerJoin(
          unifiedIntelligenceObject,
          eq(unifiedObjectSource.unifiedObjectId, unifiedIntelligenceObject.id)
        )
        .where(
          and(
            inArray(unifiedObjectSource.unifiedObjectId, uioIds),
            sql`${unifiedObjectSource.conversationId} != ${input.conversationId}`,
            sql`${unifiedObjectSource.conversationId} IS NOT NULL`,
            inArray(unifiedIntelligenceObject.type, meaningfulTypes)
          )
        );

      if (relatedSources.length === 0) {
        return { conversations: [] };
      }

      // Group by conversation to count shared UIOs
      const conversationUIOCounts = new Map<string, Map<string, number>>();
      for (const source of relatedSources) {
        if (!source.conversationId) {
          continue;
        }
        if (!conversationUIOCounts.has(source.conversationId)) {
          conversationUIOCounts.set(source.conversationId, new Map());
        }
        const typeCounts = conversationUIOCounts.get(source.conversationId)!;
        typeCounts.set(
          source.uioType,
          (typeCounts.get(source.uioType) ?? 0) + 1
        );
      }

      // Get unique conversation IDs
      const relatedConvIds = [...conversationUIOCounts.keys()];

      // Fetch conversation details
      const relatedConversations = await db
        .select({
          id: conversation.id,
          title: conversation.title,
          lastMessageAt: conversation.lastMessageAt,
          sourceType: sourceAccount.type,
          sourceDisplayName: sourceAccount.displayName,
        })
        .from(conversation)
        .innerJoin(
          sourceAccount,
          eq(conversation.sourceAccountId, sourceAccount.id)
        )
        .where(
          and(
            inArray(conversation.id, relatedConvIds),
            eq(sourceAccount.organizationId, orgId)
          )
        )
        .orderBy(desc(conversation.lastMessageAt))
        .limit(input.limit);

      // Build response with shared UIO counts
      const result = relatedConversations.map((conv) => {
        const typeCounts = conversationUIOCounts.get(conv.id);
        const sharedUIOs: Array<{ type: string; count: number }> = [];
        if (typeCounts) {
          for (const [type, count] of typeCounts.entries()) {
            sharedUIOs.push({ type, count });
          }
        }

        return {
          conversation: {
            id: conv.id,
            title: conv.title ?? "No subject",
            sourceType: conv.sourceType,
            sourceDisplayName:
              conv.sourceDisplayName ?? getSourceDisplayName(conv.sourceType),
            lastMessageAt: conv.lastMessageAt,
          },
          sharedUIOs,
        };
      });

      return { conversations: result };
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
            recipients: m.recipients as Array<{
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

      // Conversation not found
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found.",
      });
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
    .mutation(async ({ ctx: _ctx, input }) => {
      // Update in conversation table
      await db
        .update(conversation)
        .set({ isRead: input.read, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),

  /**
   * Star/unstar conversation.
   */
  star: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        starred: z.boolean(),
      })
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(conversation)
        .set({ isStarred: input.starred, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),

  /**
   * Archive conversation.
   */
  archive: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(conversation)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),

  /**
   * Mark conversation as done/not done (treated).
   */
  markDone: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        done: z.boolean(),
      })
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(conversation)
        .set({ isDone: input.done, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),

  /**
   * Delete/trash conversation.
   */
  delete: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(conversation)
        .set({ isTrashed: true, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),

  /**
   * Restore a trashed conversation.
   */
  restore: protectedProcedure
    .input(getConversationSchema)
    .mutation(async ({ ctx: _ctx, input }) => {
      await db
        .update(conversation)
        .set({ isTrashed: false, updatedAt: new Date() })
        .where(eq(conversation.id, input.conversationId));

      return { success: true };
    }),
});
