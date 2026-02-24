import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { server } from "../../../../test/msw/server";
import { APIError, apiFetch, intelligenceAPI, sseAPI, worldBrainAPI } from "./api";

describe("apiFetch (MSW)", () => {
  it("throws API_UNREACHABLE on network errors", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.error()
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "ApiError",
      code: "api.unreachable",
      status: 0,
    });
  });

  it("maps 401 to UNAUTHENTICATED", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "ApiError",
      code: "auth.unauthorized",
      status: 401,
    });
  });

  it("maps 403 to FORBIDDEN", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "Forbidden" }, { status: 403 })
      )
    );

    await expect(apiFetch("/org/info")).rejects.toMatchObject({
      name: "ApiError",
      code: "auth.forbidden",
      status: 403,
    });
  });

  it("maps 500 to SERVER_ERROR and preserves detail", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/org/info", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 })
      )
    );

    try {
      await apiFetch("/org/info");
      throw new Error("expected apiFetch to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      const apiErr = err as APIError;
      expect(apiErr.code).toBe("internal.unhandled");
      expect(apiErr.detail).toBe("boom");
      expect(apiErr.status).toBe(500);
    }
  });
});

describe("intelligenceAPI.listUIOs (pagination)", () => {
  it("passes cursor/limit and maps has_more to hasMore", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/uios/v2", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("cursor")).toBe("c1");
        expect(url.searchParams.get("limit")).toBe("2");

        return HttpResponse.json(
          {
            items: [
              {
                id: "uio_1",
                type: "task",
                canonical_title: "Prepare pilot demo",
                canonical_description: "Seed realistic org data",
                status: "active",
                overall_confidence: 0.9,
                confidence_tier: "high",
                is_user_verified: false,
                is_user_dismissed: false,
                due_date: null,
                created_at: "2026-02-10T00:00:00Z",
                updated_at: null,
                first_seen_at: null,
                owner: null,
                debtor: null,
                creditor: null,
                decision_maker: null,
                assignee: null,
                created_by: null,
                commitment_details: null,
                decision_details: null,
                task_details: null,
                risk_details: null,
                claim_details: null,
                brief_details: null,
                sources: [],
                evidence_id: null,
              },
            ],
            total: 1,
            cursor: "c2",
            has_more: true,
          },
          { status: 200 }
        );
      })
    );

    const res = await intelligenceAPI.listUIOs({ cursor: "c1", limit: 2 });
    expect(res.cursor).toBe("c2");
    expect(res.hasMore).toBe(true);
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.canonicalTitle).toBe("Prepare pilot demo");
  });
});

describe("sseAPI (disconnect handling)", () => {
  it("calls onError and closes the EventSource on cleanup", () => {
    const onError = vi.fn();

    interface FakeEventSourceInstance {
      close: () => void;
      addEventListener: (type: string, listener: EventListener) => void;
      onerror?: (event: Event) => void;
    }

    let lastInstance: FakeEventSourceInstance | null = null;

    class FakeEventSource implements FakeEventSourceInstance {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: Event) => void;
      addEventListener = vi.fn();

      constructor() {
        lastInstance = this;
      }

      close = vi.fn();
    }

    const prevDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "EventSource"
    );
    Object.defineProperty(globalThis, "EventSource", {
      value: FakeEventSource,
      configurable: true,
    });

    try {
      const cleanup = sseAPI.subscribeSyncProgress(
        "conn_1",
        () => {
          // No-op.
        },
        onError
      );
      if (!lastInstance) {
        throw new Error("Expected FakeEventSource to be constructed");
      }
      const instance = lastInstance as unknown as FakeEventSourceInstance;
      expect(instance).toBeDefined();
      instance.onerror?.(new Event("error"));
      expect(onError).toHaveBeenCalledTimes(1);
      cleanup();
      expect(instance.close).toHaveBeenCalledTimes(1);
    } finally {
      // Restore global to avoid cross-test pollution.
      if (prevDescriptor) {
        Object.defineProperty(globalThis, "EventSource", prevDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "EventSource");
      }
    }
  });
});

describe("worldBrainAPI", () => {
  it("requests tape feed with expected query parameters", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/brain/tape", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("organization_id")).toBe("org_test");
        expect(url.searchParams.get("hours")).toBe("24");
        expect(url.searchParams.get("limit")).toBe("50");
        expect(url.searchParams.get("lane")).toBe("internal");
        expect(url.searchParams.get("delta_domain")).toBe("belief");
        expect(url.searchParams.get("min_confidence")).toBe("0.6");
        return HttpResponse.json(
          {
            success: true,
            count: 1,
            items: [
              {
                event_id: "evt_1",
                lane: "internal",
                delta_domain: "belief",
                severity: "medium",
                confidence: 0.8,
                summary: "Belief update",
              },
            ],
          },
          { status: 200 }
        );
      })
    );

    const response = await worldBrainAPI.listTape({
      organizationId: "org_test",
      hours: 24,
      limit: 50,
      lane: "internal",
      deltaDomain: "belief",
      minConfidence: 0.6,
    });
    expect(response.success).toBe(true);
    expect(response.count).toBe(1);
    expect(response.items[0]?.event_id).toBe("evt_1");
  });

  it("requests obligation sentinel dashboard", async () => {
    server.use(
      http.get(
        "http://localhost:3001/api/v1/brain/obligation-sentinel/dashboard",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("organization_id")).toBe("org_test");
          expect(url.searchParams.get("limit")).toBe("25");
          return HttpResponse.json(
            {
              success: true,
              dashboard: {
                summary: {
                  active_constraints: 2,
                  total_signals: 3,
                  pre_breach_warnings: 1,
                  post_breach_open: 1,
                  severity_counts: { high: 1, medium: 2 },
                },
                pre_breach: [],
                post_breach: [],
                workflows: {},
                generated_at: "2026-02-23T10:00:00Z",
              },
            },
            { status: 200 }
          );
        }
      )
    );

    const response = await worldBrainAPI.getObligationDashboard({
      organizationId: "org_test",
      limit: 25,
    });
    expect(response.dashboard.summary.active_constraints).toBe(2);
    expect(response.dashboard.summary.post_breach_open).toBe(1);
  });

  it("requests proof bundle expansion for one tape event", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/brain/tape/evt_internal", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("organization_id")).toBe("org_test");
        return HttpResponse.json(
          {
            success: true,
            event: {
              event_id: "evt_internal",
              lane: "internal",
              delta_domain: "belief",
              severity: "medium",
              confidence: 0.77,
              summary: "Belief updated",
            },
            proof_bundle: {
              bundle_id: "proof:evt_internal",
              citations: [{ kind: "evidence_link", ref_id: "ev_1" }],
              timeline: [{ event: "belief_revision" }],
            },
          },
          { status: 200 }
        );
      })
    );

    const response = await worldBrainAPI.getTapeEvent({
      organizationId: "org_test",
      eventId: "evt_internal",
    });
    expect(response.event.event_id).toBe("evt_internal");
    expect(response.proof_bundle.bundle_id).toBe("proof:evt_internal");
    expect(response.proof_bundle.citations?.[0]?.ref_id).toBe("ev_1");
  });

  it("posts obligation triage actions", async () => {
    server.use(
      http.post(
        "http://localhost:3001/api/v1/brain/obligation-sentinel/triage",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.organization_id).toBe("org_test");
          expect(body.violation_id).toBe("viol_2");
          expect(body.action).toBe("simulate_impact");
          expect(body.notes).toBe("board escalation");
          expect(body.include_counterfactual_preview).toBe(true);
          return HttpResponse.json(
            {
              success: true,
              triage: {
                violation_id: "viol_2",
                action: "simulate_impact",
                status: "open",
                severity: "high",
                recommended_steps: [
                  "run counterfactual with current obligations",
                  "compare intervention options",
                ],
                notes: "board escalation",
                counterfactual_preview: {
                  simulation_id: "sim_triage",
                  risk_score: 0.52,
                  downside_risk_estimate: 0.18,
                  utility_delta: 0.11,
                },
                generated_at: "2026-02-23T11:30:00Z",
              },
            },
            { status: 200 }
          );
        }
      )
    );

    const response = await worldBrainAPI.triageObligationSignal({
      organizationId: "org_test",
      violationId: "viol_2",
      action: "simulate_impact",
      notes: "board escalation",
      includeCounterfactualPreview: true,
    });

    expect(response.success).toBe(true);
    expect(response.triage.violation_id).toBe("viol_2");
    expect(response.triage.action).toBe("simulate_impact");
    expect(response.triage.counterfactual_preview?.simulation_id).toBe(
      "sim_triage"
    );
  });

  it("posts counterfactual lab scenario comparisons", async () => {
    server.use(
      http.post(
        "http://localhost:3001/api/v1/brain/counterfactual-lab/compare",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.organization_id).toBe("org_test");
          expect((body.scenario_a as Record<string, unknown>)?.scenario_name).toBe(
            "baseline"
          );
          expect((body.scenario_a as Record<string, unknown>)?.horizon_days).toBe(30);
          expect((body.scenario_b as Record<string, unknown>)?.scenario_name).toBe(
            "stress"
          );
          expect((body.scenario_b as Record<string, unknown>)?.horizon_days).toBe(60);
          expect(body.target_ref).toBe("portfolio_risk");
          expect(body.max_constraint_severity).toBe("high");
          expect(body.generate_interventions).toBe(true);
          return HttpResponse.json(
            {
              success: true,
              comparison: {
                preferred: "a",
                score_a: 0.44,
                score_b: 0.2,
                delta: 0.24,
                scenario_a: {
                  simulation_id: "sim_a",
                  scenario_name: "baseline",
                  simulated: { risk_score: 0.41 },
                  utility: { simulated_utility: 0.58, utility_delta: 0.14 },
                  downside_risk_estimate: 0.14,
                },
                scenario_b: {
                  simulation_id: "sim_b",
                  scenario_name: "stress",
                  simulated: { risk_score: 0.65 },
                  utility: { simulated_utility: 0.44, utility_delta: 0.05 },
                  downside_risk_estimate: 0.24,
                },
                intervention_previews: {
                  a: {
                    intervention_id: "intv_a",
                    policy_class: "p2_guardrailed",
                    rollback_steps: ["rollback step_1: undo action"],
                    rollback_verification: { is_verified: true },
                  },
                  b: {
                    intervention_id: "intv_b",
                    policy_class: "p1_human_approval",
                    rollback_steps: ["rollback step_1: undo action"],
                    rollback_verification: { is_verified: true },
                  },
                },
                generated_at: "2026-02-23T12:00:00Z",
              },
            },
            { status: 200 }
          );
        }
      )
    );

    const response = await worldBrainAPI.compareCounterfactualLab({
      organizationId: "org_test",
      scenarioA: {
        scenarioName: "baseline",
        horizonDays: 30,
      },
      scenarioB: {
        scenarioName: "stress",
        horizonDays: 60,
      },
      targetRef: "portfolio_risk",
      maxConstraintSeverity: "high",
      recommendedActions: ["stage mitigation", "notify legal"],
      generateInterventions: true,
    });

    expect(response.success).toBe(true);
    expect(response.comparison.preferred).toBe("a");
    expect(response.comparison.intervention_previews.a?.intervention_id).toBe(
      "intv_a"
    );
  });

  it("lists source connections for an organization", async () => {
    server.use(
      http.get("http://localhost:3001/api/v1/connections", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("organization_id")).toBe("org_test");
        expect(url.searchParams.get("connector_type")).toBe("worldnewsapi");
        return HttpResponse.json(
          [
            {
              id: "conn_worldnews",
              connector_type: "worldnewsapi",
              name: "World News API",
              organization_id: "org_test",
              status: "active",
              created_at: "2026-02-23T11:00:00Z",
              last_sync_at: "2026-02-23T11:59:00Z",
              sync_enabled: true,
              streams: ["top_news"],
            },
          ],
          { status: 200 }
        );
      })
    );

    const response = await worldBrainAPI.listSourceConnections({
      organizationId: "org_test",
      connectorType: "worldnewsapi",
    });
    expect(response).toHaveLength(1);
    expect(response[0]?.id).toBe("conn_worldnews");
    expect(response[0]?.connector_type).toBe("worldnewsapi");
  });

  it("fetches source health and ingest run ledger", async () => {
    server.use(
      http.get(
        "http://localhost:3001/api/v1/connections/conn_worldnews/health",
        () =>
          HttpResponse.json(
            {
              connection_id: "conn_worldnews",
              organization_id: "org_test",
              connector_type: "worldnewsapi",
              status: "degraded",
              reason_code: "lagging",
              reason: "freshness lag exceeded threshold",
              last_sync_at: "2026-02-23T11:40:00Z",
              minutes_since_last_sync: 35,
              stale_after_minutes: 20,
              sync_slo_breached: true,
              sync_slo_minutes: 20,
              recent_failures: 2,
              recovery_action: "auto_recovery_queued",
              last_error: "provider 429",
              checked_at: "2026-02-23T12:00:00Z",
            },
            { status: 200 }
          )
      ),
      http.get(
        "http://localhost:3001/api/v1/connections/conn_worldnews/ingest/runs",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("limit")).toBe("15");
          return HttpResponse.json(
            {
              connection_id: "conn_worldnews",
              runs: [
                {
                  id: "run_worldnews_1",
                  organization_id: "org_test",
                  connection_id: "conn_worldnews",
                  connector_type: "worldnewsapi",
                  run_kind: "incremental",
                  status: "failed",
                  retry_class: "quota",
                  scheduled_interval_minutes: 5,
                  freshness_lag_minutes: 35,
                  quota_headroom_ratio: 0.2,
                  voi_priority: 0.9,
                  records_synced: 112,
                  bytes_synced: 10240,
                  cost_units: 1.2,
                  started_at: "2026-02-23T11:55:00Z",
                  completed_at: "2026-02-23T11:56:00Z",
                  duration_seconds: 60,
                  metadata: {},
                },
              ],
            },
            { status: 200 }
          );
        }
      )
    );

    const health = await worldBrainAPI.getSourceHealth({
      connectionId: "conn_worldnews",
    });
    expect(health.connection_id).toBe("conn_worldnews");
    expect(health.sync_slo_breached).toBe(true);

    const runs = await worldBrainAPI.listIngestRuns({
      connectionId: "conn_worldnews",
      limit: 15,
    });
    expect(runs.connection_id).toBe("conn_worldnews");
    expect(runs.runs[0]?.retry_class).toBe("quota");
    expect(runs.runs[0]?.freshness_lag_minutes).toBe(35);
  });

  it("posts source operator controls (pause/resume/replay/backfill)", async () => {
    server.use(
      http.post(
        "http://localhost:3001/api/v1/connections/conn_worldnews/ingest/pause",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("reason")).toBe("manual_pause");
          return HttpResponse.json(
            { connection_id: "conn_worldnews", status: "paused" },
            { status: 200 }
          );
        }
      ),
      http.post(
        "http://localhost:3001/api/v1/connections/conn_worldnews/ingest/resume",
        () =>
          HttpResponse.json(
            { connection_id: "conn_worldnews", status: "active" },
            { status: 200 }
          )
      ),
      http.post(
        "http://localhost:3001/api/v1/connections/conn_worldnews/ingest/replay",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.full_refresh).toBe(false);
          expect(body.streams).toEqual(["events", "alerts"]);
          expect(body.checkpoint_cursor).toEqual({ cursor: "abc" });
          return HttpResponse.json(
            {
              connection_id: "conn_worldnews",
              status: "queued",
              replay_job_id: "replay_job_1",
            },
            { status: 200 }
          );
        }
      ),
      http.post(
        "http://localhost:3001/api/v1/org/connections/conn_worldnews/backfill",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.start_date).toBe("2026-01-01T00:00:00Z");
          expect(body.end_date).toBe("2026-01-31T23:59:59Z");
          expect(body.window_days).toBe(7);
          expect(body.throttle_seconds).toBe(1.5);
          return HttpResponse.json(
            {
              connection_id: "conn_worldnews",
              status: "queued",
              backfill_jobs: ["backfill_job_1"],
            },
            { status: 200 }
          );
        }
      )
    );

    const pause = await worldBrainAPI.pauseSourceIngest({
      connectionId: "conn_worldnews",
      reason: "manual_pause",
    });
    expect(pause.status).toBe("paused");

    const resume = await worldBrainAPI.resumeSourceIngest({
      connectionId: "conn_worldnews",
    });
    expect(resume.status).toBe("active");

    const replay = await worldBrainAPI.replaySourceIngest({
      connectionId: "conn_worldnews",
      checkpointCursor: { cursor: "abc" },
      streams: ["events", "alerts"],
      fullRefresh: false,
    });
    expect(replay.replay_job_id).toBe("replay_job_1");

    const backfill = await worldBrainAPI.triggerSourceBackfill({
      connectionId: "conn_worldnews",
      startDate: "2026-01-01T00:00:00Z",
      endDate: "2026-01-31T23:59:59Z",
      windowDays: 7,
      streams: ["events"],
      throttleSeconds: 1.5,
    });
    expect(backfill.backfill_jobs).toEqual(["backfill_job_1"]);
  });

  it("fetches connection history audit trail", async () => {
    server.use(
      http.get(
        "http://localhost:3001/api/v1/org/connections/conn_worldnews/history",
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("limit")).toBe("25");
          expect(url.searchParams.get("job_type")).toBe("replay");
          return HttpResponse.json(
            {
              connection_id: "conn_worldnews",
              jobs: [
                {
                  id: "job_replay_1",
                  job_type: "replay",
                  status: "queued",
                  started_at: "2026-02-23T11:50:00Z",
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
            { status: 200 }
          );
        }
      )
    );

    const history = await worldBrainAPI.getSourceHistory({
      connectionId: "conn_worldnews",
      limit: 25,
      jobType: "replay",
    });
    expect(history.connection_id).toBe("conn_worldnews");
    expect(history.jobs[0]?.id).toBe("job_replay_1");
    expect(history.jobs[0]?.job_type).toBe("replay");
  });

  it("submits signal feedback outcomes into learning hooks", async () => {
    server.use(
      http.post(
        "http://localhost:3001/api/v1/brain/interventions/outcomes",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.organization_id).toBe("org_test");
          expect(body.outcome_type).toBe("signal_feedback.false_positive");
          expect(body.persist).toBe(true);
          expect(body.publish_events).toBe(true);
          const payload = body.outcome_payload as Record<string, unknown>;
          expect(payload.event_id).toBe("evt_1");
          expect(payload.correction_label).toBe("not_actionable");
          expect(payload.feedback_kind).toBe("world_brain_signal");
          return HttpResponse.json(
            {
              success: true,
              enqueued: false,
              result: {
                realized_outcome_id: "out_feedback_1",
                intervention_plan_id: null,
                outcome_type: "signal_feedback.false_positive",
                outcome_payload: payload,
                outcome_hash: "hash_feedback_1",
                measured_at: "2026-02-23T12:15:00Z",
              },
            },
            { status: 200 }
          );
        }
      )
    );

    const response = await worldBrainAPI.submitSignalFeedback({
      organizationId: "org_test",
      eventId: "evt_1",
      verdict: "false_positive",
      correctionLabel: "not_actionable",
      notes: "noise-only signal",
      lane: "external",
      deltaDomain: "belief",
      confidence: 0.41,
    });

    expect(response.success).toBe(true);
    expect(response.result?.realized_outcome_id).toBe("out_feedback_1");
    expect(response.result?.outcome_type).toBe("signal_feedback.false_positive");
  });
});
