import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Progress } from "@memorystack/ui-core/progress";
import { Separator } from "@memorystack/ui-core/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@memorystack/ui-core/sheet";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  AlertTriangle,
  ArrowUpRight,
  BrainCircuit,
  Radar,
  RefreshCw,
  ShieldAlert,
  Waves,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { authClient } from "@/lib/auth-client";
import {
  type WorldBrainCounterfactualComparison,
  type WorldBrainIngestRun,
  type WorldBrainSignalFeedbackResponse,
  type WorldBrainSourceHistoryJob,
  type WorldBrainObligationSignal,
  type WorldBrainObligationTriageResponse,
  type WorldBrainSourceConnection,
  type WorldBrainSourceHealthResponse,
  type WorldBrainTapeProofBundle,
  type WorldBrainTapeEvent,
  worldBrainAPI,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { useWebRuntime } from "@/modules/runtime-provider";

export const Route = createFileRoute("/dashboard/world-brain/")({
  component: WorldBrainLandingPage,
});

function parseEventTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function severityRank(severity: string): number {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "critical") {
    return 4;
  }
  if (normalized === "high") {
    return 3;
  }
  if (normalized === "medium") {
    return 2;
  }
  return 1;
}

function freshnessTone(minutes: number | null): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (minutes === null) {
    return { label: "No live ingest", variant: "outline" };
  }
  if (minutes <= 10) {
    return { label: "Live", variant: "default" };
  }
  if (minutes <= 60) {
    return { label: "Warm", variant: "secondary" };
  }
  return { label: "Stale", variant: "destructive" };
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeRatio(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeMinutes(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.round(parsed));
}

function quotaBurnPercent(headroomRatio: unknown): number | null {
  const ratio = normalizeRatio(headroomRatio);
  if (ratio === null) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((1 - ratio) * 100)));
}

function severityEncoding(severity: string): {
  key: "critical" | "high" | "medium" | "low";
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "critical") {
    return { key: "critical", variant: "destructive", label: "Critical" };
  }
  if (normalized === "high") {
    return { key: "high", variant: "destructive", label: "High" };
  }
  if (normalized === "medium") {
    return { key: "medium", variant: "secondary", label: "Medium" };
  }
  return { key: "low", variant: "outline", label: "Low" };
}

function confidenceEncoding(confidence: number): {
  key: "strong" | "moderate" | "provisional";
  variant: "default" | "secondary" | "outline";
  label: string;
} {
  if (confidence >= 0.8) {
    return { key: "strong", variant: "default", label: "Strong confidence" };
  }
  if (confidence >= 0.6) {
    return { key: "moderate", variant: "secondary", label: "Moderate confidence" };
  }
  return { key: "provisional", variant: "outline", label: "Provisional confidence" };
}

function driftEncoding(percent: number): {
  key: "critical" | "elevated" | "watch" | "stable";
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  if (percent >= 75) {
    return { key: "critical", variant: "destructive", label: "Critical drift" };
  }
  if (percent >= 55) {
    return { key: "elevated", variant: "secondary", label: "Elevated drift" };
  }
  if (percent >= 35) {
    return { key: "watch", variant: "default", label: "Watch drift" };
  }
  return { key: "stable", variant: "outline", label: "Stable drift" };
}

type TriageAction = "acknowledge" | "escalate" | "resolve" | "simulate_impact";

type SourceHealthConsoleRow = {
  connection: WorldBrainSourceConnection;
  health: WorldBrainSourceHealthResponse | null;
  latestRun: WorldBrainIngestRun | null;
  runs: WorldBrainIngestRun[];
  fetchError: string | null;
};

type SourceOperatorAction = "pause" | "resume" | "replay" | "backfill";

type SourceOperatorTrailEvent = {
  action: SourceOperatorAction;
  connectionId: string;
  status: string;
  at: string;
  detail?: string | null;
};

function statusEncoding(status: string): {
  key: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  const normalized = status.trim().toLowerCase();
  if (normalized === "open" || normalized === "breach") {
    return { key: normalized, variant: "destructive", label: "Open breach" };
  }
  if (normalized === "warning" || normalized === "pre_breach") {
    return { key: normalized, variant: "secondary", label: "Pre-breach warning" };
  }
  if (normalized === "resolved" || normalized === "closed") {
    return { key: normalized, variant: "default", label: "Resolved" };
  }
  return {
    key: normalized || "unknown",
    variant: "outline",
    label: normalized || "unknown",
  };
}

function obligationSignalTitle(signal: WorldBrainObligationSignal): string {
  const candidate =
    (typeof signal.constraint_title === "string" && signal.constraint_title.trim()) ||
    (typeof signal.constraint_id === "string" && signal.constraint_id.trim()) ||
    (typeof signal.id === "string" && signal.id.trim()) ||
    "unnamed_obligation_signal";
  return candidate;
}

function clampHorizonDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.max(1, Math.min(365, Math.round(value)));
}

function clampBackfillWindowDays(value: number): number {
  if (!Number.isFinite(value)) {
    return 7;
  }
  return Math.max(1, Math.min(90, Math.round(value)));
}

function extractRollbackSteps(preview: Record<string, unknown> | undefined): string[] {
  if (!preview || typeof preview !== "object") {
    return [];
  }
  const directSteps = preview.rollback_steps;
  if (Array.isArray(directSteps)) {
    return directSteps
      .map((step) => String(step ?? "").trim())
      .filter((step) => step.length > 0);
  }
  const rollbackPlan =
    preview.rollback_plan && typeof preview.rollback_plan === "object"
      ? (preview.rollback_plan as Record<string, unknown>)
      : null;
  const planSteps = rollbackPlan?.steps;
  if (Array.isArray(planSteps)) {
    return planSteps
      .map((step) => String(step ?? "").trim())
      .filter((step) => step.length > 0);
  }
  return [];
}

function extractRollbackVerified(
  preview: Record<string, unknown> | undefined
): boolean | null {
  if (!preview || typeof preview !== "object") {
    return null;
  }
  const directVerification =
    preview.rollback_verification && typeof preview.rollback_verification === "object"
      ? (preview.rollback_verification as Record<string, unknown>)
      : null;
  if (typeof directVerification?.is_verified === "boolean") {
    return directVerification.is_verified;
  }
  const rollbackPlan =
    preview.rollback_plan && typeof preview.rollback_plan === "object"
      ? (preview.rollback_plan as Record<string, unknown>)
      : null;
  const planVerification =
    rollbackPlan?.verification && typeof rollbackPlan.verification === "object"
      ? (rollbackPlan.verification as Record<string, unknown>)
      : null;
  if (typeof planVerification?.is_verified === "boolean") {
    return planVerification.is_verified;
  }
  return null;
}

function safeProofBundle(value: unknown): WorldBrainTapeProofBundle {
  return value && typeof value === "object"
    ? (value as WorldBrainTapeProofBundle)
    : {};
}

function safeTimelineEntries(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function safeCitations(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function parseOptionalJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Checkpoint cursor must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function WorldBrainLandingPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const role = useAuthStore((state) => state.user?.role ?? "exec");
  const runtime = useWebRuntime();
  const runtimeBootstrapping = runtime.manifest === null && runtime.error === null;
  const worldBrainEnabled = runtime.capabilities["world.brain.read"] !== false;
  const [scrubHoursAgo, setScrubHoursAgo] = useState(0);
  const scrubAnchorRef = useRef<number>(Date.now());
  const [proofOpen, setProofOpen] = useState(false);
  const [selectedProofEvent, setSelectedProofEvent] =
    useState<WorldBrainTapeEvent | null>(null);
  const [latestTriage, setLatestTriage] =
    useState<WorldBrainObligationTriageResponse["triage"] | null>(null);
  const [scenarioAName, setScenarioAName] = useState("baseline_case");
  const [scenarioBName, setScenarioBName] = useState("stress_case");
  const [scenarioAHorizonDays, setScenarioAHorizonDays] = useState(30);
  const [scenarioBHorizonDays, setScenarioBHorizonDays] = useState(30);
  const [counterfactualTargetRef, setCounterfactualTargetRef] =
    useState("portfolio_risk");
  const [maxConstraintSeverity, setMaxConstraintSeverity] = useState("high");
  const [counterfactualActionsText, setCounterfactualActionsText] = useState(
    "trigger mitigation\nnotify legal"
  );
  const [includeInterventionPreviews, setIncludeInterventionPreviews] =
    useState(true);
  const [counterfactualResult, setCounterfactualResult] =
    useState<WorldBrainCounterfactualComparison | null>(null);
  const [selectedOperatorConnectionId, setSelectedOperatorConnectionId] =
    useState<string>("");
  const [pauseReason, setPauseReason] = useState("manual_operator_pause");
  const [replayCheckpointJson, setReplayCheckpointJson] = useState("");
  const [replayStreamsText, setReplayStreamsText] = useState("events");
  const [replayFullRefresh, setReplayFullRefresh] = useState(false);
  const [backfillStartDate, setBackfillStartDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    return start.toISOString().slice(0, 10);
  });
  const [backfillEndDate, setBackfillEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [backfillWindowDays, setBackfillWindowDays] = useState(7);
  const [backfillThrottleSeconds, setBackfillThrottleSeconds] = useState(1);
  const [operatorTrailEvents, setOperatorTrailEvents] = useState<
    SourceOperatorTrailEvent[]
  >([]);
  const [operatorInputError, setOperatorInputError] = useState<string | null>(null);
  const [selectedFeedbackEventId, setSelectedFeedbackEventId] = useState("");
  const [feedbackVerdict, setFeedbackVerdict] = useState<
    "false_positive" | "false_negative" | "confirmed"
  >("false_positive");
  const [feedbackCorrectionLabel, setFeedbackCorrectionLabel] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [latestFeedbackResult, setLatestFeedbackResult] =
    useState<WorldBrainSignalFeedbackResponse["result"] | null>(null);

  const tapeQuery = useQuery({
    queryKey: ["world-brain", "tape", organizationId],
    queryFn: () =>
      worldBrainAPI.listTape({
        organizationId,
        hours: 24 * 7,
        limit: 120,
      }),
    enabled: Boolean(organizationId && worldBrainEnabled),
  });

  const contractQuery = useQuery({
    queryKey: ["world-brain", "contract", organizationId, role],
    queryFn: () =>
      worldBrainAPI.getTapeLiveContract({
        organizationId,
        role,
        limit: 30,
      }),
    enabled: Boolean(organizationId && worldBrainEnabled),
  });

  const obligationQuery = useQuery({
    queryKey: ["world-brain", "obligation-dashboard", organizationId],
    queryFn: () =>
      worldBrainAPI.getObligationDashboard({
        organizationId,
        limit: 100,
      }),
    enabled: Boolean(organizationId && worldBrainEnabled),
  });

  const sourceHealthQuery = useQuery({
    queryKey: ["world-brain", "source-health-console", organizationId],
    queryFn: async () => {
      const connections = await worldBrainAPI.listSourceConnections({
        organizationId,
      });

      const rows = await Promise.all(
        connections.map(async (connection): Promise<SourceHealthConsoleRow> => {
          try {
            const [health, ingestRuns] = await Promise.all([
              worldBrainAPI.getSourceHealth({
                connectionId: connection.id,
              }),
              worldBrainAPI.listIngestRuns({
                connectionId: connection.id,
                limit: 15,
              }),
            ]);

            const runs = Array.isArray(ingestRuns.runs) ? ingestRuns.runs : [];
            return {
              connection,
              health,
              latestRun: runs[0] ?? null,
              runs,
              fetchError: null,
            };
          } catch (error) {
            return {
              connection,
              health: null,
              latestRun: null,
              runs: [],
              fetchError:
                error instanceof Error
                  ? error.message
                  : "Source telemetry unavailable",
            };
          }
        })
      );

      return {
        rows,
        generatedAt: new Date().toISOString(),
      };
    },
    enabled: Boolean(organizationId && worldBrainEnabled),
  });

  const selectedOperatorConnection = useMemo(() => {
    const rows = sourceHealthQuery.data?.rows ?? [];
    if (rows.length === 0) {
      return null;
    }
    return (
      rows.find((row) => row.connection.id === selectedOperatorConnectionId) ??
      rows[0] ??
      null
    );
  }, [selectedOperatorConnectionId, sourceHealthQuery.data?.rows]);
  const selectedOperatorConnectionResolvedId =
    selectedOperatorConnection?.connection.id ?? "";

  const sourceHistoryQuery = useQuery({
    queryKey: [
      "world-brain",
      "source-operator-history",
      organizationId,
      selectedOperatorConnectionResolvedId,
    ],
    queryFn: () =>
      worldBrainAPI.getSourceHistory({
        connectionId: selectedOperatorConnectionResolvedId,
        limit: 25,
      }),
    enabled: Boolean(
      organizationId &&
        worldBrainEnabled &&
        selectedOperatorConnectionResolvedId.length > 0
    ),
  });

  const pushOperatorTrailEvent = (
    event: SourceOperatorTrailEvent
  ): void => {
    setOperatorTrailEvents((current) => [event, ...current].slice(0, 30));
  };

  const pauseMutation = useMutation({
    mutationFn: (params: { connectionId: string; reason?: string }) =>
      worldBrainAPI.pauseSourceIngest(params),
    onSuccess: (result, variables) => {
      pushOperatorTrailEvent({
        action: "pause",
        connectionId: variables.connectionId,
        status: String(result.status ?? "paused"),
        at: new Date().toISOString(),
        detail: typeof variables.reason === "string" ? variables.reason : null,
      });
      sourceHealthQuery.refetch();
      sourceHistoryQuery.refetch();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (params: { connectionId: string }) =>
      worldBrainAPI.resumeSourceIngest(params),
    onSuccess: (result, variables) => {
      pushOperatorTrailEvent({
        action: "resume",
        connectionId: variables.connectionId,
        status: String(result.status ?? "active"),
        at: new Date().toISOString(),
      });
      sourceHealthQuery.refetch();
      sourceHistoryQuery.refetch();
    },
  });

  const replayMutation = useMutation({
    mutationFn: (params: {
      connectionId: string;
      checkpointCursor?: Record<string, unknown> | null;
      streams?: string[];
      fullRefresh?: boolean;
    }) => worldBrainAPI.replaySourceIngest(params),
    onSuccess: (result, variables) => {
      pushOperatorTrailEvent({
        action: "replay",
        connectionId: variables.connectionId,
        status: String(result.status ?? "queued"),
        at: new Date().toISOString(),
        detail:
          typeof result.replay_job_id === "string"
            ? result.replay_job_id
            : "replay_queued",
      });
      sourceHealthQuery.refetch();
      sourceHistoryQuery.refetch();
    },
  });

  const backfillMutation = useMutation({
    mutationFn: (params: {
      connectionId: string;
      startDate: string;
      endDate?: string;
      windowDays?: number;
      streams?: string[];
      throttleSeconds?: number;
    }) => worldBrainAPI.triggerSourceBackfill(params),
    onSuccess: (result, variables) => {
      pushOperatorTrailEvent({
        action: "backfill",
        connectionId: variables.connectionId,
        status: String(result.status ?? "queued"),
        at: new Date().toISOString(),
        detail:
          Array.isArray(result.backfill_jobs) && result.backfill_jobs.length > 0
            ? result.backfill_jobs.join(",")
            : "backfill_queued",
      });
      sourceHealthQuery.refetch();
      sourceHistoryQuery.refetch();
    },
  });

  const proofBundleQuery = useQuery({
    queryKey: [
      "world-brain",
      "proof-bundle",
      organizationId,
      selectedProofEvent?.event_id ?? null,
    ],
    queryFn: () =>
      worldBrainAPI.getTapeEvent({
        organizationId,
        eventId: String(selectedProofEvent?.event_id),
      }),
    enabled: Boolean(
      proofOpen &&
        organizationId &&
        worldBrainEnabled &&
        selectedProofEvent?.event_id
    ),
  });

  const triageMutation = useMutation({
    mutationFn: (params: { violationId: string; action: TriageAction }) =>
      worldBrainAPI.triageObligationSignal({
        organizationId,
        violationId: params.violationId,
        action: params.action,
        includeCounterfactualPreview: params.action === "simulate_impact",
      }),
    onSuccess: (result) => {
      setLatestTriage(result.triage);
      obligationQuery.refetch();
    },
  });

  const counterfactualMutation = useMutation({
    mutationFn: () =>
      worldBrainAPI.compareCounterfactualLab({
        organizationId,
        scenarioA: {
          scenarioName: scenarioAName.trim() || "scenario_a",
          horizonDays: clampHorizonDays(scenarioAHorizonDays),
        },
        scenarioB: {
          scenarioName: scenarioBName.trim() || "scenario_b",
          horizonDays: clampHorizonDays(scenarioBHorizonDays),
        },
        targetRef: counterfactualTargetRef.trim() || "portfolio_risk",
        maxConstraintSeverity: maxConstraintSeverity.trim() || undefined,
        recommendedActions: counterfactualActionsText
          .split(/\n|,/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
        generateInterventions: includeInterventionPreviews,
      }),
    onSuccess: (result) => {
      setCounterfactualResult(result.comparison);
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (params: {
      eventId: string;
      verdict: "false_positive" | "false_negative" | "confirmed";
      correctionLabel?: string;
      notes?: string;
      lane?: string;
      deltaDomain?: string;
      confidence?: number;
    }) =>
      worldBrainAPI.submitSignalFeedback({
        organizationId,
        eventId: params.eventId,
        verdict: params.verdict,
        correctionLabel: params.correctionLabel,
        notes: params.notes,
        lane: params.lane,
        deltaDomain: params.deltaDomain,
        confidence: params.confidence,
      }),
    onSuccess: (result) => {
      setLatestFeedbackResult(result.result ?? null);
    },
  });

  const tapeEvents = tapeQuery.data?.items ?? [];
  const liveContract = contractQuery.data?.contract;
  const obligationSummary = obligationQuery.data?.dashboard.summary;
  const scrubTimestamp = scrubAnchorRef.current - scrubHoursAgo * 60 * 60 * 1000;
  const tapeEventsAtSlice = useMemo(() => {
    return tapeEvents.filter((event) => {
      const ts = parseEventTime(event.occurred_at);
      if (ts === null) {
        return true;
      }
      return ts <= scrubTimestamp;
    });
  }, [scrubTimestamp, tapeEvents]);

  const metrics = useMemo(() => {
    const newestEventTs =
      tapeEventsAtSlice
        .map((item) => parseEventTime(item.occurred_at))
        .find((value): value is number => value !== null) ?? null;
    const freshnessMinutes =
      newestEventTs === null
        ? null
        : Math.max(0, Math.round((Date.now() - newestEventTs) / 60_000));
    const freshness = freshnessTone(freshnessMinutes);

    const highOrCritical = tapeEventsAtSlice.filter(
      (item) => severityRank(String(item.severity ?? "low")) >= 3
    ).length;
    const openBreachSignals = obligationSummary?.post_breach_open ?? 0;
    const warningSignals = obligationSummary?.pre_breach_warnings ?? 0;

    const worldPressure = liveContract?.lanes.world_pressure ?? [];
    const avgPressure =
      worldPressure.length > 0
        ? worldPressure.reduce((sum, item) => sum + Number(item.pressure_score || 0), 0) /
          worldPressure.length
        : 0;
    const pressurePercent = Math.max(0, Math.min(100, Math.round((avgPressure / 10) * 100)));
    const confidenceValues = tapeEventsAtSlice.map((item) =>
      normalizeConfidence(item.confidence)
    );
    const avgConfidence =
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, item) => sum + item, 0) / confidenceValues.length
        : 0;
    const weightedSeverity =
      tapeEventsAtSlice.length > 0
        ? tapeEventsAtSlice.reduce((sum, item) => {
            const severity = severityRank(String(item.severity ?? "low"));
            return sum + severity * normalizeConfidence(item.confidence);
          }, 0) / tapeEventsAtSlice.length
        : 1;
    const severityPressurePercent = Math.max(
      0,
      Math.min(100, Math.round(((weightedSeverity - 1) / 3) * 100))
    );
    const driftPercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(severityPressurePercent * 0.55 + pressurePercent * 0.45)
      )
    );
    const drift = driftEncoding(driftPercent);

    return {
      freshnessMinutes,
      freshness,
      highOrCritical,
      openBreachSignals,
      warningSignals,
      pressurePercent,
      averagePressure: Number(avgPressure.toFixed(2)),
      averageConfidence: Number(avgConfidence.toFixed(2)),
      severityPressurePercent,
      driftPercent,
      drift,
      laneCoverage: {
        internal: liveContract?.lanes.internal.length ?? 0,
        external: liveContract?.lanes.external.length ?? 0,
        bridge: liveContract?.lanes.bridge.length ?? 0,
      },
    };
  }, [liveContract, obligationSummary, tapeEventsAtSlice]);

  const sortedEvents = useMemo(() => {
    return [...tapeEventsAtSlice]
      .sort((a, b) => {
        const aTs = parseEventTime(a.occurred_at) ?? 0;
        const bTs = parseEventTime(b.occurred_at) ?? 0;
        if (aTs !== bTs) {
          return bTs - aTs;
        }
        return severityRank(String(b.severity ?? "low")) -
          severityRank(String(a.severity ?? "low"));
      })
      .slice(0, 8);
  }, [tapeEventsAtSlice]);

  const selectedFeedbackEvent = useMemo(() => {
    if (sortedEvents.length === 0) {
      return null;
    }
    return (
      sortedEvents.find((event) => event.event_id === selectedFeedbackEventId) ??
      sortedEvents[0] ??
      null
    );
  }, [selectedFeedbackEventId, sortedEvents]);

  const laneTape = useMemo(() => {
    const useLiveContract = scrubHoursAgo === 0;
    const internalFromContract = useLiveContract ? liveContract?.lanes.internal ?? [] : [];
    const externalFromContract = useLiveContract ? liveContract?.lanes.external ?? [] : [];
    const bridgeFromContract = useLiveContract ? liveContract?.lanes.bridge ?? [] : [];

    const fallbackInternal = tapeEventsAtSlice.filter(
      (event) => event.lane === "internal"
    );
    const fallbackExternal = tapeEventsAtSlice.filter(
      (event) => event.lane === "external"
    );
    const fallbackBridge = tapeEventsAtSlice.filter((event) => event.lane === "bridge");

    return {
      internal: (internalFromContract.length > 0
        ? internalFromContract
        : fallbackInternal
      ).slice(0, 6),
      external: (externalFromContract.length > 0
        ? externalFromContract
        : fallbackExternal
      ).slice(0, 6),
      bridge: (bridgeFromContract.length > 0 ? bridgeFromContract : fallbackBridge).slice(
        0,
        8
      ),
    };
  }, [liveContract, scrubHoursAgo, tapeEventsAtSlice]);

  const preBreachSignals = obligationQuery.data?.dashboard.pre_breach ?? [];
  const postBreachSignals = obligationQuery.data?.dashboard.post_breach ?? [];
  const workflowPreBreach = obligationQuery.data?.dashboard.workflows.pre_breach ?? [];
  const workflowPostBreach = obligationQuery.data?.dashboard.workflows.post_breach ?? [];
  const sourceHealthRows = useMemo(() => {
    const rows = sourceHealthQuery.data?.rows ?? [];
    return [...rows].sort((a, b) => {
      const scoreA =
        (a.fetchError ? 4 : 0) +
        (a.health?.sync_slo_breached ? 3 : 0) +
        ((a.health?.recent_failures ?? 0) > 0 ? 2 : 0) +
        (a.latestRun?.status === "failed" ? 1 : 0);
      const scoreB =
        (b.fetchError ? 4 : 0) +
        (b.health?.sync_slo_breached ? 3 : 0) +
        ((b.health?.recent_failures ?? 0) > 0 ? 2 : 0) +
        (b.latestRun?.status === "failed" ? 1 : 0);
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      const lagA = normalizeMinutes(
        a.latestRun?.freshness_lag_minutes ?? a.health?.minutes_since_last_sync
      );
      const lagB = normalizeMinutes(
        b.latestRun?.freshness_lag_minutes ?? b.health?.minutes_since_last_sync
      );
      return (lagB ?? 0) - (lagA ?? 0);
    });
  }, [sourceHealthQuery.data?.rows]);

  const sourceHealthSummary = useMemo(() => {
    const total = sourceHealthRows.length;
    const staleOrBreached = sourceHealthRows.filter(
      (row) => Boolean(row.health?.sync_slo_breached)
    ).length;
    const failedOrDegraded = sourceHealthRows.filter((row) => {
      if (row.fetchError) {
        return true;
      }
      if ((row.health?.recent_failures ?? 0) > 0) {
        return true;
      }
      return row.latestRun?.status === "failed";
    }).length;
    const freshnessValues = sourceHealthRows
      .map((row) =>
        normalizeMinutes(
          row.latestRun?.freshness_lag_minutes ?? row.health?.minutes_since_last_sync
        )
      )
      .filter((value): value is number => value !== null);
    const quotaBurnValues = sourceHealthRows
      .map((row) => quotaBurnPercent(row.latestRun?.quota_headroom_ratio))
      .filter((value): value is number => value !== null);
    const avgFreshnessLagMinutes =
      freshnessValues.length > 0
        ? Math.round(
            freshnessValues.reduce((sum, value) => sum + value, 0) /
              freshnessValues.length
          )
        : null;
    const avgQuotaBurnPercent =
      quotaBurnValues.length > 0
        ? Math.round(
            quotaBurnValues.reduce((sum, value) => sum + value, 0) /
              quotaBurnValues.length
          )
        : null;
    const telemetryUnavailable = sourceHealthRows.filter((row) =>
      Boolean(row.fetchError)
    ).length;

    return {
      total,
      staleOrBreached,
      failedOrDegraded,
      avgFreshnessLagMinutes,
      avgQuotaBurnPercent,
      telemetryUnavailable,
    };
  }, [sourceHealthRows]);
  const canOperateSources = role !== "pilot_viewer";
  const sourceHistoryJobs = sourceHistoryQuery.data?.jobs ?? [];
  const operatorActionPending =
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    replayMutation.isPending ||
    backfillMutation.isPending;
  const operatorMutationError =
    pauseMutation.error ??
    resumeMutation.error ??
    replayMutation.error ??
    backfillMutation.error;

  const runPauseIngest = () => {
    if (!canOperateSources || !selectedOperatorConnectionResolvedId) {
      return;
    }
    setOperatorInputError(null);
    pauseMutation.mutate({
      connectionId: selectedOperatorConnectionResolvedId,
      reason: pauseReason.trim() || undefined,
    });
  };

  const runResumeIngest = () => {
    if (!canOperateSources || !selectedOperatorConnectionResolvedId) {
      return;
    }
    setOperatorInputError(null);
    resumeMutation.mutate({
      connectionId: selectedOperatorConnectionResolvedId,
    });
  };

  const runReplayIngest = () => {
    if (!canOperateSources || !selectedOperatorConnectionResolvedId) {
      return;
    }
    try {
      const checkpoint = parseOptionalJsonObject(replayCheckpointJson);
      const streams = replayStreamsText
        .split(/\n|,/)
        .map((stream) => stream.trim())
        .filter(Boolean);
      setOperatorInputError(null);
      replayMutation.mutate({
        connectionId: selectedOperatorConnectionResolvedId,
        checkpointCursor: checkpoint,
        streams,
        fullRefresh: replayFullRefresh,
      });
    } catch (error) {
      setOperatorInputError(
        error instanceof Error ? error.message : "Invalid replay checkpoint JSON."
      );
    }
  };

  const runBackfill = () => {
    if (!canOperateSources || !selectedOperatorConnectionResolvedId) {
      return;
    }
    const trimmedStart = backfillStartDate.trim();
    const trimmedEnd = backfillEndDate.trim();
    if (!trimmedStart) {
      setOperatorInputError("Backfill start date is required.");
      return;
    }
    if (trimmedEnd && trimmedStart > trimmedEnd) {
      setOperatorInputError("Backfill start date must be before end date.");
      return;
    }
    const streams = replayStreamsText
      .split(/\n|,/)
      .map((stream) => stream.trim())
      .filter(Boolean);
    setOperatorInputError(null);
    backfillMutation.mutate({
      connectionId: selectedOperatorConnectionResolvedId,
      startDate: `${trimmedStart}T00:00:00Z`,
      endDate: trimmedEnd ? `${trimmedEnd}T23:59:59Z` : undefined,
      windowDays: clampBackfillWindowDays(backfillWindowDays),
      streams,
      throttleSeconds: Math.max(0, Math.min(30, Number(backfillThrottleSeconds) || 0)),
    });
  };
  const canSubmitFeedback = role !== "pilot_viewer";

  const runSubmitSignalFeedback = () => {
    if (!canSubmitFeedback || !selectedFeedbackEvent?.event_id) {
      return;
    }
    feedbackMutation.mutate({
      eventId: selectedFeedbackEvent.event_id,
      verdict: feedbackVerdict,
      correctionLabel: feedbackCorrectionLabel.trim() || undefined,
      notes: feedbackNotes.trim() || undefined,
      lane: selectedFeedbackEvent.lane,
      deltaDomain: selectedFeedbackEvent.delta_domain,
      confidence: normalizeConfidence(selectedFeedbackEvent.confidence),
    });
  };

  const topImpactEvents = useMemo(() => {
    return [...laneTape.bridge]
      .sort((a, b) => {
        const severityDiff =
          severityRank(
            String(
              (b.impact_bridge as { severity?: string } | undefined)?.severity ??
                b.severity ??
                "low"
            )
          ) -
          severityRank(
            String(
              (a.impact_bridge as { severity?: string } | undefined)?.severity ??
                a.severity ??
                "low"
            )
          );
        if (severityDiff !== 0) {
          return severityDiff;
        }
        return normalizeConfidence(b.confidence) - normalizeConfidence(a.confidence);
      })
      .slice(0, 3);
  }, [laneTape.bridge]);

  const resolvedProofEvent =
    proofBundleQuery.data?.event ?? selectedProofEvent;
  const resolvedProofBundle = safeProofBundle(
    proofBundleQuery.data?.proof_bundle ?? selectedProofEvent?.proof_bundle
  );
  const proofCitations = safeCitations(resolvedProofBundle.citations);
  const proofTimeline = safeTimelineEntries(resolvedProofBundle.timeline);

  const openProofBundle = (event: WorldBrainTapeEvent) => {
    setSelectedProofEvent(event);
    setProofOpen(true);
  };

  const runTriage = (signalId: string, action: TriageAction) => {
    if (!signalId || triageMutation.isPending) {
      return;
    }
    triageMutation.mutate({
      violationId: signalId,
      action,
    });
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select an organization to open World Brain.
      </div>
    );
  }

  if (runtimeBootstrapping) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!worldBrainEnabled) {
    return <Navigate replace to="/dashboard/console" />;
  }

  const hasError =
    tapeQuery.isError ||
    contractQuery.isError ||
    obligationQuery.isError ||
    sourceHealthQuery.isError;
  const isLoading =
    tapeQuery.isLoading ||
    contractQuery.isLoading ||
    obligationQuery.isLoading ||
    sourceHealthQuery.isLoading;

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-card/65 px-6 py-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-ring/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-12 left-4 h-28 w-28 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative space-y-4">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-ring" />
            <span className="old-money-kicker">Institutional Cognition</span>
            <Badge variant={metrics.freshness.variant}>{metrics.freshness.label}</Badge>
          </div>
          <div className="space-y-1">
            <h1 className="font-serif text-3xl leading-tight">
              World Brain Control Room
            </h1>
            <p className="max-w-3xl text-muted-foreground text-sm">
              A tenant-scoped posture view of freshness, drift pressure, and
              breach-risk alerts across internal and external reality lanes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="default">
              <Link to="/dashboard/reality-stream">
                Open Legacy Reality Stream
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/sources">Inspect Source Health</Link>
            </Button>
            <Button
              onClick={() => {
                tapeQuery.refetch();
                contractQuery.refetch();
                obligationQuery.refetch();
                sourceHealthQuery.refetch();
                if (selectedOperatorConnectionResolvedId) {
                  sourceHistoryQuery.refetch();
                }
              }}
              size="sm"
              variant="ghost"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh posture
            </Button>
          </div>
        </div>
      </section>

      {hasError ? (
        <ApiErrorPanel
          error={
            tapeQuery.error ??
            contractQuery.error ??
            obligationQuery.error ??
            sourceHealthQuery.error ??
            new Error("World Brain data fetch failed")
          }
          onRetry={() => {
            tapeQuery.refetch();
            contractQuery.refetch();
            obligationQuery.refetch();
            sourceHealthQuery.refetch();
            if (selectedOperatorConnectionResolvedId) {
              sourceHistoryQuery.refetch();
            }
          }}
        />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-3">
        <Card variant="dossier">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <Waves className="h-3.5 w-3.5" />
              Freshness posture
            </CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? <Skeleton className="h-8 w-20" /> : metrics.freshness.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {metrics.freshnessMinutes === null
                ? "No tape events observed in the selected horizon."
                : `Latest event ${formatDistanceToNowStrict(
                    Date.now() - metrics.freshnessMinutes * 60_000
                  )} ago.`}
            </p>
          </CardContent>
        </Card>

        <Card variant="dossier">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <Radar className="h-3.5 w-3.5" />
              Drift pressure
            </CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? <Skeleton className="h-8 w-16" /> : metrics.averagePressure}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress className="h-2" value={metrics.pressurePercent} />
            <p className="text-muted-foreground text-sm">
              Mean world-pressure score across active entities.
            </p>
          </CardContent>
        </Card>

        <Card variant="dossier">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2 text-xs uppercase tracking-wide">
              <ShieldAlert className="h-3.5 w-3.5" />
              Alert posture
            </CardDescription>
            <CardTitle className="text-2xl">
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                metrics.highOrCritical + metrics.openBreachSignals
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-muted-foreground">
              {metrics.highOrCritical} high-severity cognition deltas
            </p>
            <p className="text-muted-foreground">
              {metrics.openBreachSignals} open post-breach obligations
            </p>
            <p className="text-muted-foreground">
              {metrics.warningSignals} pre-breach warnings
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
          <Card variant="dossier" data-testid="source-operator-controls">
            <CardHeader>
              <CardTitle className="text-base">Operator Controls</CardTitle>
              <CardDescription>
                Governed pause/resume/replay/backfill controls with role-aware execution gates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="source-operator-connection"
                >
                  Target source connection
                </label>
                <select
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  data-testid="source-operator-connection-select"
                  id="source-operator-connection"
                  onChange={(event) => setSelectedOperatorConnectionId(event.target.value)}
                  value={selectedOperatorConnectionResolvedId}
                >
                  {sourceHealthRows.map((row) => (
                    <option key={row.connection.id} value={row.connection.id}>
                      {row.connection.name} ({row.connection.connector_type})
                    </option>
                  ))}
                </select>
              </div>

              {!canOperateSources ? (
                <div className="rounded-md border border-border/70 bg-card/45 px-3 py-2 text-muted-foreground text-xs">
                  Viewer role is read-only. Operator actions require member/admin/owner.
                </div>
              ) : null}

              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="source-operator-reason"
                >
                  Pause reason
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="source-operator-reason"
                  onChange={(event) => setPauseReason(event.target.value)}
                  type="text"
                  value={pauseReason}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Button
                  data-testid="pause-source-ingest"
                  disabled={
                    !canOperateSources ||
                    operatorActionPending ||
                    !selectedOperatorConnectionResolvedId
                  }
                  onClick={runPauseIngest}
                  size="sm"
                  variant="outline"
                >
                  Pause ingest
                </Button>
                <Button
                  data-testid="resume-source-ingest"
                  disabled={
                    !canOperateSources ||
                    operatorActionPending ||
                    !selectedOperatorConnectionResolvedId
                  }
                  onClick={runResumeIngest}
                  size="sm"
                  variant="outline"
                >
                  Resume ingest
                </Button>
              </div>

              <Separator />

              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="source-operator-replay-streams"
                >
                  Replay streams (comma or newline)
                </label>
                <textarea
                  className="min-h-[70px] w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  data-testid="source-operator-replay-streams"
                  id="source-operator-replay-streams"
                  onChange={(event) => setReplayStreamsText(event.target.value)}
                  value={replayStreamsText}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="source-operator-replay-checkpoint"
                >
                  Replay checkpoint cursor JSON (optional)
                </label>
                <textarea
                  className="min-h-[90px] w-full rounded-md border border-border/70 bg-card px-3 py-2 font-mono text-xs"
                  data-testid="source-operator-replay-checkpoint"
                  id="source-operator-replay-checkpoint"
                  onChange={(event) => setReplayCheckpointJson(event.target.value)}
                  value={replayCheckpointJson}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={replayFullRefresh}
                  onChange={(event) => setReplayFullRefresh(event.target.checked)}
                  type="checkbox"
                />
                Force full refresh replay
              </label>
              <Button
                data-testid="replay-source-ingest"
                disabled={
                  !canOperateSources ||
                  operatorActionPending ||
                  !selectedOperatorConnectionResolvedId
                }
                onClick={runReplayIngest}
                size="sm"
                variant="default"
              >
                Replay from checkpoint
              </Button>

              <Separator />

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="source-operator-backfill-start"
                  >
                    Backfill start date
                  </label>
                  <input
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    data-testid="source-operator-backfill-start"
                    id="source-operator-backfill-start"
                    onChange={(event) => setBackfillStartDate(event.target.value)}
                    type="date"
                    value={backfillStartDate}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="source-operator-backfill-end"
                  >
                    Backfill end date
                  </label>
                  <input
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    data-testid="source-operator-backfill-end"
                    id="source-operator-backfill-end"
                    onChange={(event) => setBackfillEndDate(event.target.value)}
                    type="date"
                    value={backfillEndDate}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="source-operator-backfill-window"
                  >
                    Window days
                  </label>
                  <input
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    id="source-operator-backfill-window"
                    max={90}
                    min={1}
                    onChange={(event) =>
                      setBackfillWindowDays(
                        clampBackfillWindowDays(Number(event.target.value))
                      )
                    }
                    type="number"
                    value={backfillWindowDays}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="source-operator-backfill-throttle"
                  >
                    Throttle seconds
                  </label>
                  <input
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    id="source-operator-backfill-throttle"
                    max={30}
                    min={0}
                    onChange={(event) =>
                      setBackfillThrottleSeconds(
                        Math.max(0, Math.min(30, Number(event.target.value) || 0))
                      )
                    }
                    step={0.5}
                    type="number"
                    value={backfillThrottleSeconds}
                  />
                </div>
              </div>

              <Button
                data-testid="backfill-source-ingest"
                disabled={
                  !canOperateSources ||
                  operatorActionPending ||
                  !selectedOperatorConnectionResolvedId
                }
                onClick={runBackfill}
                size="sm"
                variant="default"
              >
                Queue backfill
              </Button>

              {operatorInputError ? (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-xs">
                  {operatorInputError}
                </div>
              ) : null}

              {operatorMutationError ? (
                <ApiErrorPanel
                  error={operatorMutationError}
                  onRetry={() => {
                    sourceHealthQuery.refetch();
                    sourceHistoryQuery.refetch();
                  }}
                />
              ) : null}
            </CardContent>
          </Card>

          <Card variant="dossier" data-testid="source-operator-audit-trail">
            <CardHeader>
              <CardTitle className="text-base">Operator Audit Trail</CardTitle>
              <CardDescription>
                Connection job history and session actions for replay/backfill governance.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sourceHistoryQuery.isLoading ? <Skeleton className="h-32" /> : null}
              {sourceHistoryQuery.isError ? (
                <ApiErrorPanel
                  error={sourceHistoryQuery.error}
                  onRetry={() => sourceHistoryQuery.refetch()}
                />
              ) : null}

              {!sourceHistoryQuery.isLoading && !sourceHistoryQuery.isError ? (
                <div className="space-y-2">
                  {sourceHistoryJobs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
                      No source history events yet for this connection.
                    </div>
                  ) : (
                    sourceHistoryJobs.slice(0, 8).map((job) => (
                      <SourceHistoryRow key={job.id} job={job} />
                    ))
                  )}
                </div>
              ) : null}

              <Separator />

              <div className="space-y-2">
                <p className="font-medium text-xs uppercase tracking-wide">
                  Session actions
                </p>
                {operatorTrailEvents.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
                    No operator actions recorded in this session.
                  </div>
                ) : (
                  operatorTrailEvents.slice(0, 8).map((event, index) => (
                    <div
                      className="rounded-lg border border-border/70 bg-card/45 px-3 py-2 text-xs"
                      data-testid={`source-operator-trail-${event.action}-${index}`}
                      key={`${event.action}_${event.connectionId}_${event.at}_${index}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {event.action} {event.connectionId}
                        </span>
                        <Badge variant="outline">{event.status}</Badge>
                      </div>
                      <p className="text-muted-foreground">
                        {formatDistanceToNowStrict(new Date(event.at), { addSuffix: true })}
                      </p>
                      {event.detail ? (
                        <p className="text-muted-foreground">{event.detail}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Live lane coverage</CardTitle>
            <CardDescription>
              How much active cognition is flowing through each lane.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <LaneRow
              count={metrics.laneCoverage.internal}
              label="Internal reality lane"
            />
            <LaneRow
              count={metrics.laneCoverage.external}
              label="External reality lane"
            />
            <LaneRow count={metrics.laneCoverage.bridge} label="Impact bridges" />
          </CardContent>
        </Card>

        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">World pressure watchlist</CardTitle>
            <CardDescription>
              Top exposed entities from the current twin contract.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(liveContract?.lanes.world_pressure ?? []).slice(0, 6).map((entity) => (
              <div
                className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2"
                key={entity.entity_id}
              >
                <div>
                  <p className="font-medium text-sm">{entity.entity_id}</p>
                  <p className="text-muted-foreground text-xs">{entity.tier}</p>
                </div>
                <Badge variant={entity.pressure_score >= 7 ? "destructive" : "secondary"}>
                  {Number(entity.pressure_score).toFixed(1)}
                </Badge>
              </div>
            ))}
            {(liveContract?.lanes.world_pressure ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                No pressure entities available yet.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4" data-testid="source-health-console">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-serif text-xl">Source Health Console</h2>
            <p className="text-muted-foreground text-sm">
              Continuous ingest telemetry across connected world sources.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{sourceHealthSummary.total} connectors</Badge>
            {sourceHealthSummary.telemetryUnavailable > 0 ? (
              <Badge variant="secondary">
                {sourceHealthSummary.telemetryUnavailable} telemetry unavailable
              </Badge>
            ) : null}
          </div>
        </div>

        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">
              Freshness lag, quota burn, and connector failures
            </CardTitle>
            <CardDescription>
              Synthesizes `/connections`, `/health`, and ingest run ledger signals into one operator surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <SourceHealthStat
                label="Stale or SLO-breached"
                value={String(sourceHealthSummary.staleOrBreached)}
              />
              <SourceHealthStat
                label="Average freshness lag"
                value={
                  sourceHealthSummary.avgFreshnessLagMinutes === null
                    ? "n/a"
                    : `${sourceHealthSummary.avgFreshnessLagMinutes}m`
                }
              />
              <SourceHealthStat
                label="Average quota burn"
                value={
                  sourceHealthSummary.avgQuotaBurnPercent === null
                    ? "n/a"
                    : `${sourceHealthSummary.avgQuotaBurnPercent}%`
                }
              />
            </div>

            {sourceHealthQuery.isError ? (
              <ApiErrorPanel
                error={sourceHealthQuery.error}
                onRetry={() => sourceHealthQuery.refetch()}
              />
            ) : sourceHealthQuery.isLoading ? (
              <Skeleton className="h-48" />
            ) : sourceHealthRows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                No source connections available for this organization yet.
              </div>
            ) : (
              <div className="space-y-2">
                {sourceHealthRows.slice(0, 8).map((row) => (
                  <SourceHealthRow key={row.connection.id} row={row} />
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
              <span>
                {sourceHealthSummary.failedOrDegraded} connectors degraded or failed.
              </span>
              <span>
                Generated{" "}
                {sourceHealthQuery.data?.generatedAt
                  ? format(
                      new Date(sourceHealthQuery.data.generatedAt),
                      "MMM d, yyyy HH:mm"
                    )
                  : "just now"}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Reality Scrubber</CardTitle>
            <CardDescription>
              Replay deterministic time slices by moving the horizon backward from the current anchor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <label className="font-medium text-sm" htmlFor="reality-scrubber-hours">
                Hours back
              </label>
              <input
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                id="reality-scrubber-hours"
                max={168}
                min={0}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setScrubHoursAgo(Number.isFinite(next) ? next : 0);
                }}
                step={1}
                type="range"
                value={scrubHoursAgo}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                Time slice: now - {scrubHoursAgo}h
              </span>
              <Badge variant="outline">
                {format(new Date(scrubTimestamp), "MMM d, yyyy HH:mm")}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-serif text-xl">Ledger Tape Lanes</h2>
            <p className="text-muted-foreground text-sm">
              Internal and external state transitions aligned with impact bridges.
            </p>
          </div>
          <Badge variant="outline">
            {laneTape.bridge.length} bridge
            {laneTape.bridge.length === 1 ? "" : "s"} mapped
          </Badge>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <LaneTapeColumn
            events={laneTape.internal}
            icon={<Waves className="h-3.5 w-3.5 text-ring" />}
            lane="internal"
            onOpenProof={openProofBundle}
            title="Internal lane"
          />
          <LaneTapeColumn
            events={laneTape.external}
            icon={<Radar className="h-3.5 w-3.5 text-ring" />}
            lane="external"
            onOpenProof={openProofBundle}
            title="External lane"
          />
        </div>
        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Impact bridges</CardTitle>
            <CardDescription>
              Cross-lane causality edges tying external pressure to internal exposure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {laneTape.bridge.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                No bridge edges detected for this horizon.
              </div>
            ) : (
              laneTape.bridge.map((bridge) => (
                <ImpactBridgeRow
                  event={bridge}
                  key={bridge.event_id}
                  onOpenProof={openProofBundle}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
        <DriftMeter
          confidence={metrics.averageConfidence}
          driftPercent={metrics.driftPercent}
          highOrCritical={metrics.highOrCritical}
          pressurePercent={metrics.pressurePercent}
          severityPercent={metrics.severityPressurePercent}
        />

        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Impact focus cards</CardTitle>
            <CardDescription>
              Highest-priority bridge edges encoded with severity and confidence.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topImpactEvents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                No impact bridges with confidence yet.
              </div>
            ) : (
              topImpactEvents.map((event) => (
                <ImpactCard
                  event={event}
                  key={event.event_id}
                  onOpenProof={openProofBundle}
                />
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Obligation Sentinel</CardTitle>
            <CardDescription>
              Pre-breach and post-breach triage workflows with deterministic action guidance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <ObligationSignalColumn
                actions={["acknowledge", "escalate", "simulate_impact"]}
                lane="pre_breach"
                onAction={runTriage}
                pendingAction={triageMutation.variables?.action}
                pendingViolationId={triageMutation.variables?.violationId}
                signals={preBreachSignals}
                title="Pre-breach warnings"
              />
              <ObligationSignalColumn
                actions={["escalate", "resolve", "simulate_impact"]}
                lane="post_breach"
                onAction={runTriage}
                pendingAction={triageMutation.variables?.action}
                pendingViolationId={triageMutation.variables?.violationId}
                signals={postBreachSignals}
                title="Post-breach open"
              />
            </div>
          </CardContent>
        </Card>

        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Triage guidance</CardTitle>
            <CardDescription>
              Workflow rails plus latest deterministic triage response.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 rounded-lg border border-border/70 bg-card/45 p-3">
              <p className="font-medium text-sm">Workflow blueprint</p>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Pre-breach
                </p>
                {workflowPreBreach.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No workflow configured.</p>
                ) : (
                  workflowPreBreach.map((step, index) => (
                    <p className="text-muted-foreground text-xs" key={`pre_${index}`}>
                      {index + 1}. {step}
                    </p>
                  ))
                )}
              </div>
              <Separator />
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Post-breach
                </p>
                {workflowPostBreach.length === 0 ? (
                  <p className="text-muted-foreground text-xs">No workflow configured.</p>
                ) : (
                  workflowPostBreach.map((step, index) => (
                    <p className="text-muted-foreground text-xs" key={`post_${index}`}>
                      {index + 1}. {step}
                    </p>
                  ))
                )}
              </div>
            </div>

            {triageMutation.isPending ? (
              <Skeleton className="h-28" />
            ) : null}

            {triageMutation.isError ? (
              <ApiErrorPanel
                error={triageMutation.error}
                onRetry={() => {
                  const pending = triageMutation.variables;
                  if (!pending) {
                    return;
                  }
                  runTriage(pending.violationId, pending.action);
                }}
              />
            ) : null}

            {latestTriage ? (
              <div
                className="space-y-2 rounded-lg border border-border/70 bg-card/55 p-3"
                data-testid="triage-result-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-sm">{latestTriage.violation_id}</p>
                  <Badge variant="outline">{latestTriage.action}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      severityEncoding(String(latestTriage.severity ?? "medium")).variant
                    }
                  >
                    {severityEncoding(String(latestTriage.severity ?? "medium")).label}
                  </Badge>
                  <Badge
                    variant={statusEncoding(String(latestTriage.status ?? "open")).variant}
                  >
                    {statusEncoding(String(latestTriage.status ?? "open")).label}
                  </Badge>
                </div>
                <div className="space-y-1">
                  {latestTriage.recommended_steps.map((step, index) => (
                    <p className="text-muted-foreground text-xs" key={`${step}_${index}`}>
                      {index + 1}. {step}
                    </p>
                  ))}
                </div>
                {latestTriage.counterfactual_preview ? (
                  <div className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
                    <p className="font-medium">
                      {latestTriage.counterfactual_preview.simulation_id}
                    </p>
                    <p className="text-muted-foreground">
                      risk {Number(latestTriage.counterfactual_preview.risk_score).toFixed(2)}{" "}
                      | utility delta{" "}
                      {Number(latestTriage.counterfactual_preview.utility_delta).toFixed(2)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                Run a triage action on a sentinel signal to populate guidance.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section
        className="grid gap-4 xl:grid-cols-[1.2fr_1fr]"
        data-testid="counterfactual-lab"
      >
        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Counterfactual Lab</CardTitle>
            <CardDescription>
              Compare scenario A/B outcomes and surface governed intervention rollback previews.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="scenario-a-name">
                  Scenario A name
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="scenario-a-name"
                  onChange={(event) => setScenarioAName(event.target.value)}
                  type="text"
                  value={scenarioAName}
                />
              </div>
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="scenario-b-name">
                  Scenario B name
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="scenario-b-name"
                  onChange={(event) => setScenarioBName(event.target.value)}
                  type="text"
                  value={scenarioBName}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="scenario-a-horizon">
                  Scenario A horizon (days)
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="scenario-a-horizon"
                  max={365}
                  min={1}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setScenarioAHorizonDays(clampHorizonDays(value));
                  }}
                  type="number"
                  value={scenarioAHorizonDays}
                />
              </div>
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="scenario-b-horizon">
                  Scenario B horizon (days)
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="scenario-b-horizon"
                  max={365}
                  min={1}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setScenarioBHorizonDays(clampHorizonDays(value));
                  }}
                  type="number"
                  value={scenarioBHorizonDays}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="counterfactual-target-ref">
                  Target reference
                </label>
                <input
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="counterfactual-target-ref"
                  onChange={(event) => setCounterfactualTargetRef(event.target.value)}
                  type="text"
                  value={counterfactualTargetRef}
                />
              </div>
              <div className="space-y-2">
                <label className="font-medium text-xs uppercase tracking-wide" htmlFor="counterfactual-max-severity">
                  Max constraint severity
                </label>
                <select
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  id="counterfactual-max-severity"
                  onChange={(event) => setMaxConstraintSeverity(event.target.value)}
                  value={maxConstraintSeverity}
                >
                  <option value="">none</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-medium text-xs uppercase tracking-wide" htmlFor="counterfactual-actions">
                Recommended actions (comma or newline separated)
              </label>
              <textarea
                className="min-h-[90px] w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                id="counterfactual-actions"
                onChange={(event) => setCounterfactualActionsText(event.target.value)}
                value={counterfactualActionsText}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                checked={includeInterventionPreviews}
                onChange={(event) => setIncludeInterventionPreviews(event.target.checked)}
                type="checkbox"
              />
              Generate intervention + rollback previews
            </label>

            <Button
              data-testid="run-counterfactual-compare"
              disabled={counterfactualMutation.isPending}
              onClick={() => counterfactualMutation.mutate()}
              size="sm"
              variant="default"
            >
              {counterfactualMutation.isPending ? "Running compare..." : "Compare scenarios"}
            </Button>
          </CardContent>
        </Card>

        <Card variant="dossier">
          <CardHeader>
            <CardTitle className="text-base">Comparison output</CardTitle>
            <CardDescription>
              Preferred scenario, utility-risk score delta, and rollback readiness.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {counterfactualMutation.isPending ? <Skeleton className="h-64" /> : null}
            {counterfactualMutation.isError ? (
              <ApiErrorPanel
                error={counterfactualMutation.error}
                onRetry={() => counterfactualMutation.mutate()}
              />
            ) : null}

            {counterfactualResult ? (
              <div className="space-y-3" data-testid="counterfactual-result-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">
                    preferred{" "}
                    {counterfactualResult.preferred === "tie"
                      ? "tie"
                      : counterfactualResult.preferred.toUpperCase()}
                  </Badge>
                  <Badge variant="secondary">
                    delta {Number(counterfactualResult.delta).toFixed(3)}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <CounterfactualScenarioCard
                    label="A"
                    scenario={counterfactualResult.scenario_a}
                    score={Number(counterfactualResult.score_a)}
                  />
                  <CounterfactualScenarioCard
                    label="B"
                    scenario={counterfactualResult.scenario_b}
                    score={Number(counterfactualResult.score_b)}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <RollbackPreviewCard
                    label="A"
                    preview={counterfactualResult.intervention_previews?.a}
                  />
                  <RollbackPreviewCard
                    label="B"
                    preview={counterfactualResult.intervention_previews?.b}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                Run a scenario comparison to render counterfactual and rollback previews.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card variant="dossier">
        <CardHeader>
          <CardTitle className="text-base">Latest cognition deltas</CardTitle>
          <CardDescription>
            Highest-signal transitions from the Ledger Tape.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : sortedEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-5 text-center text-muted-foreground text-sm">
              No deltas available for this organization yet.
            </div>
          ) : (
            sortedEvents.map((event) => (
              <TapeEventRow
                event={event}
                key={event.event_id}
                onOpenProof={openProofBundle}
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card variant="dossier" data-testid="signal-feedback-card">
        <CardHeader>
          <CardTitle className="text-base">Signal Feedback Loop</CardTitle>
          <CardDescription>
            Capture false-positive/false-negative judgments and correction labels into the learning pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sortedEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
              No tape events available for feedback yet.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="signal-feedback-event"
                >
                  Tape event
                </label>
                <select
                  className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  data-testid="signal-feedback-event-select"
                  id="signal-feedback-event"
                  onChange={(event) => setSelectedFeedbackEventId(event.target.value)}
                  value={selectedFeedbackEvent?.event_id ?? ""}
                >
                  {sortedEvents.map((event) => (
                    <option key={event.event_id} value={event.event_id}>
                      {event.event_id}: {event.summary}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="signal-feedback-verdict"
                  >
                    Verdict
                  </label>
                  <select
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    data-testid="signal-feedback-verdict"
                    id="signal-feedback-verdict"
                    onChange={(event) =>
                      setFeedbackVerdict(
                        event.target.value as
                          | "false_positive"
                          | "false_negative"
                          | "confirmed"
                      )
                    }
                    value={feedbackVerdict}
                  >
                    <option value="false_positive">false_positive</option>
                    <option value="false_negative">false_negative</option>
                    <option value="confirmed">confirmed</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label
                    className="font-medium text-xs uppercase tracking-wide"
                    htmlFor="signal-feedback-correction"
                  >
                    Correction label
                  </label>
                  <input
                    className="w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    data-testid="signal-feedback-correction-label"
                    id="signal-feedback-correction"
                    onChange={(event) => setFeedbackCorrectionLabel(event.target.value)}
                    type="text"
                    value={feedbackCorrectionLabel}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="font-medium text-xs uppercase tracking-wide"
                  htmlFor="signal-feedback-notes"
                >
                  Notes
                </label>
                <textarea
                  className="min-h-[80px] w-full rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                  data-testid="signal-feedback-notes"
                  id="signal-feedback-notes"
                  onChange={(event) => setFeedbackNotes(event.target.value)}
                  value={feedbackNotes}
                />
              </div>

              {!canSubmitFeedback ? (
                <div className="rounded-md border border-border/70 bg-card/45 px-3 py-2 text-muted-foreground text-xs">
                  Viewer role is read-only. Feedback submission requires member/admin/owner.
                </div>
              ) : null}

              <Button
                data-testid="submit-signal-feedback"
                disabled={
                  !canSubmitFeedback ||
                  feedbackMutation.isPending ||
                  !selectedFeedbackEvent?.event_id
                }
                onClick={runSubmitSignalFeedback}
                size="sm"
                variant="default"
              >
                {feedbackMutation.isPending ? "Submitting..." : "Submit feedback"}
              </Button>
            </div>
          )}

          {feedbackMutation.isError ? (
            <ApiErrorPanel
              error={feedbackMutation.error}
              onRetry={runSubmitSignalFeedback}
            />
          ) : null}

          {latestFeedbackResult ? (
            <div
              className="rounded-lg border border-border/70 bg-card/45 px-3 py-2"
              data-testid="signal-feedback-result"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-sm">{latestFeedbackResult.realized_outcome_id}</p>
                <Badge variant="outline">{latestFeedbackResult.outcome_type}</Badge>
              </div>
              <p className="mt-1 text-muted-foreground text-xs">
                captured {formatDistanceToNowStrict(new Date(latestFeedbackResult.measured_at), { addSuffix: true })}
              </p>
              <p className="text-muted-foreground text-xs">{latestFeedbackResult.outcome_hash}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Sheet
        onOpenChange={(open) => {
          setProofOpen(open);
          if (!open) {
            setSelectedProofEvent(null);
          }
        }}
        open={proofOpen}
      >
        <SheetContent className="w-[560px] p-0 sm:w-[700px]">
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b px-6 py-4">
              <SheetTitle>Proof Bundle</SheetTitle>
              <SheetDescription>
                Evidence citations, timeline, and confidence rationale for the selected tape event.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {proofBundleQuery.isLoading ? (
                <Skeleton className="h-64" />
              ) : null}

              {proofBundleQuery.isError ? (
                <ApiErrorPanel
                  error={proofBundleQuery.error}
                  onRetry={() => proofBundleQuery.refetch()}
                />
              ) : null}

              {!proofBundleQuery.isLoading && !proofBundleQuery.isError && !resolvedProofEvent ? (
                <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
                  Select a tape item to inspect its proof bundle.
                </div>
              ) : null}

              {resolvedProofEvent ? (
                <Card variant="dossier">
                  <CardHeader>
                    <CardTitle className="text-base">{resolvedProofEvent.summary}</CardTitle>
                    <CardDescription>{resolvedProofEvent.event_id}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="outline">{resolvedProofEvent.lane}</Badge>
                    <Badge variant="outline">{resolvedProofEvent.delta_domain}</Badge>
                    <Badge variant="secondary">
                      confidence{" "}
                      {Math.round(Number(resolvedProofEvent.confidence || 0) * 100)}%
                    </Badge>
                    <Badge variant="outline">
                      {resolvedProofEvent.occurred_at
                        ? format(new Date(resolvedProofEvent.occurred_at), "MMM d, yyyy HH:mm")
                        : "unknown"}
                    </Badge>
                    {resolvedProofBundle.bundle_id ? (
                      <Badge variant="outline">{resolvedProofBundle.bundle_id}</Badge>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}

              <Card variant="dossier">
                <CardHeader>
                  <CardTitle className="text-base">Citations</CardTitle>
                  <CardDescription>
                    Direct references backing this transition.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {proofCitations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
                      No citations available.
                    </div>
                  ) : (
                    proofCitations.map((citation, index) => (
                      <div
                        className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-sm"
                        key={`${String(citation.ref_id ?? "citation")}_${index}`}
                      >
                        <p className="font-medium">
                          {String(citation.ref_id ?? "unknown_reference")}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {String(citation.kind ?? "evidence")}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card variant="dossier">
                <CardHeader>
                  <CardTitle className="text-base">Timeline</CardTitle>
                  <CardDescription>
                    Ordered proof events linked to this bundle.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {proofTimeline.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/70 p-3 text-muted-foreground text-sm">
                      No timeline entries available.
                    </div>
                  ) : (
                    proofTimeline.map((entry, index) => (
                      <div
                        className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-sm"
                        key={`${String(entry.event ?? "event")}_${index}`}
                      >
                        <p className="font-medium">
                          {String(entry.event ?? "event")}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {String(entry.at ?? "timestamp_unavailable")}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card variant="dossier">
                <CardHeader>
                  <CardTitle className="text-base">Confidence rationale</CardTitle>
                  <CardDescription>
                    Structured reasoning payload from the intelligence pipeline.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-lg border border-border/70 bg-card/50 p-3 text-xs leading-relaxed">
                    {JSON.stringify(
                      resolvedProofBundle.confidence_reasoning ?? {},
                      null,
                      2
                    )}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function LaneRow({ label, count }: { label: string; count: number }) {
  const normalized = Math.min(100, Math.round((count / 30) * 100));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{count}</span>
      </div>
      <Progress className="h-1.5" value={normalized} />
    </div>
  );
}

function DriftMeter({
  driftPercent,
  severityPercent,
  pressurePercent,
  confidence,
  highOrCritical,
}: {
  driftPercent: number;
  severityPercent: number;
  pressurePercent: number;
  confidence: number;
  highOrCritical: number;
}) {
  const drift = driftEncoding(driftPercent);
  const confidenceMeta = confidenceEncoding(confidence);
  const confidencePercent = Math.round(normalizeConfidence(confidence) * 100);

  return (
    <Card
      data-confidence-tier={confidenceMeta.key}
      data-severity-level={drift.key}
      data-testid="drift-meter"
      variant="dossier"
    >
      <CardHeader>
        <CardTitle className="text-base">Drift Meter</CardTitle>
        <CardDescription>
          Composite signal blending severity-weighted deltas with world pressure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1">
            <p className="font-serif text-3xl leading-none">{driftPercent}</p>
            <p className="text-muted-foreground text-xs">Drift index / 100</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={drift.variant}>{drift.label}</Badge>
            <Badge variant={confidenceMeta.variant}>{confidenceMeta.label}</Badge>
          </div>
        </div>

        <Progress className="h-2.5" value={driftPercent} />

        <div className="space-y-2 text-muted-foreground text-xs">
          <div className="flex items-center justify-between">
            <span>Severity pressure</span>
            <span>{severityPercent}%</span>
          </div>
          <Progress className="h-1.5" value={severityPercent} />
          <div className="flex items-center justify-between">
            <span>World pressure</span>
            <span>{pressurePercent}%</span>
          </div>
          <Progress className="h-1.5" value={pressurePercent} />
        </div>

        <p className="text-muted-foreground text-xs">
          {highOrCritical} high-severity deltas with aggregate confidence{" "}
          {confidencePercent}%.
        </p>
      </CardContent>
    </Card>
  );
}

function sourceHealthStatusEncoding(status: string): {
  key: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  const normalized = status.trim().toLowerCase();
  if (
    normalized === "healthy" ||
    normalized === "active" ||
    normalized === "connected"
  ) {
    return { key: normalized, variant: "default", label: "Healthy" };
  }
  if (
    normalized === "degraded" ||
    normalized === "recovering" ||
    normalized === "paused"
  ) {
    return { key: normalized, variant: "secondary", label: "Degraded" };
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "disconnected"
  ) {
    return { key: normalized, variant: "destructive", label: "Failed" };
  }
  return {
    key: normalized || "unknown",
    variant: "outline",
    label: normalized || "Unknown",
  };
}

function sourceRunStatusEncoding(status: string): {
  key: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
} {
  const normalized = status.trim().toLowerCase();
  if (normalized === "succeeded" || normalized === "completed") {
    return { key: normalized, variant: "default", label: "Run healthy" };
  }
  if (normalized === "running" || normalized === "pending") {
    return { key: normalized, variant: "secondary", label: "Run active" };
  }
  if (normalized === "failed") {
    return { key: normalized, variant: "destructive", label: "Run failed" };
  }
  return {
    key: normalized || "unknown",
    variant: "outline",
    label: normalized || "Run unknown",
  };
}

function SourceHealthStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/45 px-3 py-2">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
      <p className="mt-1 font-serif text-2xl leading-none">{value}</p>
    </div>
  );
}

function SourceHealthRow({ row }: { row: SourceHealthConsoleRow }) {
  const sourceStatus = sourceHealthStatusEncoding(
    String(row.health?.status ?? row.connection.status ?? "unknown")
  );
  const latestRunStatus = sourceRunStatusEncoding(String(row.latestRun?.status ?? "no_run"));
  const freshnessLagMinutes = normalizeMinutes(
    row.latestRun?.freshness_lag_minutes ?? row.health?.minutes_since_last_sync
  );
  const quotaBurn = quotaBurnPercent(row.latestRun?.quota_headroom_ratio);
  const checkedAt = parseEventTime(
    row.health?.checked_at ?? row.latestRun?.started_at ?? null
  );
  const recentFailures = Number(row.health?.recent_failures ?? 0);

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/45 p-3"
      data-severity={
        row.fetchError || row.health?.sync_slo_breached || recentFailures > 0
          ? "elevated"
          : "stable"
      }
      data-testid={`source-health-row-${row.connection.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{row.connection.name}</p>
          <p className="text-muted-foreground text-xs">{row.connection.connector_type}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant={sourceStatus.variant}>{sourceStatus.label}</Badge>
          <Badge variant={latestRunStatus.variant}>{latestRunStatus.label}</Badge>
          {row.health?.sync_slo_breached ? (
            <Badge variant="destructive">SLO breached</Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1.5">
          <p className="text-muted-foreground">freshness lag</p>
          <p className="font-medium">
            {freshnessLagMinutes === null ? "n/a" : `${freshnessLagMinutes}m`}
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1.5">
          <p className="text-muted-foreground">quota burn</p>
          <p className="font-medium">{quotaBurn === null ? "n/a" : `${quotaBurn}%`}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1.5">
          <p className="text-muted-foreground">recent failures</p>
          <p className="font-medium">{recentFailures}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1.5">
          <p className="text-muted-foreground">retry class</p>
          <p className="font-medium">{row.latestRun?.retry_class ?? "none"}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        <span>
          {row.fetchError ??
            row.health?.reason ??
            row.health?.recovery_action ??
            "health telemetry stable"}
        </span>
        <span>
          {checkedAt === null
            ? "timestamp unavailable"
            : `checked ${formatDistanceToNowStrict(checkedAt, { addSuffix: true })}`}
        </span>
      </div>
    </div>
  );
}

function SourceHistoryRow({ job }: { job: WorldBrainSourceHistoryJob }) {
  const status = sourceRunStatusEncoding(String(job.status ?? "unknown"));
  const startedAt = parseEventTime(job.started_at ?? null);
  const completedAt = parseEventTime(job.completed_at ?? null);
  const hasFailure =
    String(job.status ?? "").toLowerCase() === "failed" ||
    (typeof job.error_message === "string" && job.error_message.trim().length > 0);

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/45 px-3 py-2"
      data-severity={hasFailure ? "elevated" : "stable"}
      data-testid={`source-history-job-${job.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{job.job_type}</Badge>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <span className="text-muted-foreground text-xs">
          {startedAt
            ? formatDistanceToNowStrict(startedAt, { addSuffix: true })
            : "start unavailable"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1">
          <p className="text-muted-foreground">records</p>
          <p className="font-medium">{Number(job.records_synced || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1">
          <p className="text-muted-foreground">bytes</p>
          <p className="font-medium">{Number(job.bytes_synced || 0).toLocaleString()}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/35 px-2 py-1">
          <p className="text-muted-foreground">duration</p>
          <p className="font-medium">
            {typeof job.duration_seconds === "number"
              ? `${job.duration_seconds}s`
              : completedAt
                ? "completed"
                : "running"}
          </p>
        </div>
      </div>
      {Array.isArray(job.streams) && job.streams.length > 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">
          streams: {job.streams.join(", ")}
        </p>
      ) : null}
      {job.error_message ? (
        <p className="mt-1 text-destructive text-xs">{job.error_message}</p>
      ) : null}
    </div>
  );
}

function ObligationSignalColumn({
  title,
  lane,
  signals,
  actions,
  pendingViolationId,
  pendingAction,
  onAction,
}: {
  title: string;
  lane: "pre_breach" | "post_breach";
  signals: WorldBrainObligationSignal[];
  actions: TriageAction[];
  pendingViolationId?: string;
  pendingAction?: TriageAction;
  onAction: (signalId: string, action: TriageAction) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">{title}</p>
      {signals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 p-3 text-muted-foreground text-xs">
          No {lane === "pre_breach" ? "pre-breach" : "post-breach"} signals.
        </div>
      ) : (
        signals.slice(0, 5).map((signal) => (
          <ObligationSignalRow
            actions={actions}
            key={String(signal.id)}
            onAction={onAction}
            pending={
              pendingViolationId === String(signal.id) ? pendingAction ?? null : null
            }
            signal={signal}
          />
        ))
      )}
    </div>
  );
}

function ObligationSignalRow({
  signal,
  actions,
  pending,
  onAction,
}: {
  signal: WorldBrainObligationSignal;
  actions: TriageAction[];
  pending: TriageAction | null;
  onAction: (signalId: string, action: TriageAction) => void;
}) {
  const severity = severityEncoding(String(signal.severity ?? "medium"));
  const status = statusEncoding(String(signal.status ?? "warning"));
  const signalId = String(signal.id);
  const confidence = normalizeConfidence(signal.confidence);
  const hasConfidence =
    signal.confidence !== undefined && signal.confidence !== null;
  const occurredAt = parseEventTime(
    typeof signal.occurred_at === "string" ? signal.occurred_at : null
  );

  return (
    <div
      className="space-y-2 rounded-lg border border-border/70 bg-card/45 p-3"
      data-severity={severity.key}
      data-status={status.key}
      data-testid={`obligation-signal-${signalId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="line-clamp-1 font-medium text-sm">{obligationSignalTitle(signal)}</p>
        <div className="flex items-center gap-1">
          <Badge variant={severity.variant}>{severity.label}</Badge>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
        <span>{signalId}</span>
        <span>
          {occurredAt
            ? formatDistanceToNowStrict(occurredAt, { addSuffix: true })
            : "timestamp unavailable"}
        </span>
      </div>
      {hasConfidence ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-muted-foreground text-xs">
            <span>{confidenceEncoding(confidence).label}</span>
            <span>{Math.round(confidence * 100)}%</span>
          </div>
          <Progress className="h-1.5" value={Math.round(confidence * 100)} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => (
          <Button
            data-testid={`triage-${action}-${signalId}`}
            disabled={Boolean(pending)}
            key={`${signalId}_${action}`}
            onClick={() => onAction(signalId, action)}
            size="sm"
            variant={action === "simulate_impact" ? "outline" : "ghost"}
          >
            {pending === action ? "Running..." : action}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CounterfactualScenarioCard({
  label,
  scenario,
  score,
}: {
  label: "A" | "B";
  scenario: WorldBrainCounterfactualComparison["scenario_a"];
  score: number;
}) {
  const riskScore = Number(scenario.simulated?.risk_score ?? 0);
  const utility = Number(scenario.utility?.simulated_utility ?? 0);
  const downside = Number(scenario.downside_risk_estimate ?? 0);

  return (
    <div className="space-y-1 rounded-lg border border-border/70 bg-card/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-sm">
          Scenario {label}: {String(scenario.scenario_name ?? `scenario_${label.toLowerCase()}`)}
        </p>
        <Badge variant="outline">score {Number(score || 0).toFixed(3)}</Badge>
      </div>
      <p className="text-muted-foreground text-xs">
        {String(scenario.simulation_id ?? "simulation_id_unavailable")}
      </p>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border border-border/60 bg-card/40 px-2 py-1">
          <p className="text-muted-foreground">risk</p>
          <p className="font-medium">{Number(riskScore || 0).toFixed(2)}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/40 px-2 py-1">
          <p className="text-muted-foreground">utility</p>
          <p className="font-medium">{Number(utility || 0).toFixed(2)}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-card/40 px-2 py-1">
          <p className="text-muted-foreground">downside</p>
          <p className="font-medium">{Number(downside || 0).toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

function RollbackPreviewCard({
  label,
  preview,
}: {
  label: "A" | "B";
  preview: Record<string, unknown> | undefined;
}) {
  const rollbackSteps = extractRollbackSteps(preview);
  const rollbackVerified = extractRollbackVerified(preview);
  const interventionId =
    preview && typeof preview.intervention_id === "string"
      ? preview.intervention_id
      : `intervention_${label.toLowerCase()}`;
  const policyClass =
    preview && typeof preview.policy_class === "string"
      ? preview.policy_class
      : "policy_unavailable";

  return (
    <div
      className="space-y-2 rounded-lg border border-border/70 bg-card/45 p-3"
      data-testid={`rollback-preview-${label.toLowerCase()}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-sm">Rollback preview {label}</p>
        <Badge
          variant={
            rollbackVerified === null
              ? "outline"
              : rollbackVerified
                ? "default"
                : "destructive"
          }
        >
          {rollbackVerified === null
            ? "unknown"
            : rollbackVerified
              ? "verified"
              : "not verified"}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">{interventionId}</p>
      <p className="text-muted-foreground text-xs">{policyClass}</p>
      {rollbackSteps.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 p-2 text-muted-foreground text-xs">
          Rollback steps unavailable for preview.
        </div>
      ) : (
        <div className="space-y-1">
          {rollbackSteps.slice(0, 4).map((step, index) => (
            <p className="text-muted-foreground text-xs" key={`${label}_${index}_${step}`}>
              {index + 1}. {step}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function LaneTapeColumn({
  lane,
  title,
  icon,
  events,
  onOpenProof,
}: {
  lane: "internal" | "external";
  title: string;
  icon: ReactNode;
  events: WorldBrainTapeEvent[];
  onOpenProof: (event: WorldBrainTapeEvent) => void;
}) {
  return (
    <Card variant="dossier">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>
          {events.length} high-signal transition{events.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-4 text-muted-foreground text-sm">
            No {lane} deltas yet.
          </div>
        ) : (
          events.map((event) => (
            <div
              className="rounded-lg border border-border/70 bg-card/55 p-3"
              key={event.event_id}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{event.delta_domain}</Badge>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {Math.round(Number(event.confidence || 0) * 100)}%
                  </span>
                  <Button
                    aria-label={`Open proof bundle ${event.event_id}`}
                    data-testid={`open-proof-${event.event_id}`}
                    onClick={() => onOpenProof(event)}
                    size="sm"
                    variant="ghost"
                  >
                    Proof
                  </Button>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm">{event.summary}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ImpactCard({
  event,
  onOpenProof,
}: {
  event: WorldBrainTapeEvent;
  onOpenProof: (event: WorldBrainTapeEvent) => void;
}) {
  const bridge = event.impact_bridge as
    | {
        external_ref?: string;
        internal_ref?: string;
        impact_type?: string;
        severity?: string;
      }
    | undefined;
  const severity = severityEncoding(
    String(bridge?.severity ?? event.severity ?? "medium")
  );
  const confidence = normalizeConfidence(event.confidence);
  const confidenceMeta = confidenceEncoding(confidence);
  const confidencePercent = Math.round(confidence * 100);

  return (
    <div
      className="rounded-xl border border-border/70 bg-card/55 p-3"
      data-confidence-tier={confidenceMeta.key}
      data-severity={severity.key}
      data-testid={`impact-card-${event.event_id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={severity.variant}>{severity.label}</Badge>
          <Badge variant="outline">{bridge?.impact_type ?? event.delta_domain}</Badge>
        </div>
        <Button
          aria-label={`Open proof bundle ${event.event_id}`}
          data-testid={`open-proof-${event.event_id}`}
          onClick={() => onOpenProof(event)}
          size="sm"
          variant="ghost"
        >
          Proof
        </Button>
      </div>

      <p className="mt-2 text-sm">{event.summary}</p>

      <div className="mt-2 grid gap-1.5 text-muted-foreground text-xs">
        <div className="flex items-center justify-between">
          <span>{bridge?.external_ref ?? "external_signal"}</span>
          <span>{bridge?.internal_ref ?? "internal_exposure"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{confidenceMeta.label}</span>
          <span>{confidencePercent}%</span>
        </div>
        <Progress className="h-1.5" value={confidencePercent} />
      </div>
    </div>
  );
}

function ImpactBridgeRow({
  event,
  onOpenProof,
}: {
  event: WorldBrainTapeEvent;
  onOpenProof: (event: WorldBrainTapeEvent) => void;
}) {
  const bridge = event.impact_bridge as
    | {
        external_ref?: string;
        internal_ref?: string;
        impact_type?: string;
        severity?: string;
      }
    | undefined;
  const externalRef = bridge?.external_ref ?? "external_signal";
  const internalRef = bridge?.internal_ref ?? "internal_exposure";
  const impactType = bridge?.impact_type ?? event.delta_domain ?? "impact";
  const severity = severityEncoding(
    String(bridge?.severity ?? event.severity ?? "medium")
  );
  const confidence = normalizeConfidence(event.confidence);
  const confidenceMeta = confidenceEncoding(confidence);

  return (
    <div
      className="rounded-lg border border-border/70 bg-card/40 px-3 py-2"
      data-confidence-tier={confidenceMeta.key}
      data-severity={severity.key}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{externalRef}</span>
          <span className="text-muted-foreground">{"->"}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{internalRef}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{impactType}</Badge>
          <Badge variant={severity.variant}>{severity.label}</Badge>
          <Badge variant={confidenceMeta.variant}>{confidenceMeta.key}</Badge>
          <Button
            aria-label={`Open proof bundle ${event.event_id}`}
            data-testid={`open-proof-${event.event_id}`}
            onClick={() => onOpenProof(event)}
            size="sm"
            variant="ghost"
          >
            Proof
          </Button>
        </div>
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        confidence {Math.round(confidence * 100)}%
      </p>
    </div>
  );
}

function TapeEventRow({
  event,
  onOpenProof,
}: {
  event: WorldBrainTapeEvent;
  onOpenProof: (event: WorldBrainTapeEvent) => void;
}) {
  const occurredAt = parseEventTime(event.occurred_at);
  const severity = severityEncoding(String(event.severity ?? "low"));
  const confidence = normalizeConfidence(event.confidence);
  const confidenceMeta = confidenceEncoding(confidence);

  return (
    <div
      className="rounded-lg border border-border/70 p-3"
      data-confidence-tier={confidenceMeta.key}
      data-severity={severity.key}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={severity.variant}>{severity.label}</Badge>
          <Badge variant="outline">{event.delta_domain}</Badge>
          <Badge variant="secondary">{event.lane}</Badge>
          <Badge variant={confidenceMeta.variant}>{confidenceMeta.key}</Badge>
        </div>
        <div className="text-muted-foreground text-xs">
          {occurredAt ? formatDistanceToNowStrict(occurredAt, { addSuffix: true }) : "unknown"}
        </div>
      </div>
      <p className="mt-2 text-sm">{event.summary}</p>
      <Separator className="my-2" />
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>confidence {Math.round(confidence * 100)}%</span>
        <div className="flex items-center gap-2">
          {severityRank(severity.key) >= 3 ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              attention required
            </span>
          ) : null}
          <Button
            aria-label={`Open proof bundle ${event.event_id}`}
            data-testid={`open-proof-${event.event_id}`}
            onClick={() => onOpenProof(event)}
            size="sm"
            variant="ghost"
          >
            Proof
          </Button>
        </div>
      </div>
    </div>
  );
}
