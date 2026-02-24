import type { Page, Route } from "@playwright/test";

type WorldBrainLane = "internal" | "external" | "bridge";

interface WorldBrainTapeEvent {
  event_id: string;
  lane: WorldBrainLane;
  delta_domain: string;
  severity: string;
  confidence: number;
  summary: string;
  occurred_at?: string;
  impact_bridge?: {
    external_ref?: string;
    internal_ref?: string;
    impact_type?: string;
    severity?: string;
  };
}

interface WorldBrainObligationSignal {
  id: string;
  status: string;
  severity: string;
  confidence: number;
  constraint_title: string;
  occurred_at: string;
}

interface WorldBrainSourceConnection {
  id: string;
  connector_type: string;
  name: string;
  organization_id: string;
  status: string;
  created_at: string;
  last_sync_at: string;
  sync_enabled: boolean;
  streams: string[];
}

interface WorldBrainSourceHealth {
  connection_id: string;
  organization_id: string;
  connector_type: string;
  status: string;
  reason_code: string;
  reason: string;
  last_sync_at: string;
  minutes_since_last_sync: number;
  stale_after_minutes: number;
  sync_slo_breached: boolean;
  sync_slo_minutes: number;
  recent_failures: number;
  recovery_action: string;
  last_error: string | null;
  checked_at: string;
}

interface WorldBrainIngestRun {
  id: string;
  organization_id: string;
  connection_id: string;
  connector_type: string;
  run_kind: string;
  status: string;
  retry_class: string | null;
  scheduled_interval_minutes: number;
  freshness_lag_minutes: number;
  quota_headroom_ratio: number;
  voi_priority: number;
  records_synced: number;
  bytes_synced: number;
  cost_units: number;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  metadata: Record<string, unknown>;
}

interface WorldBrainSourceHistoryJob {
  id: string;
  job_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  records_synced: number;
  bytes_synced: number;
  streams: string[];
  streams_completed: string[];
  streams_failed: string[];
  error_message: string | null;
  extra_data: Record<string, unknown>;
}

interface WorldBrainProofBundle {
  bundle_id: string;
  citations: Array<{ kind: string; ref_id: string }>;
  timeline: Array<{ event: string; at: string }>;
  confidence_reasoning: Record<string, unknown>;
}

interface WorldBrainTriageRequest {
  violation_id: string;
  action: string;
}

export interface WorldBrainE2eState {
  organizationId: string;
  role: string;
  tapeEvents: WorldBrainTapeEvent[];
  contractLanes: {
    internal: WorldBrainTapeEvent[];
    external: WorldBrainTapeEvent[];
    bridge: WorldBrainTapeEvent[];
    world_pressure: Array<{
      entity_id: string;
      pressure_score: number;
      tier: string;
    }>;
  };
  obligationDashboard: {
    summary: {
      active_constraints: number;
      total_signals: number;
      pre_breach_warnings: number;
      post_breach_open: number;
      severity_counts: Record<string, number>;
    };
    pre_breach: WorldBrainObligationSignal[];
    post_breach: WorldBrainObligationSignal[];
    workflows: {
      pre_breach: string[];
      post_breach: string[];
    };
    generated_at: string;
  };
  sourceConnections: WorldBrainSourceConnection[];
  sourceHealthByConnection: Record<string, WorldBrainSourceHealth>;
  ingestRunsByConnection: Record<string, WorldBrainIngestRun[]>;
  sourceHistoryByConnection: Record<string, WorldBrainSourceHistoryJob[]>;
  proofBundlesByEventId: Record<
    string,
    {
      event: WorldBrainTapeEvent;
      proof_bundle: WorldBrainProofBundle;
    }
  >;
  triageRequests: WorldBrainTriageRequest[];
}

function json(route: Route, payload: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function parseBody(request: Parameters<Route["request"]>[0]) {
  const raw = request.postData();
  if (!raw) {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

export function createDefaultWorldBrainState(
  overrides?: Partial<WorldBrainE2eState>
): WorldBrainE2eState {
  const now = Date.now();
  const recentIso = new Date(now - 45 * 60 * 1000).toISOString();
  const previousIso = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const generatedAt = new Date(now - 5 * 60 * 1000).toISOString();
  const orgId = overrides?.organizationId ?? "org_1";
  const role = overrides?.role ?? "pilot_owner";

  const internalEvent: WorldBrainTapeEvent = {
    event_id: "evt_internal_commitment",
    lane: "internal",
    delta_domain: "commitment",
    severity: "high",
    confidence: 0.87,
    summary: "Renewal commitment drifted after risk posture update.",
    occurred_at: previousIso,
  };
  const externalEvent: WorldBrainTapeEvent = {
    event_id: "evt_external_regulatory",
    lane: "external",
    delta_domain: "regulatory",
    severity: "high",
    confidence: 0.84,
    summary: "Disclosure bulletin revised reporting requirements.",
    occurred_at: previousIso,
  };
  const bridgeEvent: WorldBrainTapeEvent = {
    event_id: "evt_bridge_conflict",
    lane: "bridge",
    delta_domain: "impact",
    severity: "critical",
    confidence: 0.93,
    summary: "Disclosure bulletin now conflicts with active renewal promise.",
    occurred_at: recentIso,
    impact_bridge: {
      external_ref: "reg:disclosure_bulletin",
      internal_ref: "crm:renewal_commitment",
      impact_type: "contradicts",
      severity: "critical",
    },
  };

  const state: WorldBrainE2eState = {
    organizationId: orgId,
    role,
    tapeEvents: [internalEvent, externalEvent, bridgeEvent],
    contractLanes: {
      internal: [internalEvent],
      external: [externalEvent],
      bridge: [bridgeEvent],
      world_pressure: [
        {
          entity_id: "acct_nordbridge",
          pressure_score: 8.6,
          tier: "critical",
        },
      ],
    },
    obligationDashboard: {
      summary: {
        active_constraints: 3,
        total_signals: 2,
        pre_breach_warnings: 1,
        post_breach_open: 1,
        severity_counts: { medium: 1, high: 1 },
      },
      pre_breach: [
        {
          id: "viol_1",
          status: "warning",
          severity: "medium",
          confidence: 0.72,
          constraint_title: "Policy update acknowledgement SLA",
          occurred_at: previousIso,
        },
      ],
      post_breach: [
        {
          id: "viol_2",
          status: "open",
          severity: "high",
          confidence: 0.89,
          constraint_title: "Disclosure synchronization breach",
          occurred_at: recentIso,
        },
      ],
      workflows: {
        pre_breach: ["inspect proof bundle", "assign owner"],
        post_breach: ["run simulation", "escalate legal and compliance"],
      },
      generated_at: generatedAt,
    },
    sourceConnections: [
      {
        id: "conn_worldnews",
        connector_type: "worldnewsapi",
        name: "World News API",
        organization_id: orgId,
        status: "active",
        created_at: previousIso,
        last_sync_at: recentIso,
        sync_enabled: true,
        streams: ["top_news", "search_news"],
      },
    ],
    sourceHealthByConnection: {
      conn_worldnews: {
        connection_id: "conn_worldnews",
        organization_id: orgId,
        connector_type: "worldnewsapi",
        status: "degraded",
        reason_code: "lagging",
        reason: "freshness lag exceeded threshold",
        last_sync_at: recentIso,
        minutes_since_last_sync: 42,
        stale_after_minutes: 20,
        sync_slo_breached: true,
        sync_slo_minutes: 20,
        recent_failures: 1,
        recovery_action: "auto_recovery_queued",
        last_error: "provider 429",
        checked_at: generatedAt,
      },
    },
    ingestRunsByConnection: {
      conn_worldnews: [
        {
          id: "run_worldnews_1",
          organization_id: orgId,
          connection_id: "conn_worldnews",
          connector_type: "worldnewsapi",
          run_kind: "incremental",
          status: "failed",
          retry_class: "quota",
          scheduled_interval_minutes: 5,
          freshness_lag_minutes: 42,
          quota_headroom_ratio: 0.15,
          voi_priority: 0.91,
          records_synced: 126,
          bytes_synced: 18240,
          cost_units: 1.4,
          started_at: previousIso,
          completed_at: recentIso,
          duration_seconds: 90,
          metadata: {},
        },
      ],
    },
    sourceHistoryByConnection: {
      conn_worldnews: [
        {
          id: "job_worldnews_replay_1",
          job_type: "replay",
          status: "queued",
          started_at: recentIso,
          completed_at: null,
          duration_seconds: null,
          records_synced: 0,
          bytes_synced: 0,
          streams: ["events"],
          streams_completed: [],
          streams_failed: [],
          error_message: null,
          extra_data: { operator_replay: true },
        },
      ],
    },
    proofBundlesByEventId: {
      evt_bridge_conflict: {
        event: {
          ...bridgeEvent,
          summary: "Bridge proof: disclosure contradiction",
        },
        proof_bundle: {
          bundle_id: "proof_evt_bridge_conflict",
          citations: [{ kind: "evidence_link", ref_id: "evidence_world_1" }],
          timeline: [{ event: "belief_revision", at: previousIso }],
          confidence_reasoning: { source_quality: 0.92, corroboration_count: 2 },
        },
      },
      evt_internal_commitment: {
        event: internalEvent,
        proof_bundle: {
          bundle_id: "proof_evt_internal_commitment",
          citations: [{ kind: "evidence_link", ref_id: "evidence_internal_1" }],
          timeline: [{ event: "commitment_revision", at: previousIso }],
          confidence_reasoning: { source_quality: 0.9, corroboration_count: 1 },
        },
      },
      evt_external_regulatory: {
        event: externalEvent,
        proof_bundle: {
          bundle_id: "proof_evt_external_regulatory",
          citations: [{ kind: "evidence_link", ref_id: "evidence_external_1" }],
          timeline: [{ event: "regulatory_delta", at: previousIso }],
          confidence_reasoning: { source_quality: 0.88, corroboration_count: 1 },
        },
      },
    },
    triageRequests: [],
  };

  return {
    ...state,
    ...overrides,
  };
}

export async function installWorldBrainApiMocks(
  page: Page,
  state: WorldBrainE2eState
) {
  await page.route("**/api/v1/org/manifest", async (route) => {
    const payload = {
      plugins: [],
      uio_types: [],
      capabilities: {
        "world.brain.read": true,
      },
      ui_hints: {
        world_brain: {
          enabled: true,
          allowed_org_ids: [state.organizationId],
          allowed_roles: [state.role],
          rollout_percent: 100,
        },
      },
    };
    return json(route, payload);
  });

  await page.route("**/api/v1/console/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/console/saved-searches" && method === "GET") {
      return json(route, []);
    }

    if (path === "/api/v1/console/saved-searches" && method === "POST") {
      const body = parseBody(request);
      return json(route, {
        id: "saved_search_1",
        name: String(body.name ?? "World Brain Watchlist"),
        query: String(body.query ?? "lane:bridge severity:high"),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    if (path.startsWith("/api/v1/console/saved-searches/") && method === "DELETE") {
      return json(route, {
        id: path.split("/").pop() ?? "saved_search_1",
        deleted: true,
      });
    }

    if (path === "/api/v1/console/entities" && method === "GET") {
      return json(route, []);
    }

    if (path === "/api/v1/console/query" && method === "POST") {
      return json(route, {
        items: [],
        aggregations: {},
        metrics: {
          total_count: 0,
          active_count: 0,
          at_risk_count: 0,
          overdue_count: 0,
          avg_confidence: 0,
          signal_quality: 0,
          ai_calibration: 0,
          blindspot_count: 0,
        },
        timeseries: [],
        next_cursor: null,
        has_more: false,
      });
    }

    return json(route, { ok: true });
  });

  await page.route("**/api/v1/brain/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/brain/tape" && method === "GET") {
      return json(route, {
        success: true,
        count: state.tapeEvents.length,
        items: state.tapeEvents,
      });
    }

    if (path === "/api/v1/brain/tape/live-contract" && method === "GET") {
      return json(route, {
        success: true,
        contract: {
          organization_id: state.organizationId,
          lanes: state.contractLanes,
          visualization_contract: {},
          filters: {},
        },
      });
    }

    if (path.startsWith("/api/v1/brain/tape/") && method === "GET") {
      const eventId = decodeURIComponent(path.split("/").pop() ?? "");
      const proofPayload =
        state.proofBundlesByEventId[eventId] ??
        state.proofBundlesByEventId.evt_bridge_conflict;
      return json(route, {
        success: true,
        event: proofPayload.event,
        proof_bundle: proofPayload.proof_bundle,
      });
    }

    if (
      path === "/api/v1/brain/obligation-sentinel/dashboard" &&
      method === "GET"
    ) {
      return json(route, {
        success: true,
        dashboard: state.obligationDashboard,
      });
    }

    if (
      path === "/api/v1/brain/obligation-sentinel/triage" &&
      method === "POST"
    ) {
      const body = parseBody(request);
      const violationId = String(body.violation_id ?? "viol_2");
      const action = String(body.action ?? "simulate_impact");
      state.triageRequests.push({
        violation_id: violationId,
        action,
      });
      return json(route, {
        success: true,
        triage: {
          violation_id: violationId,
          action,
          status: "open",
          severity: "high",
          recommended_steps: [
            "run counterfactual with current obligations",
            "compare intervention options",
          ],
          counterfactual_preview: {
            simulation_id: `sim_triage_${violationId}`,
            risk_score: 0.53,
            downside_risk_estimate: 0.19,
            utility_delta: 0.12,
          },
          generated_at: new Date().toISOString(),
        },
      });
    }

    if (path === "/api/v1/brain/counterfactual-lab/compare" && method === "POST") {
      return json(route, {
        success: true,
        comparison: {
          preferred: "a",
          score_a: 0.41,
          score_b: 0.21,
          delta: 0.2,
          scenario_a: {
            simulation_id: "sim_a",
            scenario_name: "baseline_case",
            simulated: { risk_score: 0.4 },
            utility: { simulated_utility: 0.6, utility_delta: 0.11 },
            downside_risk_estimate: 0.16,
          },
          scenario_b: {
            simulation_id: "sim_b",
            scenario_name: "stress_case",
            simulated: { risk_score: 0.62 },
            utility: { simulated_utility: 0.39, utility_delta: 0.03 },
            downside_risk_estimate: 0.28,
          },
          intervention_previews: {
            a: {
              intervention_id: "intv_a",
              policy_class: "p2_guardrailed",
              rollback_steps: ["revert hedging profile"],
              rollback_verification: { is_verified: true },
            },
            b: {
              intervention_id: "intv_b",
              policy_class: "p1_human_approval",
              rollback_steps: ["revert escalation workflow"],
              rollback_verification: { is_verified: true },
            },
          },
          generated_at: new Date().toISOString(),
        },
      });
    }

    if (path === "/api/v1/brain/interventions/outcomes" && method === "POST") {
      return json(route, {
        success: true,
        enqueued: false,
        result: {
          realized_outcome_id: "outcome_signal_feedback_1",
          intervention_plan_id: null,
          outcome_type: "signal_feedback.confirmed",
          outcome_payload: {},
          outcome_hash: "hash_signal_feedback_1",
          measured_at: new Date().toISOString(),
        },
      });
    }

    return json(route, { ok: true });
  });

  await page.route("**/api/v1/connections", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET") {
      return json(route, state.sourceConnections);
    }
    return json(route, { ok: true });
  });

  await page.route("**/api/v1/connections/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const parts = path.split("/");
    const connectionId = parts[4] ?? "";

    if (path.endsWith("/health") && method === "GET") {
      return json(route, state.sourceHealthByConnection[connectionId] ?? {});
    }

    if (path.endsWith("/ingest/runs") && method === "GET") {
      return json(route, {
        connection_id: connectionId,
        runs: state.ingestRunsByConnection[connectionId] ?? [],
      });
    }

    if (path.endsWith("/ingest/pause") && method === "POST") {
      return json(route, {
        connection_id: connectionId,
        status: "paused",
      });
    }

    if (path.endsWith("/ingest/resume") && method === "POST") {
      return json(route, {
        connection_id: connectionId,
        status: "active",
      });
    }

    if (path.endsWith("/ingest/replay") && method === "POST") {
      return json(route, {
        connection_id: connectionId,
        status: "queued",
        replay_job_id: `replay_${connectionId}_1`,
      });
    }

    return json(route, { ok: true });
  });

  await page.route("**/api/v1/org/connections/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const parts = path.split("/");
    const connectionId = parts[5] ?? "";

    if (path.endsWith("/history") && method === "GET") {
      return json(route, {
        connection_id: connectionId,
        jobs: state.sourceHistoryByConnection[connectionId] ?? [],
      });
    }

    if (path.endsWith("/backfill") && method === "POST") {
      return json(route, {
        connection_id: connectionId,
        status: "queued",
        backfill_jobs: [`backfill_${connectionId}_1`],
      });
    }

    return json(route, { ok: true });
  });
}
