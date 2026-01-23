// =============================================================================
// INTELLIGENCE PLATFORM API
// =============================================================================
//
// REST API endpoints for the Drovi Intelligence Platform.
// Provides external access to intelligence extraction, UIOs, and graph queries.
//

import { db } from "@memorystack/db";
import { unifiedIntelligenceObject, task } from "@memorystack/db/schema";
import { type SQL, and, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import {
  callPythonIntelligence,
  streamPythonIntelligence,
  checkIntelligenceBackendHealth,
} from "../lib/intelligence-backend";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  type ApiKeyContext,
  apiKeyAuth,
  requireScopes,
} from "../middleware/api-key-auth";
import { rateLimit, rateLimitTiers } from "../middleware/rate-limit";

// =============================================================================
// PYTHON BACKEND URL
// =============================================================================

const INTELLIGENCE_BACKEND_URL =
  process.env.INTELLIGENCE_BACKEND_URL ?? "http://localhost:8000";

// =============================================================================
// TYPES
// =============================================================================

interface IntelligenceApiEnv {
  Variables: ApiKeyContext;
}

// =============================================================================
// SCHEMAS
// =============================================================================

const AnalyzeRequestSchema = z.object({
  content: z.string().min(1),
  sourceType: z.enum(["email", "slack", "document", "calendar", "raw"]),
  sourceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  options: z
    .object({
      extractCommitments: z.boolean().default(true),
      extractDecisions: z.boolean().default(true),
      detectTopics: z.boolean().default(true),
      analyzeRisk: z.boolean().default(false),
      returnEvidence: z.boolean().default(true),
    })
    .optional(),
});

const UIOFiltersSchema = z.object({
  type: z.enum(["commitment", "decision", "topic", "project"]).optional(),
  status: z
    .enum(["active", "merged", "archived", "dismissed"])
    .optional(),
  ownerContactId: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const GraphQuerySchema = z.object({
  cypher: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const WebhookRegisterSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
  description: z.string().optional(),
});


// =============================================================================
// API ROUTES
// =============================================================================

const intelligenceApi = new Hono<IntelligenceApiEnv>();

// Apply API key authentication to all routes
intelligenceApi.use("/*", apiKeyAuth());

// Apply rate limiting
intelligenceApi.use(
  "/*",
  rateLimit({
    ...rateLimitTiers.api,
    keyGenerator: (c) => {
      const apiKey = c.get("apiKey");
      return apiKey?.id ?? "unknown";
    },
  })
);

// =============================================================================
// ANALYSIS ENDPOINTS
// =============================================================================

/**
 * Analyze content and extract intelligence
 * POST /api/v1/intelligence/analyze
 * Requires: write:intelligence scope
 */
intelligenceApi.post(
  "/analyze",
  requireScopes("write:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    // Validate request
    const parseResult = AnalyzeRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.issues,
        },
        400
      );
    }

    const { content, sourceType, sourceId, metadata, options } =
      parseResult.data;

    try {
      // Check Python backend health
      const isHealthy = await checkIntelligenceBackendHealth();
      if (!isHealthy) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Intelligence backend is not available",
          },
          503
        );
      }

      // Call Python backend for analysis
      const result = await callPythonIntelligence({
        content,
        organization_id: apiKey.organizationId ?? "",
        source_type: sourceType,
        source_id: sourceId,
      });

      const response = {
        analysisId: result.analysis_id,
        status: result.needs_review ? "needs_review" : "completed",
        organizationId: apiKey.organizationId,
        input: {
          sourceType,
          sourceId,
          contentLength: content.length,
          options: options ?? {
            extractCommitments: true,
            extractDecisions: true,
            detectTopics: true,
            analyzeRisk: false,
            returnEvidence: true,
          },
        },
        metadata,
        createdAt: new Date().toISOString(),
        results: {
          claims: result.claims,
          commitments: result.commitments,
          decisions: result.decisions,
          risks: result.risks,
          tasks: result.tasks,
          contacts: result.contacts,
          confidence: result.overall_confidence,
        },
        durationMs: result.duration_ms,
        _links: {
          self: `/api/v1/intelligence/analyze/${result.analysis_id}`,
          stream: `/api/v1/intelligence/analyze/stream`,
        },
      };

      return c.json(response, 200);
    } catch (error) {
      console.error("[Intelligence API] Analysis error:", error);
      return c.json(
        {
          error: "ANALYSIS_ERROR",
          message: error instanceof Error ? error.message : "Failed to analyze content",
        },
        500
      );
    }
  }
);

/**
 * Stream analysis with real-time updates (SSE)
 * POST /api/v1/intelligence/analyze/stream
 * Requires: write:intelligence scope
 */
intelligenceApi.post(
  "/analyze/stream",
  requireScopes("write:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    // Validate request
    const parseResult = AnalyzeRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.issues,
        },
        400
      );
    }

    const { content, sourceType, sourceId } = parseResult.data;

    return streamSSE(c, async (stream) => {
      try {
        // Stream from Python backend
        await streamPythonIntelligence(
          {
            content,
            organization_id: apiKey.organizationId ?? "",
            source_type: sourceType,
            source_id: sourceId,
          },
          async (event) => {
            const data = typeof event.data === "object" && event.data !== null
              ? { ...(event.data as Record<string, unknown>), organizationId: apiKey.organizationId }
              : { data: event.data, organizationId: apiKey.organizationId };
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(data),
            });
          }
        );
      } catch (error) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
            timestamp: Date.now(),
          }),
        });
      }
    });
  }
);

// =============================================================================
// UIO ENDPOINTS
// =============================================================================

/**
 * List UIOs with filters
 * GET /api/v1/intelligence/uios
 * Requires: read:intelligence scope
 */
intelligenceApi.get("/uios", requireScopes("read:intelligence"), async (c) => {
  const apiKey = c.get("apiKey");
  const query = c.req.query();

  // Validate query params
  const parseResult = UIOFiltersSchema.safeParse(query);
  if (!parseResult.success) {
    return c.json(
      {
        error: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        details: parseResult.error.issues,
      },
      400
    );
  }

  const {
    type,
    status,
    ownerContactId,
    since,
    until,
    minConfidence,
    search,
    limit,
    cursor,
  } = parseResult.data;

  try {
    // Build query conditions
    const conditions: SQL[] = [
      eq(unifiedIntelligenceObject.organizationId, apiKey.organizationId ?? ""),
    ];

    if (type) {
      conditions.push(eq(unifiedIntelligenceObject.type, type));
    }

    if (status) {
      conditions.push(eq(unifiedIntelligenceObject.status, status));
    }

    if (ownerContactId) {
      conditions.push(
        eq(unifiedIntelligenceObject.ownerContactId, ownerContactId)
      );
    }

    if (since) {
      conditions.push(
        gte(unifiedIntelligenceObject.createdAt, new Date(since))
      );
    }

    if (until) {
      conditions.push(
        sql`${unifiedIntelligenceObject.createdAt} <= ${new Date(until)}`
      );
    }

    if (minConfidence !== undefined) {
      conditions.push(
        sql`${unifiedIntelligenceObject.overallConfidence} >= ${minConfidence}`
      );
    }

    if (search) {
      const searchCondition = or(
        ilike(unifiedIntelligenceObject.canonicalTitle, `%${search}%`),
        ilike(unifiedIntelligenceObject.canonicalDescription, `%${search}%`)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (cursor) {
      conditions.push(sql`${unifiedIntelligenceObject.id} < ${cursor}`);
    }

    // Execute query
    const uios = await db.query.unifiedIntelligenceObject.findMany({
      where: and(...conditions),
      orderBy: [desc(unifiedIntelligenceObject.createdAt)],
      limit: limit + 1, // Fetch one extra to determine if there are more
      with: {
        sources: {
          limit: 5,
        },
      },
    });

    // Determine pagination
    const hasMore = uios.length > limit;
    const items = hasMore ? uios.slice(0, -1) : uios;
    const lastItem = items[items.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return c.json({
      data: items.map((uio) => ({
        id: uio.id,
        type: uio.type,
        status: uio.status,
        canonicalTitle: uio.canonicalTitle,
        canonicalDescription: uio.canonicalDescription,
        overallConfidence: uio.overallConfidence,
        dueDate: uio.dueDate,
        ownerContactId: uio.ownerContactId,
        sourceCount: uio.sources?.length ?? 0,
        firstSeenAt: uio.firstSeenAt,
        lastUpdatedAt: uio.lastUpdatedAt,
        createdAt: uio.createdAt,
        updatedAt: uio.updatedAt,
        _links: {
          self: `/api/v1/intelligence/uios/${uio.id}`,
        },
      })),
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
      _links: {
        self: `/api/v1/intelligence/uios`,
        next: nextCursor
          ? `/api/v1/intelligence/uios?cursor=${nextCursor}&limit=${limit}`
          : null,
      },
    });
  } catch (error) {
    console.error("[Intelligence API] List UIOs error:", error);
    return c.json(
      {
        error: "DATABASE_ERROR",
        message: "Failed to fetch UIOs",
      },
      500
    );
  }
});

/**
 * Get UIO with full context
 * GET /api/v1/intelligence/uios/:id
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/uios/:id",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const uioId = c.req.param("id");

    try {
      const uio = await db.query.unifiedIntelligenceObject.findFirst({
        where: and(
          eq(unifiedIntelligenceObject.id, uioId),
          eq(
            unifiedIntelligenceObject.organizationId,
            apiKey.organizationId ?? ""
          )
        ),
        with: {
          sources: true,
          timeline: {
            orderBy: (timeline, { desc }) => [desc(timeline.eventAt)],
            limit: 20,
          },
          owner: true,
        },
      });

      if (!uio) {
        return c.json(
          {
            error: "NOT_FOUND",
            message: `UIO with id ${uioId} not found`,
          },
          404
        );
      }

      // Get related tasks
      const relatedTasks = await db.query.task.findMany({
        where: and(
          eq(task.sourceUIOId, uioId),
          eq(task.organizationId, apiKey.organizationId ?? "")
        ),
      });

      return c.json({
        data: {
          id: uio.id,
          type: uio.type,
          status: uio.status,
          canonicalTitle: uio.canonicalTitle,
          canonicalDescription: uio.canonicalDescription,
          overallConfidence: uio.overallConfidence,
          dueDate: uio.dueDate,
          dueDateConfidence: uio.dueDateConfidence,
          ownerContactId: uio.ownerContactId,
          owner: uio.owner
            ? {
                id: uio.owner.id,
                displayName: uio.owner.displayName,
                emails: uio.owner.emails,
              }
            : null,
          participantContactIds: uio.participantContactIds,
          isUserVerified: uio.isUserVerified,
          isUserDismissed: uio.isUserDismissed,
          userCorrectedTitle: uio.userCorrectedTitle,
          mergedIntoId: uio.mergedIntoId,
          sources: uio.sources?.map((s) => ({
            id: s.id,
            sourceType: s.sourceType,
            role: s.role,
            confidence: s.confidence,
            quotedText: s.quotedText,
            extractedTitle: s.extractedTitle,
            extractedDueDate: s.extractedDueDate,
            sourceTimestamp: s.sourceTimestamp,
            createdAt: s.createdAt,
          })),
          timeline: uio.timeline?.map((t) => ({
            id: t.id,
            eventType: t.eventType,
            eventDescription: t.eventDescription,
            previousValue: t.previousValue,
            newValue: t.newValue,
            sourceType: t.sourceType,
            sourceName: t.sourceName,
            eventAt: t.eventAt,
          })),
          relatedTasks: relatedTasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
          })),
          firstSeenAt: uio.firstSeenAt,
          lastUpdatedAt: uio.lastUpdatedAt,
          organizationId: uio.organizationId,
          createdAt: uio.createdAt,
          updatedAt: uio.updatedAt,
        },
        _links: {
          self: `/api/v1/intelligence/uios/${uio.id}`,
          tasks: `/api/v1/intelligence/uios/${uio.id}/tasks`,
          graph: `/api/v1/intelligence/graph/query`,
        },
      });
    } catch (error) {
      console.error("[Intelligence API] Get UIO error:", error);
      return c.json(
        {
          error: "DATABASE_ERROR",
          message: "Failed to fetch UIO",
        },
        500
      );
    }
  }
);

// =============================================================================
// GRAPH ENDPOINTS
// =============================================================================

/**
 * Execute Cypher query on knowledge graph
 * POST /api/v1/intelligence/graph/query
 * Requires: read:graph scope
 */
intelligenceApi.post(
  "/graph/query",
  requireScopes("read:graph"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    // Validate request
    const parseResult = GraphQuerySchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "Invalid request body",
          details: parseResult.error.issues,
        },
        400
      );
    }

    const { cypher, params } = parseResult.data;

    // Security: Validate query doesn't contain dangerous operations
    const dangerousPatterns = [
      /\bDELETE\b/i,
      /\bDETACH\b/i,
      /\bDROP\b/i,
      /\bREMOVE\b/i,
      /\bSET\b/i,
      /\bCREATE\b/i,
      /\bMERGE\b/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cypher)) {
        return c.json(
          {
            error: "FORBIDDEN",
            message:
              "Write operations are not allowed through the query endpoint",
          },
          403
        );
      }
    }

    try {
      // Proxy to Python backend
      const startTime = Date.now();
      const response = await fetch(`${INTELLIGENCE_BACKEND_URL}/api/v1/graph/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cypher,
          params: {
            ...params,
            organization_id: apiKey.organizationId,
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 503) {
          return c.json(
            {
              error: "SERVICE_UNAVAILABLE",
              message: "Graph service is not available. Ensure Python backend is running.",
            },
            503
          );
        }
        throw new Error(`Graph query failed: ${response.status}`);
      }

      const result = await response.json();
      const executionTimeMs = Date.now() - startTime;

      return c.json({
        data: result,
        query: {
          cypher,
          params: {
            ...params,
            organizationId: apiKey.organizationId,
          },
        },
        metadata: {
          executionTimeMs,
        },
        _links: {
          self: "/api/v1/intelligence/graph/query",
        },
      });
    } catch (error) {
      console.error("[Intelligence API] Graph query error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: error instanceof Error ? error.message : "Failed to execute graph query",
        },
        500
      );
    }
  }
);

// =============================================================================
// EVENT STREAM ENDPOINT
// =============================================================================

/**
 * Subscribe to real-time events (SSE)
 * GET /api/v1/intelligence/events/stream
 * Requires: read:events scope
 */
intelligenceApi.get(
  "/events/stream",
  requireScopes("read:events"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const query = c.req.query();

    // Parse topics
    const topicsParam = query.topics;
    const topics = topicsParam ? topicsParam.split(",") : ["uio.*", "task.*"];

    return streamSSE(c, async (stream) => {
      // Send initial connection event
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          organizationId: apiKey.organizationId,
          topics,
          timestamp: Date.now(),
        }),
      });

      // TODO: Integrate with actual WebSocket/event bus for real events
      // For now, keep connection alive with periodic heartbeats
      const heartbeatInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Clean up on disconnect
      c.req.raw.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval);
      });

      // Keep the connection open
      // In production, this would be replaced with actual event subscription
      await new Promise(() => {
        // Connection stays open until client disconnects
      });
    });
  }
);

// =============================================================================
// WEBHOOK ENDPOINTS
// =============================================================================

/**
 * Register a webhook for events
 * POST /api/v1/intelligence/webhooks
 * Requires: admin scope
 */
intelligenceApi.post("/webhooks", requireScopes("admin"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  // Validate request
  const parseResult = WebhookRegisterSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json(
      {
        error: "VALIDATION_ERROR",
        message: "Invalid request body",
        details: parseResult.error.issues,
      },
      400
    );
  }

  const { url, events, description } = parseResult.data;

  try {
    // TODO: Store webhook in database
    // For now, return a placeholder response
    const webhookId = `webhook_${crypto.randomUUID()}`;

    return c.json(
      {
        id: webhookId,
        organizationId: apiKey.organizationId,
        url,
        events,
        description,
        status: "active",
        createdAt: new Date().toISOString(),
        _links: {
          self: `/api/v1/intelligence/webhooks/${webhookId}`,
          test: `/api/v1/intelligence/webhooks/${webhookId}/test`,
        },
      },
      201
    );
  } catch (error) {
    console.error("[Intelligence API] Webhook registration error:", error);
    return c.json(
      {
        error: "DATABASE_ERROR",
        message: "Failed to register webhook",
      },
      500
    );
  }
});

/**
 * List registered webhooks
 * GET /api/v1/intelligence/webhooks
 * Requires: admin scope
 */
intelligenceApi.get("/webhooks", requireScopes("admin"), async (c) => {
  // API key is validated by requireScopes middleware
  // TODO: Use apiKey.organizationId to filter webhooks when implemented

  try {
    // TODO: Fetch webhooks from database
    return c.json({
      data: [],
      pagination: {
        limit: 20,
        hasMore: false,
        nextCursor: null,
      },
      _links: {
        self: "/api/v1/intelligence/webhooks",
      },
    });
  } catch (error) {
    console.error("[Intelligence API] List webhooks error:", error);
    return c.json(
      {
        error: "DATABASE_ERROR",
        message: "Failed to fetch webhooks",
      },
      500
    );
  }
});

// =============================================================================
// STATS ENDPOINT
// =============================================================================

/**
 * Get intelligence statistics
 * GET /api/v1/intelligence/stats
 * Requires: read:analytics scope
 */
intelligenceApi.get("/stats", requireScopes("read:analytics"), async (c) => {
  const apiKey = c.get("apiKey");

  try {
    // Get UIO counts by type
    const uioCounts = await db
      .select({
        type: unifiedIntelligenceObject.type,
        count: sql<number>`count(*)::int`,
      })
      .from(unifiedIntelligenceObject)
      .where(
        eq(
          unifiedIntelligenceObject.organizationId,
          apiKey.organizationId ?? ""
        )
      )
      .groupBy(unifiedIntelligenceObject.type);

    // Get recent activity (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(unifiedIntelligenceObject)
      .where(
        and(
          eq(
            unifiedIntelligenceObject.organizationId,
            apiKey.organizationId ?? ""
          ),
          gte(unifiedIntelligenceObject.createdAt, oneDayAgo)
        )
      );

    const recentActivityCount = recentCount[0]?.count ?? 0;

    // Format response
    const countsByType: Record<string, number> = {};
    let totalUIOs = 0;
    for (const row of uioCounts) {
      if (row.type) {
        countsByType[row.type] = row.count;
        totalUIOs += row.count;
      }
    }

    return c.json({
      organizationId: apiKey.organizationId,
      stats: {
        totalUIOs,
        byType: countsByType,
        recentActivity: {
          last24Hours: recentActivityCount,
        },
      },
      _links: {
        self: "/api/v1/intelligence/stats",
        uios: "/api/v1/intelligence/uios",
      },
    });
  } catch (error) {
    console.error("[Intelligence API] Stats error:", error);
    return c.json(
      {
        error: "DATABASE_ERROR",
        message: "Failed to fetch statistics",
      },
      500
    );
  }
});

// =============================================================================
// WEBSOCKET STATUS ENDPOINT
// =============================================================================

/**
 * Get WebSocket server status
 * GET /api/v1/intelligence/ws/status
 * Requires: read:analytics scope
 *
 * NOTE: WebSocket is disabled in favor of Python SSE.
 * Use /api/v1/events/stream/{organization_id} for real-time events.
 */
intelligenceApi.get(
  "/ws/status",
  requireScopes("read:analytics"),
  async (c) => {
    return c.json({
      status: "disabled",
      message:
        "WebSocket is disabled - use Python SSE at /api/v1/events/stream/{organization_id}",
      sseEndpoint: `${INTELLIGENCE_BACKEND_URL}/api/v1/events/stream`,
      _links: {
        self: "/api/v1/intelligence/ws/status",
        sse: `${INTELLIGENCE_BACKEND_URL}/api/v1/events/stream`,
      },
    });
  }
);

// =============================================================================
// MEMORY (AGENTIC MEMORY) ENDPOINTS
// =============================================================================
// NOTE: Memory endpoints proxy to Python backend

/**
 * Search memory with temporal awareness
 * POST /api/v1/intelligence/memory/search
 * Requires: read:intelligence scope
 */
intelligenceApi.post(
  "/memory/search",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const body = await c.req.json();

    try {
      const response = await fetch(`${INTELLIGENCE_BACKEND_URL}/api/v1/memory/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          organization_id: apiKey.organizationId,
        }),
      });

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Memory service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Memory search error:", error);
      return c.json(
        {
          error: "MEMORY_ERROR",
          message: "Memory service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/memory/search`,
        },
        503
      );
    }
  }
);

/**
 * Get timeline of episodes for an entity or contact
 * GET /api/v1/intelligence/memory/timeline
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/memory/timeline",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const queryParams = c.req.query();

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/memory/timeline`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");
      for (const [key, value] of Object.entries(queryParams)) {
        if (value) url.searchParams.set(key, value);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Memory service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Timeline error:", error);
      return c.json(
        {
          error: "MEMORY_ERROR",
          message: "Memory service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/memory/timeline`,
        },
        503
      );
    }
  }
);

/**
 * Get recent episodes
 * GET /api/v1/intelligence/memory/recent
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/memory/recent",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const limit = c.req.query("limit") ?? "50";

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/memory/recent`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");
      url.searchParams.set("limit", limit);

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Memory service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Recent episodes error:", error);
      return c.json(
        {
          error: "MEMORY_ERROR",
          message: "Memory service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/memory/recent`,
        },
        503
      );
    }
  }
);

// =============================================================================
// NETWORK ANALYSIS ENDPOINTS
// =============================================================================
// NOTE: Network endpoints proxy to Python backend

/**
 * Get network metrics for the organization
 * GET /api/v1/intelligence/network/metrics
 * Requires: read:analytics scope
 */
intelligenceApi.get(
  "/network/metrics",
  requireScopes("read:analytics"),
  async (c) => {
    const apiKey = c.get("apiKey");

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/network/metrics`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Network analysis service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Network metrics error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: "Network analysis service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/network/metrics`,
        },
        503
      );
    }
  }
);

/**
 * Get top contacts by importance (PageRank)
 * GET /api/v1/intelligence/network/contacts
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/network/contacts",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const limit = c.req.query("limit") ?? "20";

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/network/contacts`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");
      url.searchParams.set("limit", limit);

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Network analysis service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Contact importance error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: "Network analysis service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/network/contacts`,
        },
        503
      );
    }
  }
);

/**
 * Get bridge contacts (high betweenness centrality)
 * GET /api/v1/intelligence/network/bridges
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/network/bridges",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const limit = c.req.query("limit") ?? "20";

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/network/bridges`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");
      url.searchParams.set("limit", limit);

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Network analysis service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Bridge contacts error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: "Network analysis service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/network/bridges`,
        },
        503
      );
    }
  }
);

/**
 * Get detected communities
 * GET /api/v1/intelligence/network/communities
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/network/communities",
  requireScopes("read:intelligence"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const minSize = c.req.query("minSize") ?? "2";
    const limit = c.req.query("limit") ?? "50";

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/network/communities`);
      url.searchParams.set("organization_id", apiKey.organizationId ?? "");
      url.searchParams.set("min_size", minSize);
      url.searchParams.set("limit", limit);

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Network analysis service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Communities error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: "Network analysis service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/network/communities`,
        },
        503
      );
    }
  }
);

/**
 * Find shortest path between two contacts
 * GET /api/v1/intelligence/network/path
 * Requires: read:intelligence scope
 */
intelligenceApi.get(
  "/network/path",
  requireScopes("read:intelligence"),
  async (c) => {
    const fromId = c.req.query("from");
    const toId = c.req.query("to");
    const maxDepth = c.req.query("maxDepth") ?? "6";

    if (!fromId || !toId) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          message: "Both 'from' and 'to' contact IDs are required",
        },
        400
      );
    }

    try {
      const url = new URL(`${INTELLIGENCE_BACKEND_URL}/api/v1/network/path`);
      url.searchParams.set("from", fromId);
      url.searchParams.set("to", toId);
      url.searchParams.set("max_depth", maxDepth);

      const response = await fetch(url.toString());

      if (!response.ok) {
        return c.json(
          {
            error: "SERVICE_UNAVAILABLE",
            message: "Network analysis service is not available. Ensure Python backend is running.",
          },
          503
        );
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch (error) {
      console.error("[Intelligence API] Path finding error:", error);
      return c.json(
        {
          error: "GRAPH_ERROR",
          message: "Network analysis service is not available. Ensure Python backend is running.",
          pythonBackendUrl: `${INTELLIGENCE_BACKEND_URL}/api/v1/network/path`,
        },
        503
      );
    }
  }
);

export { intelligenceApi };
