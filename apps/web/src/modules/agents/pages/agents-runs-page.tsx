import type {
  ActionReceiptRecord,
  AgentFeedbackModel,
  AgentRunModel,
  RunQualityScoreRecord,
} from "@memorystack/api-types";
import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import { Separator } from "@memorystack/ui-core/separator";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CircleSlash2,
  Loader2,
  PauseCircle,
  PlayCircle,
  Skull,
  Sparkles,
  TextSearch,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { agentsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useAgentRunStream } from "@/modules/agents/hooks/use-agent-run-stream";
import {
  formatDateTime,
  statusBadgeClass,
} from "@/modules/agents/lib/agent-ui";

function createControlActionLabel(
  action: "pause" | "resume" | "cancel" | "kill"
) {
  if (action === "pause") return "Pause";
  if (action === "resume") return "Resume";
  if (action === "cancel") return "Cancel";
  return "Kill";
}

export function AgentsRunsPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [selectedRunId, setSelectedRunId] = useState("");
  const [finalStatusFilter, setFinalStatusFilter] = useState("all");
  const [feedbackVerdict, setFeedbackVerdict] = useState<
    "accepted" | "edited" | "rejected"
  >("accepted");
  const [feedbackReason, setFeedbackReason] = useState("");

  const runsQuery = useQuery({
    queryKey: ["agent-runs-page-runs", organizationId],
    queryFn: () =>
      agentsAPI.listRuns({
        organizationId,
        limit: 200,
      }),
    enabled: Boolean(organizationId),
    refetchInterval: 5000,
  });

  const selectedRun = useMemo(
    () => runsQuery.data?.find((run) => run.id === selectedRunId) ?? null,
    [runsQuery.data, selectedRunId]
  );

  const replayQuery = useQuery({
    queryKey: ["agent-runs-page-replay", selectedRun?.id],
    queryFn: () => agentsAPI.replayRun(selectedRun?.id ?? ""),
    enabled: Boolean(selectedRun?.id),
  });

  const receiptsQuery = useQuery({
    queryKey: [
      "agent-runs-page-receipts",
      organizationId,
      selectedRun?.id,
      finalStatusFilter,
    ],
    queryFn: () =>
      agentsAPI.listReceipts({
        organizationId,
        runId: selectedRun?.id ?? undefined,
        finalStatus:
          finalStatusFilter === "all" ? undefined : finalStatusFilter,
      }),
    enabled: Boolean(organizationId && selectedRun?.id),
  });

  const runQualityQuery = useQuery({
    queryKey: [
      "agent-runs-page-quality-score",
      organizationId,
      selectedRun?.id,
    ],
    queryFn: async () => {
      const scores = await agentsAPI.listRunQualityScores({
        organizationId,
        runId: selectedRun?.id,
        limit: 1,
      });
      return scores[0] ?? null;
    },
    enabled: Boolean(organizationId && selectedRun?.id),
  });

  const feedbackQuery = useQuery({
    queryKey: ["agent-runs-page-feedback", organizationId, selectedRun?.id],
    queryFn: () =>
      agentsAPI.listFeedback({
        organizationId,
        runId: selectedRun?.id ?? undefined,
      }),
    enabled: Boolean(organizationId && selectedRun?.id),
  });

  const trendQuery = useQuery({
    queryKey: ["agent-runs-page-quality-trends", organizationId],
    queryFn: () =>
      agentsAPI.getQualityTrends({
        organizationId,
        lookbackDays: 14,
      }),
    enabled: Boolean(organizationId),
  });

  const recommendationsQuery = useQuery({
    queryKey: [
      "agent-runs-page-quality-recommendations",
      organizationId,
      selectedRun?.deployment_id,
    ],
    queryFn: () =>
      agentsAPI.listRecommendations({
        organizationId,
        deploymentId: selectedRun?.deployment_id ?? undefined,
        status: "open",
        limit: 5,
      }),
    enabled: Boolean(organizationId && selectedRun?.deployment_id),
  });

  const runControlMutation = useMutation({
    mutationFn: async (params: {
      run: AgentRunModel;
      action: "pause" | "resume" | "cancel" | "kill";
    }) => {
      if (params.action === "pause") {
        return agentsAPI.pauseRun(params.run.id, organizationId);
      }
      if (params.action === "resume") {
        return agentsAPI.resumeRun(params.run.id, organizationId);
      }
      if (params.action === "cancel") {
        return agentsAPI.cancelRun(params.run.id, organizationId);
      }
      return agentsAPI.killRun(params.run.id, organizationId);
    },
    onSuccess: async () => {
      toast.success("Run control signal sent");
      await queryClient.invalidateQueries({
        queryKey: ["agent-runs-page-runs", organizationId],
      });
      await replayQuery.refetch();
      await receiptsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to send run control signal");
    },
  });

  const scoreRunMutation = useMutation({
    mutationFn: async (runId: string) =>
      agentsAPI.scoreRunQuality({
        runId,
        organizationId,
      }),
    onSuccess: async () => {
      toast.success("Quality score updated");
      await runQualityQuery.refetch();
      await trendQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to compute quality score");
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRun?.id) {
        throw new Error("Run not selected");
      }
      return agentsAPI.createFeedback({
        organization_id: organizationId,
        run_id: selectedRun.id,
        deployment_id: selectedRun.deployment_id ?? undefined,
        verdict: feedbackVerdict,
        reason: feedbackReason.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setFeedbackReason("");
      toast.success("Feedback recorded");
      await feedbackQuery.refetch();
      if (selectedRun?.id) {
        await scoreRunMutation.mutateAsync(selectedRun.id);
      }
      await recommendationsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to submit feedback");
    },
  });

  const recommendationMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRun?.deployment_id) {
        throw new Error("Deployment missing");
      }
      return agentsAPI.generateRecommendations({
        organizationId,
        deploymentId: selectedRun.deployment_id,
        lookbackDays: 30,
      });
    },
    onSuccess: async () => {
      toast.success("Recommendations refreshed");
      await recommendationsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to refresh recommendations");
    },
  });

  const onRunUpdate = useCallback(
    (event: { id: string; status: string; updated_at: unknown }) => {
      queryClient.setQueryData<AgentRunModel[] | undefined>(
        ["agent-runs-page-runs", organizationId],
        (previous) => {
          if (!previous) {
            return previous;
          }
          return previous.map((run) =>
            run.id === event.id
              ? {
                  ...run,
                  status: event.status,
                  updated_at: event.updated_at,
                }
              : run
          );
        }
      );
    },
    [organizationId, queryClient]
  );

  useAgentRunStream({
    organizationId,
    enabled: Boolean(organizationId),
    onRunUpdate,
  });

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select an organization to view Agent runs.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <TextSearch className="h-3.5 w-3.5" />
            Agent run diagnostics
          </div>
          <h1 className="font-semibold text-2xl">
            Trace, replay, and control run lifecycles
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Runtime traces, evidence references, receipts, and direct run
            controls.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Runs</CardTitle>
            <CardDescription>
              Select a run to inspect replay and receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            {runsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : runsQuery.isError ? (
              <ApiErrorPanel
                error={runsQuery.error}
                onRetry={() => runsQuery.refetch()}
              />
            ) : (runsQuery.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                No runs found.
              </div>
            ) : (
              <ScrollArea className="h-[480px] pr-2">
                <div className="space-y-2">
                  {runsQuery.data?.map((run) => (
                    <button
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left",
                        selectedRunId === run.id &&
                          "border-primary bg-primary/5"
                      )}
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">{run.id}</p>
                        <Badge className={statusBadgeClass("run", run.status)}>
                          {run.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Updated {formatDateTime(run.updated_at)}
                      </p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Replay & receipts</CardTitle>
            <CardDescription>
              Detailed run steps, evidence, and final action receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 space-y-4">
            {selectedRun ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={statusBadgeClass("run", selectedRun.status)}
                  >
                    {selectedRun.status}
                  </Badge>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "pause",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PauseCircle className="mr-2 h-4 w-4" />
                    {createControlActionLabel("pause")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "resume",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {createControlActionLabel("resume")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "cancel",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <CircleSlash2 className="mr-2 h-4 w-4" />
                    {createControlActionLabel("cancel")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "kill",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <Skull className="mr-2 h-4 w-4" />
                    {createControlActionLabel("kill")}
                  </Button>
                </div>

                <Separator />

                {replayQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading replay steps…
                  </div>
                ) : replayQuery.isError ? (
                  <ApiErrorPanel
                    error={replayQuery.error}
                    onRetry={() => replayQuery.refetch()}
                  />
                ) : (
                  <ScrollArea className="h-[220px] pr-2">
                    <div className="space-y-2">
                      {replayQuery.data?.steps?.map((step) => (
                        <div className="rounded-lg border p-3" key={step.id}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-sm">
                              {step.step_type}
                            </p>
                            <Badge
                              className={statusBadgeClass("run", step.status)}
                            >
                              {step.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground text-xs">
                            {formatDateTime(
                              step.completed_at || step.created_at
                            )}
                          </p>
                          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                            {JSON.stringify(step.evidence_refs ?? {}, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-sm">Receipts</p>
                  {receiptsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading receipts…
                    </div>
                  ) : receiptsQuery.isError ? (
                    <ApiErrorPanel
                      error={receiptsQuery.error}
                      onRetry={() => receiptsQuery.refetch()}
                    />
                  ) : (
                    <ReceiptsList receipts={receiptsQuery.data ?? []} />
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">Run quality</p>
                    <Button
                      disabled={
                        scoreRunMutation.isPending ||
                        !selectedRun?.id ||
                        runControlMutation.isPending
                      }
                      onClick={() =>
                        selectedRun?.id
                          ? scoreRunMutation.mutate(selectedRun.id)
                          : undefined
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Recompute score
                    </Button>
                  </div>
                  {runQualityQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading quality metrics…
                    </div>
                  ) : runQualityQuery.isError ? (
                    <ApiErrorPanel
                      error={runQualityQuery.error}
                      onRetry={() => runQualityQuery.refetch()}
                    />
                  ) : runQualityQuery.data ? (
                    <RunQualityCard score={runQualityQuery.data} />
                  ) : (
                    <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
                      No quality score yet. Compute a score to initialize
                      trends.
                    </div>
                  )}
                  <QualityTrendSparkline
                    isLoading={trendQuery.isLoading}
                    points={trendQuery.data?.points ?? []}
                  />
                </div>

                <Separator />

                <div className="space-y-3">
                  <p className="font-medium text-sm">Human feedback</p>
                  <div className="flex flex-wrap gap-2">
                    {(["accepted", "edited", "rejected"] as const).map(
                      (verdict) => (
                        <Button
                          className={cn(
                            "capitalize",
                            feedbackVerdict === verdict &&
                              "border-primary bg-primary/10 text-primary"
                          )}
                          key={verdict}
                          onClick={() => setFeedbackVerdict(verdict)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {verdict}
                        </Button>
                      )
                    )}
                  </div>
                  <Textarea
                    onChange={(event) => setFeedbackReason(event.target.value)}
                    placeholder="Why this output should be improved (optional)"
                    rows={3}
                    value={feedbackReason}
                  />
                  <Button
                    disabled={feedbackMutation.isPending || !selectedRun?.id}
                    onClick={() => feedbackMutation.mutate()}
                    size="sm"
                    type="button"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Submit feedback
                  </Button>
                  {feedbackQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading feedback history…
                    </div>
                  ) : feedbackQuery.isError ? (
                    <ApiErrorPanel
                      error={feedbackQuery.error}
                      onRetry={() => feedbackQuery.refetch()}
                    />
                  ) : (
                    <FeedbackHistory items={feedbackQuery.data ?? []} />
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-sm">Recommendations</p>
                    <Button
                      disabled={
                        recommendationMutation.isPending ||
                        !selectedRun?.deployment_id
                      }
                      onClick={() => recommendationMutation.mutate()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                  {recommendationsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading recommendations…
                    </div>
                  ) : recommendationsQuery.isError ? (
                    <ApiErrorPanel
                      error={recommendationsQuery.error}
                      onRetry={() => recommendationsQuery.refetch()}
                    />
                  ) : (
                    <RecommendationsList
                      items={recommendationsQuery.data ?? []}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                Select a run from the list.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReceiptsList({ receipts }: { receipts: ActionReceiptRecord[] }) {
  if (receipts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
        No receipts recorded for this run yet.
      </div>
    );
  }
  return (
    <ScrollArea className="h-[140px] pr-2">
      <div className="space-y-2">
        {receipts.map((receipt) => (
          <div className="rounded-lg border px-3 py-2" key={receipt.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{receipt.tool_id}</p>
              <Badge className={statusBadgeClass("run", receipt.final_status)}>
                {receipt.final_status}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {formatDateTime(receipt.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function RunQualityCard({ score }: { score: RunQualityScoreRecord }) {
  const qualityPercent = Math.round((score.quality_score ?? 0) * 100);
  const confidencePercent = Math.round((score.confidence_score ?? 0) * 100);
  const outcomePercent =
    typeof score.outcome_score === "number"
      ? Math.round(score.outcome_score * 100)
      : null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <MetricPill label="Quality" value={`${qualityPercent}%`} />
        <MetricPill label="Confidence" value={`${confidencePercent}%`} />
        <MetricPill
          label="Outcome"
          value={outcomePercent === null ? "pending" : `${outcomePercent}%`}
        />
      </div>
      <p className="mt-2 text-muted-foreground text-xs">
        Last evaluated {formatDateTime(score.evaluated_at)}
      </p>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
        {label}
      </p>
      <p className="font-semibold text-sm">{value}</p>
    </div>
  );
}

function QualityTrendSparkline({
  isLoading,
  points,
}: {
  isLoading: boolean;
  points: { avg_quality_score?: number | null; bucket_start: string }[];
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading trend…
      </div>
    );
  }
  if (points.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs">
        No trend data in the selected lookback window.
      </div>
    );
  }
  const lastPoints = points.slice(-7);
  return (
    <div className="rounded-lg border bg-muted/10 p-3">
      <p className="mb-2 text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
        Last 7 days quality trend
      </p>
      <div className="flex items-end gap-1.5">
        {lastPoints.map((point) => {
          const value = Math.max(0, Math.min(1, point.avg_quality_score ?? 0));
          return (
            <div
              className="flex flex-1 flex-col items-center"
              key={point.bucket_start}
            >
              <div
                className="w-full rounded-sm bg-primary/70"
                style={{ height: `${Math.max(8, Math.round(value * 64))}px` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeedbackHistory({ items }: { items: AgentFeedbackModel[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs">
        No feedback recorded yet.
      </div>
    );
  }
  return (
    <ScrollArea className="h-[120px] pr-2">
      <div className="space-y-2">
        {items.slice(0, 8).map((item) => (
          <div
            className="rounded-md border bg-muted/20 px-3 py-2"
            key={item.id}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge className="capitalize" variant="outline">
                {item.verdict}
              </Badge>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(item.created_at)}
              </p>
            </div>
            {item.reason ? (
              <p className="mt-1 text-muted-foreground text-xs">
                {item.reason}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function RecommendationsList({
  items,
}: {
  items: {
    id: string;
    priority?: string | null;
    summary: string;
    recommendation_type: string;
  }[];
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-xs">
        No active recommendations.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((item) => (
        <div className="rounded-md border bg-muted/20 px-3 py-2" key={item.id}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium text-sm">{item.recommendation_type}</p>
            <Badge className="capitalize" variant="outline">
              {item.priority ?? "medium"}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{item.summary}</p>
        </div>
      ))}
    </div>
  );
}
