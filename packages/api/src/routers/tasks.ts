// =============================================================================
// TASKS ROUTER
// =============================================================================
//
// API for managing tasks (Linear-style task management).
// All conversations, commitments, and decisions are automatically tasks.
// Users can also create manual tasks.
//

import { db } from "@memorystack/db";
import {
  commitment,
  conversation,
  decision,
  member,
  type TaskMetadata,
  type TaskPriority,
  type TaskSourceType,
  type TaskStatus,
  task,
  taskActivity,
  taskLabel,
  taskLabelJunction,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
]);

const taskPrioritySchema = z.enum([
  "no_priority",
  "low",
  "medium",
  "high",
  "urgent",
]);

const taskSourceTypeSchema = z.enum([
  "conversation",
  "commitment",
  "decision",
  "manual",
]);

const listTasksSchema = z.object({
  organizationId: z.string().min(1),
  // High limit for client-side pagination - UI handles "Show more" display
  limit: z.number().int().min(1).max(10_000).optional(),
  offset: z.number().int().min(0).default(0),
  // Filters
  status: taskStatusSchema.optional(),
  statuses: z.array(taskStatusSchema).optional(),
  priority: taskPrioritySchema.optional(),
  priorities: z.array(taskPrioritySchema).optional(),
  sourceType: taskSourceTypeSchema.optional(),
  sourceTypes: z.array(taskSourceTypeSchema).optional(),
  assigneeId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  // Search filter - matches title
  search: z.string().optional(),
  // Date filters
  dueAfter: z.date().optional(),
  dueBefore: z.date().optional(),
  // Sorting
  sortBy: z
    .enum(["createdAt", "updatedAt", "dueDate", "priority", "status"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const getTaskSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
});

const createTaskSchema = z.object({
  organizationId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
  status: taskStatusSchema.default("backlog"),
  priority: taskPrioritySchema.default("no_priority"),
  assigneeId: z.string().optional(),
  dueDate: z.date().optional(),
  sourceType: taskSourceTypeSchema.default("manual"),
  // Optional source linking for manual tasks
  sourceConversationId: z.string().optional(),
  sourceCommitmentId: z.string().optional(),
  sourceDecisionId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
});

const updateTaskSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.date().nullable().optional(),
});

const updateStatusSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  status: taskStatusSchema,
});

const updatePrioritySchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  priority: taskPrioritySchema,
});

const assignTaskSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  assigneeId: z.string().nullable(),
});

const bulkUpdateSchema = z.object({
  organizationId: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1).max(100),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().nullable().optional(),
});

const labelSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#6B7280"),
});

const updateLabelSchema = z.object({
  organizationId: z.string().min(1),
  labelId: z.string().min(1),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

const taskLabelSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  labelId: z.string().min(1),
});

const addCommentSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  comment: z.string().min(1).max(5000),
});

// =============================================================================
// HELPERS
// =============================================================================

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

async function verifyTaskAccess(
  organizationId: string,
  taskId: string
): Promise<typeof task.$inferSelect> {
  const found = await db.query.task.findFirst({
    where: eq(task.id, taskId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Task not found.",
    });
  }

  return found;
}

async function verifyLabelAccess(
  organizationId: string,
  labelId: string
): Promise<typeof taskLabel.$inferSelect> {
  const found = await db.query.taskLabel.findFirst({
    where: eq(taskLabel.id, labelId),
  });

  if (!found || found.organizationId !== organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Label not found.",
    });
  }

  return found;
}

async function logTaskActivity(
  taskId: string,
  userId: string,
  activityType: string,
  previousValue?: string | null,
  newValue?: string | null,
  comment?: string | null
): Promise<void> {
  await db.insert(taskActivity).values({
    taskId,
    userId,
    activityType,
    previousValue: previousValue ?? null,
    newValue: newValue ?? null,
    comment: comment ?? null,
  });
}

// =============================================================================
// ROUTER
// =============================================================================

export const tasksRouter = router({
  // ===========================================================================
  // TASK CRUD
  // ===========================================================================

  /**
   * List tasks with filters and pagination.
   */
  list: protectedProcedure
    .input(listTasksSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const conditions = [eq(task.organizationId, input.organizationId)];

      // Status filter
      if (input.status) {
        conditions.push(eq(task.status, input.status));
      } else if (input.statuses && input.statuses.length > 0) {
        conditions.push(inArray(task.status, input.statuses));
      }

      // Priority filter
      if (input.priority) {
        conditions.push(eq(task.priority, input.priority));
      } else if (input.priorities && input.priorities.length > 0) {
        conditions.push(inArray(task.priority, input.priorities));
      }

      // Source type filter
      if (input.sourceType) {
        conditions.push(eq(task.sourceType, input.sourceType));
      } else if (input.sourceTypes && input.sourceTypes.length > 0) {
        conditions.push(inArray(task.sourceType, input.sourceTypes));
      }

      // Assignee filter
      if (input.assigneeId) {
        conditions.push(eq(task.assigneeId, input.assigneeId));
      }

      // Due date filters
      if (input.dueAfter) {
        conditions.push(gte(task.dueDate, input.dueAfter));
      }
      if (input.dueBefore) {
        conditions.push(lte(task.dueDate, input.dueBefore));
      }

      // Search filter - case-insensitive title search
      if (input.search) {
        conditions.push(ilike(task.title, `%${input.search}%`));
      }

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(task)
        .where(and(...conditions));

      const total = countResult?.count ?? 0;

      // Build order by - special handling for dueDate to put nulls at the end
      const getOrderBy = () => {
        const direction = input.sortOrder === "asc" ? "ASC" : "DESC";

        switch (input.sortBy) {
          case "dueDate":
            // NULLS LAST ensures tasks without due dates appear at the end
            return [sql`${task.dueDate} ${sql.raw(direction)} NULLS LAST`];
          case "priority":
            return [
              sql`CASE
              WHEN ${task.priority} = 'urgent' THEN 5
              WHEN ${task.priority} = 'high' THEN 4
              WHEN ${task.priority} = 'medium' THEN 3
              WHEN ${task.priority} = 'low' THEN 2
              ELSE 1
            END ${sql.raw(direction)}`,
            ];
          case "status":
            return [
              sql`CASE
              WHEN ${task.status} = 'in_progress' THEN 5
              WHEN ${task.status} = 'in_review' THEN 4
              WHEN ${task.status} = 'todo' THEN 3
              WHEN ${task.status} = 'backlog' THEN 2
              WHEN ${task.status} = 'done' THEN 1
              ELSE 0
            END ${sql.raw(direction)}`,
            ];
          case "updatedAt":
            return input.sortOrder === "asc"
              ? [asc(task.updatedAt)]
              : [desc(task.updatedAt)];
          default:
            return input.sortOrder === "asc"
              ? [asc(task.createdAt)]
              : [desc(task.createdAt)];
        }
      };

      // Get tasks with relations
      // If no limit specified, fetch all tasks (client handles pagination with "Show more")
      const tasks = await db.query.task.findMany({
        where: and(...conditions),
        ...(input.limit ? { limit: input.limit } : {}),
        offset: input.offset,
        orderBy: getOrderBy(),
        with: {
          assignee: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          labelJunctions: {
            with: {
              label: true,
            },
          },
          sourceConversation: {
            columns: {
              id: true,
              title: true,
              snippet: true,
              conversationType: true,
            },
          },
          sourceCommitment: {
            columns: {
              id: true,
              title: true,
              description: true,
            },
          },
          sourceDecision: {
            columns: {
              id: true,
              title: true,
              statement: true,
            },
          },
        },
      });

      // Transform to flatten labels
      const transformedTasks = tasks.map((t) => ({
        ...t,
        labels: t.labelJunctions.map((lj) => lj.label),
        labelJunctions: undefined,
      }));

      return {
        tasks: transformedTasks,
        total,
        // If no limit, we fetched all, so no more. Otherwise check offset + fetched < total
        hasMore: input.limit ? input.offset + tasks.length < total : false,
      };
    }),

  /**
   * Get task by ID with full details.
   */
  getById: protectedProcedure
    .input(getTaskSchema)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const found = await db.query.task.findFirst({
        where: eq(task.id, input.taskId),
        with: {
          assignee: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          createdBy: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          labelJunctions: {
            with: {
              label: true,
            },
          },
          sourceConversation: {
            with: {
              sourceAccount: {
                columns: {
                  id: true,
                  type: true,
                  displayName: true,
                },
              },
              messages: {
                orderBy: (m, { asc: a }) => [a(m.messageIndex)],
                limit: 10,
              },
            },
          },
          sourceCommitment: {
            with: {
              debtor: {
                columns: {
                  id: true,
                  primaryEmail: true,
                  displayName: true,
                },
              },
              creditor: {
                columns: {
                  id: true,
                  primaryEmail: true,
                  displayName: true,
                },
              },
            },
          },
          sourceDecision: true,
          activities: {
            orderBy: (a, { desc: d }) => [d(a.createdAt)],
            limit: 50,
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                  image: true,
                },
              },
            },
          },
        },
      });

      if (!found || found.organizationId !== input.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Task not found.",
        });
      }

      // Transform to flatten labels
      return {
        ...found,
        labels: found.labelJunctions.map((lj) => lj.label),
        labelJunctions: undefined,
      };
    }),

  /**
   * Create a new task (manual task creation).
   */
  create: protectedProcedure
    .input(createTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify assignee if provided
      if (input.assigneeId) {
        const assigneeMembership = await db.query.member.findFirst({
          where: and(
            eq(member.userId, input.assigneeId),
            eq(member.organizationId, input.organizationId)
          ),
        });

        if (!assigneeMembership) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Assignee must be a member of the organization.",
          });
        }
      }

      // Build metadata
      const metadata: TaskMetadata = {};

      // If linking to existing source, verify access and populate metadata
      if (input.sourceConversationId) {
        const conv = await db.query.conversation.findFirst({
          where: eq(conversation.id, input.sourceConversationId),
          with: {
            sourceAccount: {
              columns: { id: true, type: true },
            },
          },
        });
        if (conv) {
          metadata.sourceTitle = conv.title ?? undefined;
          metadata.sourceAccountType = conv.sourceAccount?.type ?? undefined;
          metadata.sourceAccountId = conv.sourceAccount?.id ?? undefined;
        }
      }

      if (input.sourceCommitmentId) {
        const comm = await db.query.commitment.findFirst({
          where: eq(commitment.id, input.sourceCommitmentId),
        });
        if (comm) {
          metadata.sourceTitle = comm.title;
        }
      }

      if (input.sourceDecisionId) {
        const dec = await db.query.decision.findFirst({
          where: eq(decision.id, input.sourceDecisionId),
        });
        if (dec) {
          metadata.sourceTitle = dec.title;
        }
      }

      // Create task
      const [createdTask] = await db
        .insert(task)
        .values({
          organizationId: input.organizationId,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          assigneeId: input.assigneeId,
          dueDate: input.dueDate,
          sourceType: input.sourceType,
          sourceConversationId: input.sourceConversationId,
          sourceCommitmentId: input.sourceCommitmentId,
          sourceDecisionId: input.sourceDecisionId,
          createdById: userId,
          metadata: Object.keys(metadata).length > 0 ? metadata : null,
        })
        .returning();

      if (!createdTask) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create task",
        });
      }

      // Log activity
      await logTaskActivity(createdTask.id, userId, "created");

      // Add labels if provided
      if (input.labelIds && input.labelIds.length > 0) {
        for (const labelId of input.labelIds) {
          await verifyLabelAccess(input.organizationId, labelId);
        }

        await db.insert(taskLabelJunction).values(
          input.labelIds.map((labelId) => ({
            taskId: createdTask.id,
            labelId,
          }))
        );
      }

      return createdTask;
    }),

  /**
   * Update a task.
   */
  update: protectedProcedure
    .input(updateTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingTask = await verifyTaskAccess(
        input.organizationId,
        input.taskId
      );

      const updates: Partial<typeof task.$inferInsert> = {
        updatedAt: new Date(),
      };

      // Track changes for activity log
      const changes: Array<{
        type: string;
        prev: string | null;
        next: string | null;
      }> = [];

      if (input.title !== undefined && input.title !== existingTask.title) {
        updates.title = input.title;
        changes.push({
          type: "title_updated",
          prev: existingTask.title,
          next: input.title,
        });
      }

      if (
        input.description !== undefined &&
        input.description !== existingTask.description
      ) {
        updates.description = input.description;
        changes.push({
          type: "description_updated",
          prev: null,
          next: null,
        });
      }

      if (input.status !== undefined && input.status !== existingTask.status) {
        updates.status = input.status;
        if (input.status === "done") {
          updates.completedAt = new Date();
        } else if (existingTask.status === "done") {
          updates.completedAt = null;
        }
        changes.push({
          type: "status_changed",
          prev: existingTask.status,
          next: input.status,
        });
      }

      if (
        input.priority !== undefined &&
        input.priority !== existingTask.priority
      ) {
        updates.priority = input.priority;
        changes.push({
          type: "priority_changed",
          prev: existingTask.priority,
          next: input.priority,
        });
      }

      if (
        input.assigneeId !== undefined &&
        input.assigneeId !== existingTask.assigneeId
      ) {
        // Verify new assignee if not null
        if (input.assigneeId) {
          const assigneeMembership = await db.query.member.findFirst({
            where: and(
              eq(member.userId, input.assigneeId),
              eq(member.organizationId, input.organizationId)
            ),
          });

          if (!assigneeMembership) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Assignee must be a member of the organization.",
            });
          }
        }

        updates.assigneeId = input.assigneeId;
        changes.push({
          type: input.assigneeId ? "assigned" : "unassigned",
          prev: existingTask.assigneeId,
          next: input.assigneeId,
        });
      }

      if (input.dueDate !== undefined) {
        updates.dueDate = input.dueDate;
        changes.push({
          type: input.dueDate ? "due_date_set" : "due_date_removed",
          prev: existingTask.dueDate?.toISOString() ?? null,
          next: input.dueDate?.toISOString() ?? null,
        });
      }

      await db.update(task).set(updates).where(eq(task.id, input.taskId));

      // Log all changes
      for (const change of changes) {
        await logTaskActivity(
          input.taskId,
          userId,
          change.type,
          change.prev,
          change.next
        );
      }

      return { success: true };
    }),

  /**
   * Quick status update (optimized for drag-and-drop).
   */
  updateStatus: protectedProcedure
    .input(updateStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingTask = await verifyTaskAccess(
        input.organizationId,
        input.taskId
      );

      if (input.status === existingTask.status) {
        return { success: true };
      }

      const updates: Partial<typeof task.$inferInsert> = {
        status: input.status,
        updatedAt: new Date(),
      };

      if (input.status === "done") {
        updates.completedAt = new Date();
      } else if (existingTask.status === "done") {
        updates.completedAt = null;
      }

      await db.update(task).set(updates).where(eq(task.id, input.taskId));

      await logTaskActivity(
        input.taskId,
        userId,
        "status_changed",
        existingTask.status,
        input.status
      );

      return { success: true };
    }),

  /**
   * Quick priority update.
   */
  updatePriority: protectedProcedure
    .input(updatePrioritySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingTask = await verifyTaskAccess(
        input.organizationId,
        input.taskId
      );

      if (input.priority === existingTask.priority) {
        return { success: true };
      }

      await db
        .update(task)
        .set({
          priority: input.priority,
          updatedAt: new Date(),
        })
        .where(eq(task.id, input.taskId));

      await logTaskActivity(
        input.taskId,
        userId,
        "priority_changed",
        existingTask.priority,
        input.priority
      );

      return { success: true };
    }),

  /**
   * Assign task to user.
   */
  assign: protectedProcedure
    .input(assignTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      const existingTask = await verifyTaskAccess(
        input.organizationId,
        input.taskId
      );

      if (input.assigneeId === existingTask.assigneeId) {
        return { success: true };
      }

      // Verify new assignee if not null
      if (input.assigneeId) {
        const assigneeMembership = await db.query.member.findFirst({
          where: and(
            eq(member.userId, input.assigneeId),
            eq(member.organizationId, input.organizationId)
          ),
        });

        if (!assigneeMembership) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Assignee must be a member of the organization.",
          });
        }
      }

      await db
        .update(task)
        .set({
          assigneeId: input.assigneeId,
          updatedAt: new Date(),
        })
        .where(eq(task.id, input.taskId));

      await logTaskActivity(
        input.taskId,
        userId,
        input.assigneeId ? "assigned" : "unassigned",
        existingTask.assigneeId,
        input.assigneeId
      );

      return { success: true };
    }),

  /**
   * Delete (cancel) a task.
   */
  delete: protectedProcedure
    .input(getTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyTaskAccess(input.organizationId, input.taskId);

      // For tasks linked to sources, we just mark as cancelled
      // For manual tasks, we can hard delete
      const existingTask = await db.query.task.findFirst({
        where: eq(task.id, input.taskId),
      });

      if (existingTask?.sourceType === "manual") {
        // Hard delete manual tasks
        await db.delete(task).where(eq(task.id, input.taskId));
      } else {
        // Soft delete (mark as cancelled) for source-linked tasks
        await db
          .update(task)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(task.id, input.taskId));

        await logTaskActivity(input.taskId, userId, "cancelled");
      }

      return { success: true };
    }),

  /**
   * Bulk update multiple tasks.
   */
  bulkUpdate: protectedProcedure
    .input(bulkUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Verify all tasks belong to the organization
      const tasks = await db.query.task.findMany({
        where: and(
          inArray(task.id, input.taskIds),
          eq(task.organizationId, input.organizationId)
        ),
      });

      if (tasks.length !== input.taskIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Some tasks not found.",
        });
      }

      const updates: Partial<typeof task.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.status !== undefined) {
        updates.status = input.status;
        if (input.status === "done") {
          updates.completedAt = new Date();
        }
      }

      if (input.priority !== undefined) {
        updates.priority = input.priority;
      }

      if (input.assigneeId !== undefined) {
        if (input.assigneeId) {
          const assigneeMembership = await db.query.member.findFirst({
            where: and(
              eq(member.userId, input.assigneeId),
              eq(member.organizationId, input.organizationId)
            ),
          });

          if (!assigneeMembership) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Assignee must be a member of the organization.",
            });
          }
        }
        updates.assigneeId = input.assigneeId;
      }

      await db.update(task).set(updates).where(inArray(task.id, input.taskIds));

      // Log activity for each task
      for (const taskId of input.taskIds) {
        if (input.status !== undefined) {
          await logTaskActivity(
            taskId,
            userId,
            "status_changed",
            null,
            input.status
          );
        }
        if (input.priority !== undefined) {
          await logTaskActivity(
            taskId,
            userId,
            "priority_changed",
            null,
            input.priority
          );
        }
        if (input.assigneeId !== undefined) {
          await logTaskActivity(
            taskId,
            userId,
            input.assigneeId ? "assigned" : "unassigned",
            null,
            input.assigneeId
          );
        }
      }

      return { success: true, updatedCount: input.taskIds.length };
    }),

  // ===========================================================================
  // STATS & ACTIVITY
  // ===========================================================================

  /**
   * Get task statistics for dashboard.
   */
  getStats: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const allTasks = await db.query.task.findMany({
        where: eq(task.organizationId, input.organizationId),
        columns: {
          id: true,
          status: true,
          priority: true,
          sourceType: true,
          dueDate: true,
        },
      });

      const now = new Date();
      const weekFromNow = new Date();
      weekFromNow.setDate(weekFromNow.getDate() + 7);

      const byStatus: Record<TaskStatus, number> = {
        backlog: 0,
        todo: 0,
        in_progress: 0,
        in_review: 0,
        done: 0,
        cancelled: 0,
      };

      const byPriority: Record<TaskPriority, number> = {
        no_priority: 0,
        low: 0,
        medium: 0,
        high: 0,
        urgent: 0,
      };

      const bySourceType: Record<TaskSourceType, number> = {
        conversation: 0,
        commitment: 0,
        decision: 0,
        manual: 0,
      };

      let overdue = 0;
      let dueThisWeek = 0;

      for (const t of allTasks) {
        byStatus[t.status]++;
        byPriority[t.priority]++;
        bySourceType[t.sourceType]++;

        if (
          t.dueDate &&
          t.dueDate < now &&
          !["done", "cancelled"].includes(t.status)
        ) {
          overdue++;
        }

        if (
          t.dueDate &&
          t.dueDate >= now &&
          t.dueDate <= weekFromNow &&
          !["done", "cancelled"].includes(t.status)
        ) {
          dueThisWeek++;
        }
      }

      return {
        total: allTasks.length,
        active: allTasks.filter(
          (t) => !["done", "cancelled"].includes(t.status)
        ).length,
        overdue,
        dueThisWeek,
        byStatus,
        byPriority,
        bySourceType,
      };
    }),

  /**
   * Get activity log for a task.
   */
  getActivity: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        taskId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyTaskAccess(input.organizationId, input.taskId);

      const activities = await db.query.taskActivity.findMany({
        where: eq(taskActivity.taskId, input.taskId),
        orderBy: [desc(taskActivity.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      // Transform to flatten user data onto the activity
      const transformedActivities = activities.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        userId: a.userId,
        userName: a.user?.name ?? a.user?.email ?? null,
        userImage: a.user?.image ?? null,
        activityType: a.activityType,
        previousValue: a.previousValue,
        newValue: a.newValue,
        comment: a.comment,
        createdAt: a.createdAt,
      }));

      return { activities: transformedActivities };
    }),

  /**
   * Add a comment to a task.
   */
  addComment: protectedProcedure
    .input(addCommentSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyTaskAccess(input.organizationId, input.taskId);

      await logTaskActivity(
        input.taskId,
        userId,
        "comment_added",
        null,
        null,
        input.comment
      );

      return { success: true };
    }),

  // ===========================================================================
  // LABELS
  // ===========================================================================

  /**
   * List labels for organization.
   */
  listLabels: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      const labels = await db.query.taskLabel.findMany({
        where: eq(taskLabel.organizationId, input.organizationId),
        orderBy: [asc(taskLabel.name)],
      });

      return { labels };
    }),

  /**
   * Create a new label.
   */
  createLabel: protectedProcedure
    .input(labelSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Check for duplicate name
      const existing = await db.query.taskLabel.findFirst({
        where: and(
          eq(taskLabel.organizationId, input.organizationId),
          eq(taskLabel.name, input.name)
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A label with this name already exists.",
        });
      }

      const [newLabel] = await db
        .insert(taskLabel)
        .values({
          organizationId: input.organizationId,
          name: input.name,
          color: input.color,
        })
        .returning();

      return newLabel;
    }),

  /**
   * Update a label.
   */
  updateLabel: protectedProcedure
    .input(updateLabelSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyLabelAccess(input.organizationId, input.labelId);

      const updates: Partial<typeof taskLabel.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) {
        // Check for duplicate name
        const existing = await db.query.taskLabel.findFirst({
          where: and(
            eq(taskLabel.organizationId, input.organizationId),
            eq(taskLabel.name, input.name)
          ),
        });

        if (existing && existing.id !== input.labelId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A label with this name already exists.",
          });
        }

        updates.name = input.name;
      }

      if (input.color !== undefined) {
        updates.color = input.color;
      }

      await db
        .update(taskLabel)
        .set(updates)
        .where(eq(taskLabel.id, input.labelId));

      return { success: true };
    }),

  /**
   * Delete a label.
   */
  deleteLabel: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        labelId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyLabelAccess(input.organizationId, input.labelId);

      // Delete label (cascades to junction table)
      await db.delete(taskLabel).where(eq(taskLabel.id, input.labelId));

      return { success: true };
    }),

  /**
   * Add label to task.
   */
  addLabel: protectedProcedure
    .input(taskLabelSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyTaskAccess(input.organizationId, input.taskId);
      const label = await verifyLabelAccess(
        input.organizationId,
        input.labelId
      );

      // Check if already exists
      const existing = await db.query.taskLabelJunction.findFirst({
        where: and(
          eq(taskLabelJunction.taskId, input.taskId),
          eq(taskLabelJunction.labelId, input.labelId)
        ),
      });

      if (existing) {
        return { success: true };
      }

      await db.insert(taskLabelJunction).values({
        taskId: input.taskId,
        labelId: input.labelId,
      });

      await logTaskActivity(
        input.taskId,
        userId,
        "label_added",
        null,
        label.name
      );

      return { success: true };
    }),

  /**
   * Remove label from task.
   */
  removeLabel: protectedProcedure
    .input(taskLabelSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);
      await verifyTaskAccess(input.organizationId, input.taskId);
      const label = await verifyLabelAccess(
        input.organizationId,
        input.labelId
      );

      await db
        .delete(taskLabelJunction)
        .where(
          and(
            eq(taskLabelJunction.taskId, input.taskId),
            eq(taskLabelJunction.labelId, input.labelId)
          )
        );

      await logTaskActivity(
        input.taskId,
        userId,
        "label_removed",
        label.name,
        null
      );

      return { success: true };
    }),

  // ===========================================================================
  // BACKFILL
  // ===========================================================================

  /**
   * Trigger backfill to create tasks for all existing items.
   * Creates tasks for conversations, commitments, and decisions that don't have tasks yet.
   */
  triggerBackfill: protectedProcedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await verifyOrgMembership(userId, input.organizationId);

      // Use @trigger.dev/sdk to trigger the backfill task
      const { tasks: triggerTasks } = await import("@trigger.dev/sdk");

      const handle = await triggerTasks.trigger("task-backfill", {
        organizationId: input.organizationId,
      });

      return {
        success: true,
        message:
          "Backfill task started. Check Trigger.dev dashboard for progress.",
        runId: handle.id,
      };
    }),
});
