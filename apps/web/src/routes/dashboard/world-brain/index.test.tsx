import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const worldBrainApiMock = {
  listTape: vi.fn(),
  getTapeLiveContract: vi.fn(),
  getTapeEvent: vi.fn(),
  getObligationDashboard: vi.fn(),
  triageObligationSignal: vi.fn(),
  compareCounterfactualLab: vi.fn(),
  listSourceConnections: vi.fn(),
  getSourceHealth: vi.fn(),
  listIngestRuns: vi.fn(),
  getSourceHistory: vi.fn(),
  pauseSourceIngest: vi.fn(),
  resumeSourceIngest: vi.fn(),
  replaySourceIngest: vi.fn(),
  triggerSourceBackfill: vi.fn(),
  submitSignalFeedback: vi.fn(),
};

const authClientMock = {
  useActiveOrganization: vi.fn(),
};

const webRuntimeMock = {
  useWebRuntime: vi.fn(),
};

const authState = {
  user: {
    role: "pilot_owner",
  },
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (options: Record<string, unknown>) => ({
    ...options,
    options,
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  ),
}));

vi.mock("@/lib/api", () => ({
  worldBrainAPI: worldBrainApiMock,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: authClientMock,
}));

vi.mock("@/modules/runtime-provider", () => ({
  useWebRuntime: () => webRuntimeMock.useWebRuntime(),
}));

vi.mock("@/lib/auth", () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
}));

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
}

describe("World Brain route", () => {
  beforeEach(() => {
    worldBrainApiMock.listTape.mockReset();
    worldBrainApiMock.getTapeLiveContract.mockReset();
    worldBrainApiMock.getTapeEvent.mockReset();
    worldBrainApiMock.getObligationDashboard.mockReset();
    worldBrainApiMock.triageObligationSignal.mockReset();
    worldBrainApiMock.compareCounterfactualLab.mockReset();
    worldBrainApiMock.listSourceConnections.mockReset();
    worldBrainApiMock.getSourceHealth.mockReset();
    worldBrainApiMock.listIngestRuns.mockReset();
    worldBrainApiMock.getSourceHistory.mockReset();
    worldBrainApiMock.pauseSourceIngest.mockReset();
    worldBrainApiMock.resumeSourceIngest.mockReset();
    worldBrainApiMock.replaySourceIngest.mockReset();
    worldBrainApiMock.triggerSourceBackfill.mockReset();
    worldBrainApiMock.submitSignalFeedback.mockReset();
    authClientMock.useActiveOrganization.mockReset();
    webRuntimeMock.useWebRuntime.mockReset();

    authClientMock.useActiveOrganization.mockReturnValue({
      data: { id: "org_test" },
      isPending: false,
    });
    webRuntimeMock.useWebRuntime.mockReturnValue({
      capabilities: { "world.brain.read": true },
    });
  });

  it("renders internal/external lanes and impact bridges from world brain tape payloads", async () => {
    const now = Date.now();
    const recentIso = new Date(now - 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 120 * 60 * 60 * 1000).toISOString();
    const oldBridgeIso = new Date(now - 121 * 60 * 60 * 1000).toISOString();

    worldBrainApiMock.listTape.mockResolvedValue({
      success: true,
      count: 3,
      items: [
        {
          event_id: "evt_internal",
          lane: "internal",
          delta_domain: "belief",
          severity: "medium",
          confidence: 0.78,
          summary: "INTERNAL_RECENT_DELTA",
          occurred_at: recentIso,
        },
        {
          event_id: "evt_external",
          lane: "external",
          delta_domain: "causal",
          severity: "high",
          confidence: 0.66,
          summary: "EXTERNAL_OLD_DELTA",
          occurred_at: oldIso,
        },
        {
          event_id: "evt_bridge",
          lane: "bridge",
          delta_domain: "impact",
          severity: "high",
          confidence: 0.81,
          summary: "Bridge established",
          occurred_at: oldBridgeIso,
          impact_bridge: {
            external_ref: "ext:fed_signal",
            internal_ref: "int:portfolio_semis",
            impact_type: "requires_update",
            severity: "high",
          },
        },
      ],
    });
    worldBrainApiMock.getTapeLiveContract.mockResolvedValue({
      success: true,
      contract: {
        organization_id: "org_test",
        lanes: {
          internal: [
            {
              event_id: "evt_internal",
              lane: "internal",
              delta_domain: "belief",
              severity: "medium",
              confidence: 0.78,
              summary: "INTERNAL_RECENT_DELTA",
            },
          ],
          external: [
            {
              event_id: "evt_external",
              lane: "external",
              delta_domain: "causal",
              severity: "high",
              confidence: 0.66,
              summary: "EXTERNAL_OLD_DELTA",
            },
          ],
          bridge: [
            {
              event_id: "evt_bridge",
              lane: "bridge",
              delta_domain: "impact",
              severity: "high",
              confidence: 0.81,
              summary: "Bridge established",
              impact_bridge: {
                external_ref: "ext:fed_signal",
                internal_ref: "int:portfolio_semis",
                impact_type: "requires_update",
                severity: "high",
              },
            },
          ],
          world_pressure: [
            { entity_id: "acme", pressure_score: 8.1, tier: "high" },
          ],
        },
        visualization_contract: {},
        filters: {},
      },
    });
    worldBrainApiMock.getObligationDashboard.mockResolvedValue({
      success: true,
      dashboard: {
        summary: {
          active_constraints: 3,
          total_signals: 5,
          pre_breach_warnings: 2,
          post_breach_open: 1,
          severity_counts: { high: 1, medium: 4 },
        },
        pre_breach: [
          {
            id: "viol_1",
            status: "warning",
            severity: "medium",
            confidence: 0.72,
            constraint_title: "Quarterly filing deadline",
            occurred_at: oldIso,
          },
        ],
        post_breach: [
          {
            id: "viol_2",
            status: "open",
            severity: "high",
            confidence: 0.87,
            constraint_title: "Disclosure policy breach",
            occurred_at: recentIso,
          },
        ],
        workflows: {
          pre_breach: ["inspect proof bundle", "assign owner"],
          post_breach: ["open breach timeline", "escalate legal/compliance"],
        },
        generated_at: "2026-02-23T10:00:00Z",
      },
    });
    worldBrainApiMock.triageObligationSignal.mockResolvedValue({
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
        counterfactual_preview: {
          simulation_id: "sim_triage",
          risk_score: 0.52,
          downside_risk_estimate: 0.18,
          utility_delta: 0.11,
        },
        generated_at: "2026-02-23T11:00:00Z",
      },
    });
    worldBrainApiMock.compareCounterfactualLab.mockResolvedValue({
      success: true,
      comparison: {
        preferred: "a",
        score_a: 0.46,
        score_b: 0.2,
        delta: 0.26,
        scenario_a: {
          simulation_id: "sim_a",
          scenario_name: "baseline_case",
          simulated: { risk_score: 0.41 },
          utility: { simulated_utility: 0.59, utility_delta: 0.13 },
          downside_risk_estimate: 0.13,
        },
        scenario_b: {
          simulation_id: "sim_b",
          scenario_name: "stress_case",
          simulated: { risk_score: 0.66 },
          utility: { simulated_utility: 0.44, utility_delta: 0.05 },
          downside_risk_estimate: 0.24,
        },
        intervention_previews: {
          a: {
            intervention_id: "intv_a",
            policy_class: "p2_guardrailed",
            rollback_steps: ["rollback step_1: undo 'trigger mitigation'"],
            rollback_verification: { is_verified: true },
          },
          b: {
            intervention_id: "intv_b",
            policy_class: "p1_human_approval",
            rollback_steps: ["rollback step_1: undo 'notify legal'"],
            rollback_verification: { is_verified: true },
          },
        },
        generated_at: "2026-02-23T12:00:00Z",
      },
    });
    worldBrainApiMock.getTapeEvent.mockImplementation(
      ({ eventId }: { eventId: string }) =>
        Promise.resolve({
          success: true,
          event: {
            event_id: eventId,
            lane: "external",
            delta_domain: "belief",
            severity: "medium",
            confidence: 0.78,
            summary: "PROOF_DETAIL_SUMMARY",
          },
          proof_bundle: {
            bundle_id: `proof:${eventId}`,
            citations: [{ kind: "evidence_link", ref_id: "evidence_alpha" }],
            timeline: [{ event: "belief_revision", at: "2026-02-23T11:00:00Z" }],
            confidence_reasoning: { source_quality: 0.91 },
          },
        })
    );
    worldBrainApiMock.listSourceConnections.mockResolvedValue([
      {
        id: "conn_worldnews",
        connector_type: "worldnewsapi",
        name: "World News API",
        organization_id: "org_test",
        status: "active",
        created_at: "2026-02-23T08:00:00Z",
        last_sync_at: "2026-02-23T11:45:00Z",
        sync_enabled: true,
        streams: ["top_news"],
      },
      {
        id: "conn_sec",
        connector_type: "sec_filings",
        name: "SEC Filings",
        organization_id: "org_test",
        status: "active",
        created_at: "2026-02-23T08:15:00Z",
        last_sync_at: "2026-02-23T11:10:00Z",
        sync_enabled: true,
        streams: ["filings"],
      },
    ]);
    worldBrainApiMock.getSourceHealth.mockImplementation(
      ({ connectionId }: { connectionId: string }) =>
        Promise.resolve(
          connectionId === "conn_worldnews"
            ? {
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
              }
            : {
                connection_id: "conn_sec",
                organization_id: "org_test",
                connector_type: "sec_filings",
                status: "healthy",
                reason_code: "ok",
                reason: "within freshness envelope",
                last_sync_at: "2026-02-23T11:58:00Z",
                minutes_since_last_sync: 2,
                stale_after_minutes: 20,
                sync_slo_breached: false,
                sync_slo_minutes: 20,
                recent_failures: 0,
                recovery_action: "none",
                last_error: null,
                checked_at: "2026-02-23T12:00:00Z",
              }
        )
    );
    worldBrainApiMock.listIngestRuns.mockImplementation(
      ({ connectionId }: { connectionId: string }) =>
        Promise.resolve({
          connection_id: connectionId,
          runs:
            connectionId === "conn_worldnews"
              ? [
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
                ]
              : [
                  {
                    id: "run_sec_1",
                    organization_id: "org_test",
                    connection_id: "conn_sec",
                    connector_type: "sec_filings",
                    run_kind: "incremental",
                    status: "succeeded",
                    retry_class: null,
                    scheduled_interval_minutes: 5,
                    freshness_lag_minutes: 2,
                    quota_headroom_ratio: 0.92,
                    voi_priority: 0.6,
                    records_synced: 17,
                    bytes_synced: 4096,
                    cost_units: 0.1,
                    started_at: "2026-02-23T11:58:00Z",
                    completed_at: "2026-02-23T11:59:00Z",
                    duration_seconds: 60,
                    metadata: {},
                  },
                ],
        })
    );
    worldBrainApiMock.getSourceHistory.mockImplementation(
      ({ connectionId }: { connectionId: string }) =>
        Promise.resolve({
          connection_id: connectionId,
          jobs: [
            {
              id: `${connectionId}_job_replay`,
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
        })
    );
    worldBrainApiMock.pauseSourceIngest.mockResolvedValue({
      connection_id: "conn_worldnews",
      status: "paused",
    });
    worldBrainApiMock.resumeSourceIngest.mockResolvedValue({
      connection_id: "conn_worldnews",
      status: "active",
    });
    worldBrainApiMock.replaySourceIngest.mockResolvedValue({
      connection_id: "conn_worldnews",
      status: "queued",
      replay_job_id: "replay_job_1",
    });
    worldBrainApiMock.triggerSourceBackfill.mockResolvedValue({
      connection_id: "conn_worldnews",
      status: "queued",
      backfill_jobs: ["backfill_job_1"],
    });
    worldBrainApiMock.submitSignalFeedback.mockResolvedValue({
      success: true,
      enqueued: false,
      result: {
        realized_outcome_id: "out_feedback_1",
        intervention_plan_id: null,
        outcome_type: "signal_feedback.false_negative",
        outcome_payload: {
          event_id: "evt_external",
          correction_label: "material_risk_shift",
        },
        outcome_hash: "hash_feedback_1",
        measured_at: "2026-02-23T12:15:00Z",
      },
    });

    const module = await import("./index");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithQueryClient(<Component />);

    expect(await screen.findByText("Ledger Tape Lanes")).toBeTruthy();
    expect(await screen.findByText("Internal lane")).toBeTruthy();
    expect(await screen.findByText("External lane")).toBeTruthy();
    expect((await screen.findAllByText("Impact bridges")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("INTERNAL_RECENT_DELTA")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("EXTERNAL_OLD_DELTA")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("ext:fed_signal")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("int:portfolio_semis")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Impact focus cards")).toBeTruthy();
    expect(await screen.findByText("Source Health Console")).toBeTruthy();
    expect(await screen.findByTestId("source-health-console")).toBeTruthy();
    expect(await screen.findByTestId("source-health-row-conn_worldnews")).toBeTruthy();
    expect(await screen.findByTestId("source-health-row-conn_sec")).toBeTruthy();
    expect(await screen.findByTestId("source-operator-controls")).toBeTruthy();
    expect(await screen.findByTestId("source-operator-audit-trail")).toBeTruthy();
    expect(await screen.findByTestId("source-history-job-conn_worldnews_job_replay")).toBeTruthy();
    expect((await screen.findAllByText("SLO breached")).length).toBeGreaterThan(0);
    expect(await screen.findByText("World News API")).toBeTruthy();
    expect(await screen.findByText("SEC Filings")).toBeTruthy();
    expect(await screen.findByText("Obligation Sentinel")).toBeTruthy();
    expect(await screen.findByText("Quarterly filing deadline")).toBeTruthy();
    expect(await screen.findByText("Disclosure policy breach")).toBeTruthy();
    expect(await screen.findByText("Counterfactual Lab")).toBeTruthy();
    const driftMeter = await screen.findByTestId("drift-meter");
    expect(driftMeter.getAttribute("data-severity-level")).toBeTruthy();
    expect(driftMeter.getAttribute("data-confidence-tier")).toBeTruthy();
    const impactCard = await screen.findByTestId("impact-card-evt_bridge");
    expect(impactCard.getAttribute("data-severity")).toBe("high");
    expect(impactCard.getAttribute("data-confidence-tier")).toBe("strong");

    expect(worldBrainApiMock.listSourceConnections).toHaveBeenCalledWith({
      organizationId: "org_test",
    });
    expect(worldBrainApiMock.getSourceHealth).toHaveBeenCalledWith({
      connectionId: "conn_worldnews",
    });
    expect(worldBrainApiMock.listIngestRuns).toHaveBeenCalledWith({
      connectionId: "conn_worldnews",
      limit: 15,
    });
    expect(worldBrainApiMock.getSourceHistory).toHaveBeenCalledWith({
      connectionId: "conn_worldnews",
      limit: 25,
    });

    const pauseButton = await screen.findByTestId("pause-source-ingest");
    expect((pauseButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(pauseButton);
    await waitFor(() => {
      expect(worldBrainApiMock.pauseSourceIngest).toHaveBeenCalledWith({
        connectionId: "conn_worldnews",
        reason: "manual_operator_pause",
      });
    });

    const resumeButton = await screen.findByTestId("resume-source-ingest");
    expect((resumeButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resumeButton);
    await waitFor(() => {
      expect(worldBrainApiMock.resumeSourceIngest).toHaveBeenCalledWith({
        connectionId: "conn_worldnews",
      });
    });

    fireEvent.change(await screen.findByTestId("source-operator-replay-checkpoint"), {
      target: { value: '{"cursor":"abc"}' },
    });
    fireEvent.change(await screen.findByTestId("source-operator-replay-streams"), {
      target: { value: "events,alerts" },
    });
    const replayButton = await screen.findByTestId("replay-source-ingest");
    await waitFor(() => {
      expect((replayButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(replayButton);
    await waitFor(() => {
      expect(worldBrainApiMock.replaySourceIngest).toHaveBeenCalledWith({
        connectionId: "conn_worldnews",
        checkpointCursor: { cursor: "abc" },
        streams: ["events", "alerts"],
        fullRefresh: false,
      });
    });

    const backfillButton = await screen.findByTestId("backfill-source-ingest");
    await waitFor(() => {
      expect((backfillButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(backfillButton);
    await waitFor(() => {
      expect(worldBrainApiMock.triggerSourceBackfill).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "conn_worldnews",
          windowDays: 7,
          throttleSeconds: 1,
          streams: ["events", "alerts"],
        })
      );
    });

    expect(await screen.findByTestId("signal-feedback-card")).toBeTruthy();
    fireEvent.change(await screen.findByTestId("signal-feedback-event-select"), {
      target: { value: "evt_external" },
    });
    fireEvent.change(await screen.findByTestId("signal-feedback-verdict"), {
      target: { value: "false_negative" },
    });
    fireEvent.change(await screen.findByTestId("signal-feedback-correction-label"), {
      target: { value: "material_risk_shift" },
    });
    fireEvent.change(await screen.findByTestId("signal-feedback-notes"), {
      target: { value: "external event should escalate scenario scoring" },
    });
    fireEvent.click(await screen.findByTestId("submit-signal-feedback"));
    await waitFor(() => {
      expect(worldBrainApiMock.submitSignalFeedback).toHaveBeenCalledWith({
        organizationId: "org_test",
        eventId: "evt_external",
        verdict: "false_negative",
        correctionLabel: "material_risk_shift",
        notes: "external event should escalate scenario scoring",
        lane: "external",
        deltaDomain: "causal",
        confidence: 0.66,
      });
    });
    expect(await screen.findByTestId("signal-feedback-result")).toBeTruthy();
    expect(await screen.findByText("out_feedback_1")).toBeTruthy();

    fireEvent.click(await screen.findByTestId("triage-simulate_impact-viol_2"));
    expect(await screen.findByTestId("triage-result-card")).toBeTruthy();
    expect(await screen.findByText("sim_triage")).toBeTruthy();
    expect(worldBrainApiMock.triageObligationSignal).toHaveBeenCalledWith({
      organizationId: "org_test",
      violationId: "viol_2",
      action: "simulate_impact",
      includeCounterfactualPreview: true,
    });

    fireEvent.click(await screen.findByTestId("run-counterfactual-compare"));
    expect(await screen.findByTestId("counterfactual-result-card")).toBeTruthy();
    expect(await screen.findByText("Rollback preview A")).toBeTruthy();
    expect(await screen.findByText("Rollback preview B")).toBeTruthy();
    expect(worldBrainApiMock.compareCounterfactualLab).toHaveBeenCalledWith({
      organizationId: "org_test",
      scenarioA: {
        scenarioName: "baseline_case",
        horizonDays: 30,
      },
      scenarioB: {
        scenarioName: "stress_case",
        horizonDays: 30,
      },
      targetRef: "portfolio_risk",
      maxConstraintSeverity: "high",
      recommendedActions: ["trigger mitigation", "notify legal"],
      generateInterventions: true,
    });

    const scrubber = (await screen.findByLabelText("Hours back")) as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: "24" } });
    expect(scrubber.value).toBe("24");

    expect(screen.queryByText("INTERNAL_RECENT_DELTA")).toBeNull();
    expect((await screen.findAllByText("EXTERNAL_OLD_DELTA")).length).toBeGreaterThan(0);

    fireEvent.click((await screen.findAllByTestId("open-proof-evt_external"))[0]!);
    expect(await screen.findByText("Proof Bundle")).toBeTruthy();
    expect(await screen.findByText("evidence_alpha")).toBeTruthy();
    expect(await screen.findByText("PROOF_DETAIL_SUMMARY")).toBeTruthy();
    expect(worldBrainApiMock.getTapeEvent).toHaveBeenCalledWith({
      organizationId: "org_test",
      eventId: "evt_external",
    });
  });

  it("redirects to console when world brain capability is disabled", async () => {
    webRuntimeMock.useWebRuntime.mockReturnValue({
      capabilities: { "world.brain.read": false },
    });

    const module = await import("./index");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithQueryClient(<Component />);

    const redirect = await screen.findByTestId("navigate");
    expect(redirect.getAttribute("data-to")).toBe("/dashboard/console");
    expect(worldBrainApiMock.listTape).not.toHaveBeenCalled();
    expect(worldBrainApiMock.getTapeEvent).not.toHaveBeenCalled();
    expect(worldBrainApiMock.triageObligationSignal).not.toHaveBeenCalled();
    expect(worldBrainApiMock.compareCounterfactualLab).not.toHaveBeenCalled();
    expect(worldBrainApiMock.submitSignalFeedback).not.toHaveBeenCalled();
  });

  it("keeps operator controls read-only for viewer role", async () => {
    const previousRole = authState.user.role;
    authState.user.role = "pilot_viewer";
    const viewerRecentIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    worldBrainApiMock.listTape.mockResolvedValue({
      success: true,
      count: 1,
      items: [
        {
          event_id: "evt_viewer",
          lane: "external",
          delta_domain: "belief",
          severity: "low",
          confidence: 0.55,
          summary: "Viewer feedback candidate",
          occurred_at: viewerRecentIso,
        },
      ],
    });
    worldBrainApiMock.getTapeLiveContract.mockResolvedValue({
      success: true,
      contract: {
        organization_id: "org_test",
        lanes: { internal: [], external: [], bridge: [], world_pressure: [] },
        visualization_contract: {},
        filters: {},
      },
    });
    worldBrainApiMock.getObligationDashboard.mockResolvedValue({
      success: true,
      dashboard: {
        summary: {
          active_constraints: 0,
          total_signals: 0,
          pre_breach_warnings: 0,
          post_breach_open: 0,
          severity_counts: {},
        },
        pre_breach: [],
        post_breach: [],
        workflows: {},
        generated_at: "2026-02-23T10:00:00Z",
      },
    });
    worldBrainApiMock.listSourceConnections.mockResolvedValue([
      {
        id: "conn_worldnews",
        connector_type: "worldnewsapi",
        name: "World News API",
        organization_id: "org_test",
        status: "active",
        created_at: "2026-02-23T08:00:00Z",
        last_sync_at: "2026-02-23T11:45:00Z",
        sync_enabled: true,
        streams: ["top_news"],
      },
    ]);
    worldBrainApiMock.getSourceHealth.mockResolvedValue({
      connection_id: "conn_worldnews",
      organization_id: "org_test",
      connector_type: "worldnewsapi",
      status: "healthy",
      reason_code: "ok",
      reason: "within freshness envelope",
      last_sync_at: "2026-02-23T11:58:00Z",
      minutes_since_last_sync: 2,
      stale_after_minutes: 20,
      sync_slo_breached: false,
      sync_slo_minutes: 20,
      recent_failures: 0,
      recovery_action: "none",
      last_error: null,
      checked_at: "2026-02-23T12:00:00Z",
    });
    worldBrainApiMock.listIngestRuns.mockResolvedValue({
      connection_id: "conn_worldnews",
      runs: [],
    });
    worldBrainApiMock.getSourceHistory.mockResolvedValue({
      connection_id: "conn_worldnews",
      jobs: [],
    });
    worldBrainApiMock.getTapeEvent.mockResolvedValue({
      success: true,
      event: {
        event_id: "evt",
        lane: "internal",
        delta_domain: "belief",
        severity: "low",
        confidence: 0.5,
        summary: "placeholder",
      },
      proof_bundle: {},
    });

    const module = await import("./index");
    const Component = (
      module.Route as unknown as { options: { component: ComponentType } }
    ).options.component;
    renderWithQueryClient(<Component />);

    expect(await screen.findByText("Operator Controls")).toBeTruthy();
    expect(
      await screen.findByText(
        "Viewer role is read-only. Operator actions require member/admin/owner."
      )
    ).toBeTruthy();
    expect((await screen.findByTestId("pause-source-ingest") as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId("resume-source-ingest") as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId("replay-source-ingest") as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId("backfill-source-ingest") as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId("submit-signal-feedback") as HTMLButtonElement).disabled).toBe(true);
    expect(worldBrainApiMock.pauseSourceIngest).not.toHaveBeenCalled();
    expect(worldBrainApiMock.submitSignalFeedback).not.toHaveBeenCalled();

    authState.user.role = previousRole;
  });
});
