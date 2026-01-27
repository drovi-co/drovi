// =============================================================================
// GRAPH BACKFILL TRIGGER.DEV TASKS
// =============================================================================
//
// Backfills existing data from PostgreSQL into the FalkorDB knowledge graph.
// Syncs UIOs, contacts, tasks, and relationships.
//

import { db } from "@memorystack/db";
import {
  contact,
  task as taskTable,
  unifiedIntelligenceObject,
} from "@memorystack/db/schema";
import { schedules, task } from "@trigger.dev/sdk";
import { desc, eq } from "drizzle-orm";
import { checkIntelligenceBackendHealth } from "../lib/intelligence-backend";
import { log } from "../lib/logger";

// =============================================================================
// PYTHON BACKEND URL
// =============================================================================

const INTELLIGENCE_BACKEND_URL =
  process.env.INTELLIGENCE_BACKEND_URL ?? "http://localhost:8000";

// =============================================================================
// TYPES
// =============================================================================

interface GraphBackfillPayload {
  organizationId: string;
  batchSize?: number;
  offset?: number;
}

interface OrganizationBackfillPayload {
  organizationId: string;
}

interface FullBackfillPayload {
  batchSize?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_BATCH_SIZE = 100;
const QUEUE_CONCURRENCY = 2;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Call Python backend graph endpoint.
 */
async function callGraphBackfill(
  endpoint: string,
  body: Record<string, unknown>
): Promise<{ success: boolean; error?: string; data?: unknown }> {
  try {
    const isHealthy = await checkIntelligenceBackendHealth();
    if (!isHealthy) {
      return { success: false, error: "Python backend not available" };
    }

    const response = await fetch(`${INTELLIGENCE_BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// UIO BACKFILL TASK
// =============================================================================

/**
 * Backfill UIOs to the knowledge graph for an organization.
 */
export const graphBackfillUIOsTask = task({
  id: "graph-backfill-uios",
  queue: {
    name: "graph-backfill",
    concurrencyLimit: QUEUE_CONCURRENCY,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
  },
  run: async (payload: GraphBackfillPayload) => {
    const {
      organizationId,
      batchSize = DEFAULT_BATCH_SIZE,
      offset = 0,
    } = payload;

    log.info(
      `[GraphBackfill] Starting UIO backfill for org ${organizationId}, offset ${offset}`
    );

    // Fetch batch of UIOs
    const uios = await db.query.unifiedIntelligenceObject.findMany({
      where: eq(unifiedIntelligenceObject.organizationId, organizationId),
      orderBy: [desc(unifiedIntelligenceObject.createdAt)],
      limit: batchSize,
      offset,
      with: {
        owner: true,
        sources: {
          limit: 10,
        },
      },
    });

    if (uios.length === 0) {
      log.info(
        `[GraphBackfill] UIO backfill complete for org ${organizationId}`
      );
      return { completed: true, totalProcessed: offset };
    }

    // Call Python backend to backfill UIOs
    const result = await callGraphBackfill("/api/v1/graph/backfill/uios", {
      organization_id: organizationId,
      uios: uios.map((uio) => ({
        id: uio.id,
        type: uio.type,
        title: uio.canonicalTitle,
        description: uio.canonicalDescription,
        status: uio.status,
        confidence: uio.overallConfidence,
        due_date: uio.dueDate?.toISOString(),
        owner_contact_id: uio.ownerContactId,
        sources: (uio.sources ?? []).map((s) => ({
          conversation_id: s.conversationId,
          role: s.role,
          confidence: s.confidence,
        })),
      })),
    });

    if (!result.success) {
      log.warn(`[GraphBackfill] Python backend not available: ${result.error}`);
      return { skipped: true, reason: result.error };
    }

    log.info("[GraphBackfill] UIO batch complete via Python backend");

    // If we got a full batch, there might be more
    if (uios.length === batchSize) {
      await graphBackfillUIOsTask.trigger({
        organizationId,
        batchSize,
        offset: offset + batchSize,
      });
    }

    return {
      batchProcessed: uios.length,
      nextOffset: uios.length === batchSize ? offset + batchSize : null,
      pythonResult: result.data,
    };
  },
});

// =============================================================================
// CONTACT BACKFILL TASK
// =============================================================================

/**
 * Backfill contacts to the knowledge graph for an organization.
 */
export const graphBackfillContactsTask = task({
  id: "graph-backfill-contacts",
  queue: {
    name: "graph-backfill",
    concurrencyLimit: QUEUE_CONCURRENCY,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
  },
  run: async (payload: GraphBackfillPayload) => {
    const {
      organizationId,
      batchSize = DEFAULT_BATCH_SIZE,
      offset = 0,
    } = payload;

    log.info(
      `[GraphBackfill] Starting contact backfill for org ${organizationId}, offset ${offset}`
    );

    // Fetch batch of contacts
    const contacts = await db.query.contact.findMany({
      orderBy: [desc(contact.createdAt)],
      limit: batchSize * 2,
      offset,
    });

    // Filter by organization
    const orgContacts = contacts
      .filter((c) => c.organizationId === organizationId)
      .slice(0, batchSize);

    if (orgContacts.length === 0) {
      log.info(
        `[GraphBackfill] Contact backfill complete for org ${organizationId}`
      );
      return { completed: true, totalProcessed: offset };
    }

    // Call Python backend to backfill contacts
    const result = await callGraphBackfill("/api/v1/graph/backfill/contacts", {
      organization_id: organizationId,
      contacts: orgContacts.map((c) => ({
        id: c.id,
        display_name: c.displayName,
        emails: c.emails,
        company: c.company,
        importance_score: c.importanceScore,
        health_score: c.healthScore,
        is_internal: c.isInternal,
      })),
    });

    if (!result.success) {
      log.warn(`[GraphBackfill] Python backend not available: ${result.error}`);
      return { skipped: true, reason: result.error };
    }

    log.info("[GraphBackfill] Contact batch complete via Python backend");

    if (orgContacts.length === batchSize) {
      await graphBackfillContactsTask.trigger({
        organizationId,
        batchSize,
        offset: offset + batchSize,
      });
    }

    return {
      batchProcessed: orgContacts.length,
      nextOffset: orgContacts.length === batchSize ? offset + batchSize : null,
      pythonResult: result.data,
    };
  },
});

// =============================================================================
// TASK BACKFILL TASK
// =============================================================================

/**
 * Backfill tasks to the knowledge graph for an organization.
 */
export const graphBackfillTasksToGraphTask = task({
  id: "graph-backfill-tasks",
  queue: {
    name: "graph-backfill",
    concurrencyLimit: QUEUE_CONCURRENCY,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
  },
  run: async (payload: GraphBackfillPayload) => {
    const {
      organizationId,
      batchSize = DEFAULT_BATCH_SIZE,
      offset = 0,
    } = payload;

    log.info(
      `[GraphBackfill] Starting task backfill for org ${organizationId}, offset ${offset}`
    );

    // Fetch batch of tasks
    const tasks = await db.query.task.findMany({
      where: eq(taskTable.organizationId, organizationId),
      orderBy: [desc(taskTable.createdAt)],
      limit: batchSize,
      offset,
    });

    if (tasks.length === 0) {
      log.info(
        `[GraphBackfill] Task backfill complete for org ${organizationId}`
      );
      return { completed: true, totalProcessed: offset };
    }

    // Call Python backend to backfill tasks
    const result = await callGraphBackfill("/api/v1/graph/backfill/tasks", {
      organization_id: organizationId,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        due_date: t.dueDate?.toISOString(),
        completed_at: t.completedAt?.toISOString(),
        source_type: t.sourceType,
        source_uio_id: t.sourceUIOId,
      })),
    });

    if (!result.success) {
      log.warn(`[GraphBackfill] Python backend not available: ${result.error}`);
      return { skipped: true, reason: result.error };
    }

    log.info("[GraphBackfill] Task batch complete via Python backend");

    if (tasks.length === batchSize) {
      await graphBackfillTasksToGraphTask.trigger({
        organizationId,
        batchSize,
        offset: offset + batchSize,
      });
    }

    return {
      batchProcessed: tasks.length,
      nextOffset: tasks.length === batchSize ? offset + batchSize : null,
      pythonResult: result.data,
    };
  },
});

// =============================================================================
// ORGANIZATION BACKFILL ORCHESTRATOR
// =============================================================================

/**
 * Orchestrate full graph backfill for a single organization.
 * Triggers all entity-specific backfill tasks in parallel.
 */
export const graphBackfillOrganizationTask = task({
  id: "graph-backfill-organization",
  queue: {
    name: "graph-backfill-orchestrator",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: OrganizationBackfillPayload) => {
    const { organizationId } = payload;

    log.info(
      `[GraphBackfill] Starting full backfill for organization ${organizationId}`
    );

    // Trigger all entity backfill tasks in parallel
    const [contactsHandle, uiosHandle, tasksHandle] = await Promise.all([
      graphBackfillContactsTask.trigger({ organizationId }),
      graphBackfillUIOsTask.trigger({ organizationId }),
      graphBackfillTasksToGraphTask.trigger({ organizationId }),
    ]);

    return {
      organizationId,
      triggered: {
        contacts: contactsHandle.id,
        uios: uiosHandle.id,
        tasks: tasksHandle.id,
      },
    };
  },
});

// =============================================================================
// FULL BACKFILL TASK
// =============================================================================

/**
 * Backfill all organizations to the knowledge graph.
 * Use with caution - this can be a heavy operation.
 */
export const graphBackfillAllOrganizationsTask = task({
  id: "graph-backfill-all",
  queue: {
    name: "graph-backfill-orchestrator",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: FullBackfillPayload) => {
    const { batchSize = 10 } = payload;

    log.info(
      "[GraphBackfill] Starting full graph backfill for all organizations"
    );

    // Get all organizations
    const organizations = await db.query.organization.findMany({
      limit: batchSize,
    });

    const handles = [];
    for (const org of organizations) {
      const handle = await graphBackfillOrganizationTask.trigger({
        organizationId: org.id,
      });
      handles.push({ organizationId: org.id, handleId: handle.id });
    }

    return {
      organizationsTriggered: handles.length,
      handles,
    };
  },
});

// =============================================================================
// GRAPH ALGORITHM TASKS
// =============================================================================

/**
 * Calculate and update contact importance scores (PageRank-like algorithm).
 * This helps identify the most influential contacts in the network.
 */
export const graphCalculateContactImportanceTask = task({
  id: "graph-calculate-contact-importance",
  queue: {
    name: "graph-algorithms",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Calculating contact importance for org ${organizationId}`
    );

    const result = await callGraphBackfill(
      "/api/v1/graph/algorithms/contact-importance",
      {
        organization_id: organizationId,
      }
    );

    if (!result.success) {
      return { skipped: true, reason: result.error };
    }

    log.info(
      "[GraphAlgorithms] Contact importance calculation complete via Python"
    );

    return {
      success: true,
      organizationId,
      pythonResult: result.data,
    };
  },
});

/**
 * Detect and store communities (teams/groups) in the contact network.
 * Uses clustering based on communication patterns and company affiliation.
 */
export const graphDetectCommunitiesTask = task({
  id: "graph-detect-communities",
  queue: {
    name: "graph-algorithms",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Detecting communities for org ${organizationId}`
    );

    const result = await callGraphBackfill(
      "/api/v1/graph/algorithms/communities",
      {
        organization_id: organizationId,
      }
    );

    if (!result.success) {
      return { skipped: true, reason: result.error };
    }

    log.info("[GraphAlgorithms] Community detection complete via Python");

    return {
      success: true,
      organizationId,
      pythonResult: result.data,
    };
  },
});

/**
 * Find bridge contacts (people who connect different communities).
 * High betweenness centrality indicates bridge contacts.
 */
export const graphFindBridgeContactsTask = task({
  id: "graph-find-bridge-contacts",
  queue: {
    name: "graph-algorithms",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Finding bridge contacts for org ${organizationId}`
    );

    const result = await callGraphBackfill("/api/v1/graph/algorithms/bridges", {
      organization_id: organizationId,
    });

    if (!result.success) {
      return { skipped: true, reason: result.error };
    }

    log.info("[GraphAlgorithms] Bridge contact detection complete via Python");

    return {
      success: true,
      organizationId,
      pythonResult: result.data,
    };
  },
});

/**
 * Calculate and update relationship strengths between contacts.
 */
export const graphUpdateRelationshipStrengthsTask = task({
  id: "graph-update-relationship-strengths",
  queue: {
    name: "graph-algorithms",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Updating relationship strengths for org ${organizationId}`
    );

    const result = await callGraphBackfill(
      "/api/v1/graph/algorithms/relationship-strengths",
      {
        organization_id: organizationId,
      }
    );

    if (!result.success) {
      return { skipped: true, reason: result.error };
    }

    log.info(
      "[GraphAlgorithms] Relationship strengths update complete via Python"
    );

    return {
      success: true,
      organizationId,
      pythonResult: result.data,
    };
  },
});

/**
 * Calculate overall network metrics for an organization.
 */
export const graphCalculateNetworkMetricsTask = task({
  id: "graph-calculate-network-metrics",
  queue: {
    name: "graph-algorithms",
    concurrencyLimit: 2,
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60_000,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Calculating network metrics for org ${organizationId}`
    );

    const result = await callGraphBackfill(
      "/api/v1/graph/algorithms/network-metrics",
      {
        organization_id: organizationId,
      }
    );

    if (!result.success) {
      return { skipped: true, reason: result.error };
    }

    log.info(
      "[GraphAlgorithms] Network metrics calculation complete via Python"
    );

    return {
      success: true,
      organizationId,
      pythonResult: result.data,
    };
  },
});

/**
 * Run all graph algorithms for an organization.
 * Orchestrates all algorithm tasks.
 */
export const graphRunAllAlgorithmsTask = task({
  id: "graph-run-all-algorithms",
  queue: {
    name: "graph-algorithms-orchestrator",
    concurrencyLimit: 1,
  },
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: { organizationId: string }) => {
    const { organizationId } = payload;

    log.info(
      `[GraphAlgorithms] Running all algorithms for org ${organizationId}`
    );

    // Run algorithms in sequence (some depend on others)
    const importanceHandle = await graphCalculateContactImportanceTask.trigger({
      organizationId,
    });
    const strengthsHandle = await graphUpdateRelationshipStrengthsTask.trigger({
      organizationId,
    });
    const communitiesHandle = await graphDetectCommunitiesTask.trigger({
      organizationId,
    });
    const bridgesHandle = await graphFindBridgeContactsTask.trigger({
      organizationId,
    });
    const metricsHandle = await graphCalculateNetworkMetricsTask.trigger({
      organizationId,
    });

    return {
      organizationId,
      triggered: {
        importance: importanceHandle.id,
        strengths: strengthsHandle.id,
        communities: communitiesHandle.id,
        bridges: bridgesHandle.id,
        metrics: metricsHandle.id,
      },
    };
  },
});

// =============================================================================
// SCHEDULED TASKS (NIGHTLY JOBS)
// =============================================================================

/**
 * Nightly job to run all graph algorithms for all organizations.
 * Runs at 2 AM daily.
 */
export const nightlyGraphAlgorithmsSchedule = schedules.task({
  id: "nightly-graph-algorithms",
  cron: "0 2 * * *", // 2 AM daily
  run: async () => {
    log.info("[GraphAlgorithms] Starting nightly graph algorithms run");

    // Get all organizations
    const organizations = await db.query.organization.findMany();

    const handles = [];
    for (const org of organizations) {
      const handle = await graphRunAllAlgorithmsTask.trigger({
        organizationId: org.id,
      });
      handles.push({ organizationId: org.id, handleId: handle.id });
    }

    log.info(
      `[GraphAlgorithms] Triggered algorithms for ${handles.length} organizations`
    );

    return {
      organizationsTriggered: handles.length,
      handles,
    };
  },
});
