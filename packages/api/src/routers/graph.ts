// =============================================================================
// GRAPH ROUTER
// =============================================================================
//
// API for querying the knowledge graph and fetching graph data for visualization.
// Connects to FalkorDB for graph queries and PostgreSQL for data.
//

import { db } from "@memorystack/db";
import {
  commitment,
  contact,
  contactRelationship,
  decision,
  member,
  task,
} from "@memorystack/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

const getSubgraphSchema = z.object({
  organizationId: z.string().min(1),
  nodeTypes: z
    .array(
      z.enum([
        "contact",
        "commitment",
        "decision",
        "task",
        "conversation",
        "topic",
      ])
    )
    .default(["contact", "commitment", "decision", "task"]),
  limit: z.number().int().min(1).max(500).default(200),
  focalNodeId: z.string().optional(), // Center the graph around this node
  depth: z.number().int().min(1).max(3).default(2), // How many hops from focal node
});

const getContactNetworkSchema = z.object({
  organizationId: z.string().min(1),
  contactId: z.string().optional(), // If provided, get network around this contact
  depth: z.number().int().min(1).max(3).default(2),
  minStrength: z.number().min(0).max(1).default(0.1),
  limit: z.number().int().min(1).max(200).default(100),
});

const searchGraphSchema = z.object({
  organizationId: z.string().min(1),
  query: z.string().min(1),
  nodeTypes: z
    .array(z.enum(["contact", "commitment", "decision", "task"]))
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
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
      message: "You do not have access to this organization",
    });
  }
}

// Transform database records to graph nodes
function contactToNode(c: typeof contact.$inferSelect) {
  return {
    id: c.id,
    type: "contact" as const,
    position: { x: 0, y: 0 }, // Will be calculated by D3-Force
    data: {
      id: c.id,
      label: c.displayName ?? c.primaryEmail,
      nodeType: "contact" as const,
      email: c.primaryEmail,
      company: c.company ?? undefined,
      title: c.title ?? undefined,
      avatarUrl: c.avatarUrl ?? undefined,
      healthScore: c.healthScore ?? undefined,
      importanceScore: c.importanceScore ?? undefined,
      isVip: c.isVip ?? false,
      isAtRisk: c.isAtRisk ?? false,
    },
  };
}

function commitmentToNode(c: typeof commitment.$inferSelect) {
  return {
    id: c.id,
    type: "commitment" as const,
    position: { x: 0, y: 0 },
    data: {
      id: c.id,
      label: c.title,
      nodeType: "commitment" as const,
      status: c.status,
      priority: c.priority,
      direction: c.direction,
      dueDate: c.dueDate?.toISOString(),
      confidence: c.confidence,
      isOverdue:
        c.status === "overdue" ||
        (c.dueDate && new Date(c.dueDate) < new Date()),
    },
  };
}

function decisionToNode(d: typeof decision.$inferSelect) {
  return {
    id: d.id,
    type: "decision" as const,
    position: { x: 0, y: 0 },
    data: {
      id: d.id,
      label: d.title,
      nodeType: "decision" as const,
      status: d.supersededById ? "superseded" : "active",
      decidedAt: d.decidedAt.toISOString(),
      confidence: d.confidence,
      rationale: d.rationale ?? undefined,
      isSuperseded: !!d.supersededById,
    },
  };
}

function taskToNode(t: typeof task.$inferSelect) {
  return {
    id: t.id,
    type: "task" as const,
    position: { x: 0, y: 0 },
    data: {
      id: t.id,
      label: t.title,
      nodeType: "task" as const,
      status: t.status,
      priority: t.priority ?? "medium",
      dueDate: t.dueDate?.toISOString(),
      sourceType: t.sourceType ?? undefined,
    },
  };
}

// =============================================================================
// ROUTER
// =============================================================================

export const graphRouter = router({
  /**
   * Get a subgraph for visualization
   * Returns nodes and edges based on the requested types
   */
  getSubgraph: protectedProcedure
    .input(getSubgraphSchema)
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.session.user.id, input.organizationId);

      const nodes: ReturnType<
        | typeof contactToNode
        | typeof commitmentToNode
        | typeof decisionToNode
        | typeof taskToNode
      >[] = [];
      const edges: Array<{
        id: string;
        source: string;
        target: string;
        data: { edgeType: string; strength?: number };
      }> = [];

      // Fetch contacts
      if (input.nodeTypes.includes("contact")) {
        const contacts = await db
          .select()
          .from(contact)
          .where(eq(contact.organizationId, input.organizationId))
          .orderBy(desc(contact.importanceScore))
          .limit(Math.min(input.limit, 100));

        for (const c of contacts) {
          nodes.push(contactToNode(c));
        }

        // Fetch contact relationships
        const contactIds = contacts.map((c) => c.id);
        if (contactIds.length > 0) {
          const relationships = await db
            .select()
            .from(contactRelationship)
            .where(
              and(
                eq(contactRelationship.organizationId, input.organizationId),
                or(
                  inArray(contactRelationship.contactAId, contactIds),
                  inArray(contactRelationship.contactBId, contactIds)
                )
              )
            )
            .limit(500);

          for (const rel of relationships) {
            edges.push({
              id: `${rel.contactAId}-${rel.contactBId}-${rel.relationshipType}`,
              source: rel.contactAId,
              target: rel.contactBId,
              data: {
                edgeType: rel.relationshipType,
                strength: rel.strength,
              },
            });
          }
        }
      }

      // Fetch commitments
      if (input.nodeTypes.includes("commitment")) {
        const commitments = await db
          .select()
          .from(commitment)
          .where(eq(commitment.organizationId, input.organizationId))
          .orderBy(desc(commitment.createdAt))
          .limit(Math.min(input.limit, 100));

        for (const c of commitments) {
          nodes.push(commitmentToNode(c));

          // Create edges to debtor/creditor contacts
          if (c.debtorContactId) {
            edges.push({
              id: `${c.id}-${c.debtorContactId}-owns`,
              source: c.debtorContactId,
              target: c.id,
              data: { edgeType: "owns" },
            });
          }
          if (c.creditorContactId) {
            edges.push({
              id: `${c.id}-${c.creditorContactId}-involves`,
              source: c.creditorContactId,
              target: c.id,
              data: { edgeType: "involves" },
            });
          }
        }
      }

      // Fetch decisions
      if (input.nodeTypes.includes("decision")) {
        const decisions = await db
          .select()
          .from(decision)
          .where(eq(decision.organizationId, input.organizationId))
          .orderBy(desc(decision.decidedAt))
          .limit(Math.min(input.limit, 100));

        for (const d of decisions) {
          nodes.push(decisionToNode(d));

          // Create supersession edges
          if (d.supersededById) {
            edges.push({
              id: `${d.id}-${d.supersededById}-supersedes`,
              source: d.supersededById,
              target: d.id,
              data: { edgeType: "supersedes" },
            });
          }
        }
      }

      // Fetch tasks
      if (input.nodeTypes.includes("task")) {
        const tasks = await db
          .select()
          .from(task)
          .where(eq(task.organizationId, input.organizationId))
          .orderBy(desc(task.createdAt))
          .limit(Math.min(input.limit, 100));

        for (const t of tasks) {
          nodes.push(taskToNode(t));

          // Create edges to source UIO
          if (t.sourceUIOId) {
            edges.push({
              id: `${t.id}-${t.sourceUIOId}-tracks`,
              source: t.id,
              target: t.sourceUIOId,
              data: { edgeType: "tracks" },
            });
          }
        }
      }

      // Calculate metrics
      const nodesByType: Record<string, number> = {};
      for (const node of nodes) {
        nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
      }

      return {
        nodes,
        edges,
        metrics: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          nodesByType,
        },
      };
    }),

  /**
   * Get contact network (social graph)
   * Returns contacts and their relationships
   */
  getContactNetwork: protectedProcedure
    .input(getContactNetworkSchema)
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.session.user.id, input.organizationId);

      // Get contacts
      const contacts = input.contactId
        ? await db
            .select()
            .from(contact)
            .where(
              and(
                eq(contact.organizationId, input.organizationId),
                eq(contact.id, input.contactId)
              )
            )
        : await db
            .select()
            .from(contact)
            .where(eq(contact.organizationId, input.organizationId))
            .orderBy(desc(contact.importanceScore))
            .limit(input.limit);

      const contactIds = contacts.map((c) => c.id);
      const nodes = contacts.map(contactToNode);

      // Get relationships
      const relationships = await db
        .select()
        .from(contactRelationship)
        .where(
          and(
            eq(contactRelationship.organizationId, input.organizationId),
            or(
              inArray(contactRelationship.contactAId, contactIds),
              inArray(contactRelationship.contactBId, contactIds)
            ),
            sql`${contactRelationship.strength} >= ${input.minStrength}`
          )
        );

      // Expand network by fetching connected contacts
      const connectedContactIds = new Set<string>();
      for (const rel of relationships) {
        if (!contactIds.includes(rel.contactAId)) {
          connectedContactIds.add(rel.contactAId);
        }
        if (!contactIds.includes(rel.contactBId)) {
          connectedContactIds.add(rel.contactBId);
        }
      }

      if (connectedContactIds.size > 0) {
        const connectedContacts = await db
          .select()
          .from(contact)
          .where(inArray(contact.id, Array.from(connectedContactIds)));

        for (const c of connectedContacts) {
          nodes.push(contactToNode(c));
        }
      }

      const edges = relationships.map((rel) => ({
        id: `${rel.contactAId}-${rel.contactBId}-${rel.relationshipType}`,
        source: rel.contactAId,
        target: rel.contactBId,
        data: {
          edgeType: rel.relationshipType,
          strength: rel.strength,
        },
      }));

      // Calculate network metrics
      const totalContacts = nodes.length;
      const avgConnections = edges.length / Math.max(totalContacts, 1);

      return {
        nodes,
        edges,
        metrics: {
          totalContacts,
          totalRelationships: edges.length,
          avgConnections,
          // TODO: Calculate centrality when we have graph algorithms
          centrality: 0.5,
          communityCount: 1,
        },
      };
    }),

  /**
   * Search the graph for nodes
   */
  search: protectedProcedure
    .input(searchGraphSchema)
    .query(async ({ ctx, input }) => {
      await verifyOrgMembership(ctx.session.user.id, input.organizationId);

      const results: Array<{
        id: string;
        type: string;
        label: string;
        score: number;
      }> = [];
      const query = `%${input.query}%`;

      const types = input.nodeTypes ?? [
        "contact",
        "commitment",
        "decision",
        "task",
      ];

      // Search contacts
      if (types.includes("contact")) {
        const contacts = await db
          .select()
          .from(contact)
          .where(
            and(
              eq(contact.organizationId, input.organizationId),
              or(
                sql`${contact.displayName} ILIKE ${query}`,
                sql`${contact.primaryEmail} ILIKE ${query}`,
                sql`${contact.company} ILIKE ${query}`
              )
            )
          )
          .limit(input.limit);

        for (const c of contacts) {
          results.push({
            id: c.id,
            type: "contact",
            label: c.displayName ?? c.primaryEmail,
            score: c.importanceScore ?? 0.5,
          });
        }
      }

      // Search commitments
      if (types.includes("commitment")) {
        const commitments = await db
          .select()
          .from(commitment)
          .where(
            and(
              eq(commitment.organizationId, input.organizationId),
              sql`${commitment.title} ILIKE ${query}`
            )
          )
          .limit(input.limit);

        for (const c of commitments) {
          results.push({
            id: c.id,
            type: "commitment",
            label: c.title,
            score: c.confidence,
          });
        }
      }

      // Search decisions
      if (types.includes("decision")) {
        const decisions = await db
          .select()
          .from(decision)
          .where(
            and(
              eq(decision.organizationId, input.organizationId),
              or(
                sql`${decision.title} ILIKE ${query}`,
                sql`${decision.statement} ILIKE ${query}`
              )
            )
          )
          .limit(input.limit);

        for (const d of decisions) {
          results.push({
            id: d.id,
            type: "decision",
            label: d.title,
            score: d.confidence,
          });
        }
      }

      // Search tasks
      if (types.includes("task")) {
        const tasks = await db
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, input.organizationId),
              sql`${task.title} ILIKE ${query}`
            )
          )
          .limit(input.limit);

        for (const t of tasks) {
          results.push({
            id: t.id,
            type: "task",
            label: t.title,
            score: 0.5,
          });
        }
      }

      // Sort by score and limit
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, input.limit);
    }),
});
