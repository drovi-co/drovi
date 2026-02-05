// =============================================================================
// SIMULATION ENGINE
// =============================================================================
//
// Run what-if scenarios against commitments and risk posture.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Loader2,
  Play,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import {
  simulationsAPI,
  type SimulationResult,
} from "@/lib/api";

export const Route = createFileRoute("/dashboard/simulations/")({
  component: SimulationPage,
});

function SimulationPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [scenarioName, setScenarioName] = useState("Quarterly stress test");
  const [horizonDays, setHorizonDays] = useState("30");
  const [overridesText, setOverridesText] = useState(
    JSON.stringify(
      {
        commitment_delays: {},
        commitment_cancellations: [],
      },
      null,
      2
    )
  );
  const [latestResult, setLatestResult] = useState<SimulationResult | null>(
    null
  );

  const { data: history, isLoading } = useQuery({
    queryKey: ["simulation-history", organizationId],
    queryFn: () => simulationsAPI.history({ organizationId, limit: 10 }),
    enabled: !!organizationId,
  });

  const runMutation = useMutation({
    mutationFn: (payload: {
      scenarioName: string;
      horizonDays: number;
      overrides: Record<string, unknown>;
    }) =>
      simulationsAPI.run({
        organizationId,
        scenarioName: payload.scenarioName,
        horizonDays: payload.horizonDays,
        overrides: payload.overrides as any,
      }),
    onSuccess: (result) => {
      setLatestResult(result);
      toast.success("Simulation completed");
      queryClient.invalidateQueries({ queryKey: ["simulation-history"] });
    },
    onError: () => toast.error("Simulation failed"),
  });

  const handleRun = () => {
    let overrides: Record<string, unknown> = {};
    try {
      overrides = JSON.parse(overridesText) as Record<string, unknown>;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid overrides JSON"
      );
      return;
    }

    runMutation.mutate({
      scenarioName,
      horizonDays: Number(horizonDays || 30),
      overrides,
    });
  };

  const deltaRisk = useMemo(() => {
    if (!latestResult) return null;
    return latestResult.simulated.risk_score - latestResult.baseline.risk_score;
  }, [latestResult]);

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
        Select an organization to run simulations
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Activity className="h-3 w-3" />
              Simulation Engine
            </div>
            <h1 className="font-semibold text-2xl">
              Model the impact before reality does
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Run scenarios against the memory graph, quantify risk deltas, and
              commit to the safest next move.
            </p>
          </div>
          <Button onClick={handleRun} size="sm">
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run simulation
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Scenario Controls
            </CardTitle>
            <CardDescription>
              Tune horizon, overrides, and commitment changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Scenario name</Label>
                <Input
                  onChange={(event) => setScenarioName(event.target.value)}
                  value={scenarioName}
                />
              </div>
              <div className="space-y-2">
                <Label>Horizon (days)</Label>
                <Input
                  onChange={(event) => setHorizonDays(event.target.value)}
                  type="number"
                  value={horizonDays}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Overrides (JSON)</Label>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                onChange={(event) => setOverridesText(event.target.value)}
                value={overridesText}
              />
            </div>
            <Button onClick={handleRun} variant="outline">
              <Play className="mr-2 h-4 w-4" />
              Simulate
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Latest Outcome
            </CardTitle>
            <CardDescription>
              Compare baseline vs simulated risk posture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!latestResult ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                Run a simulation to populate results.
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      label: "Baseline risk",
                      value: latestResult.baseline.risk_score,
                    },
                    {
                      label: "Simulated risk",
                      value: latestResult.simulated.risk_score,
                    },
                  ].map((item) => (
                    <div
                      className="rounded-lg border bg-muted/40 p-3"
                      key={item.label}
                    >
                      <p className="text-muted-foreground text-xs uppercase">
                        {item.label}
                      </p>
                      <p className="font-semibold text-xl">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-muted-foreground text-xs uppercase">
                      Delta
                    </p>
                    <Badge
                      className={
                        (deltaRisk ?? 0) >= 0
                          ? "border-red-500/30 bg-red-500/10 text-red-600"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                      }
                      variant="outline"
                    >
                      {(deltaRisk ?? 0) >= 0 ? "+" : ""}
                      {deltaRisk?.toFixed(2)}
                    </Badge>
                  </div>
                  <Progress
                    className="mt-2"
                    value={
                      Math.min(
                        100,
                        Math.abs((deltaRisk ?? 0) * 100)
                      )
                    }
                  />
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <p className="font-medium">Narrative</p>
                  <p className="text-muted-foreground">
                    {latestResult.narrative}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-sm">Sensitivity</p>
                  <div className="space-y-2">
                    {latestResult.sensitivity.map((item) => (
                      <div
                        className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"
                        key={`${item.commitment_id}-${item.change_type}`}
                      >
                        <span>
                          {item.change_type} · {item.commitment_id}
                        </span>
                        <Badge variant="secondary">
                          Δ {item.delta_risk_score.toFixed(2)}
                        </Badge>
                      </div>
                    ))}
                    {latestResult.sensitivity.length === 0 && (
                      <p className="text-muted-foreground text-xs">
                        No sensitivity data for this run.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Simulation History
          </CardTitle>
          <CardDescription>
            Recent what-if runs and their stored outputs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (history ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              No simulations recorded yet.
            </div>
          ) : (
            (history ?? []).map((run: any) => (
              <div
                className="flex items-center justify-between rounded-lg border bg-muted/20 p-3"
                key={run.id}
              >
                <div>
                  <p className="font-medium text-sm">{run.scenario_name}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    try {
                      const payload =
                        typeof run.output_payload === "string"
                          ? (JSON.parse(run.output_payload) as SimulationResult)
                          : (run.output_payload as SimulationResult);
                      setLatestResult(payload);
                    } catch {
                      toast.error("Failed to parse simulation output");
                    }
                  }}
                  size="sm"
                  variant="ghost"
                >
                  View
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
