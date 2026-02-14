// =============================================================================
// SIMULATION ENGINE
// =============================================================================
//
// Run what-if scenarios against commitments and risk posture.
//

import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Label } from "@memorystack/ui-core/label";
import { Progress } from "@memorystack/ui-core/progress";
import { Separator } from "@memorystack/ui-core/separator";
import { Textarea } from "@memorystack/ui-core/textarea";
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
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { useI18n } from "@/i18n";
import {
  type SimulationOverridePayload,
  type SimulationResult,
  simulationsAPI,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/simulations/")({
  component: SimulationPage,
});

function parseSimulationOverridePayload(
  raw: unknown
): SimulationOverridePayload {
  if (raw == null) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Overrides must be a JSON object.");
  }

  const record = raw as Record<string, unknown>;
  const out: SimulationOverridePayload = {};

  if ("commitment_delays" in record && record.commitment_delays != null) {
    const delaysRaw = record.commitment_delays;
    if (typeof delaysRaw !== "object" || Array.isArray(delaysRaw)) {
      throw new Error("commitment_delays must be an object of { id: number }.");
    }
    const delaysRec: Record<string, number> = {};
    for (const [key, value] of Object.entries(
      delaysRaw as Record<string, unknown>
    )) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `commitment_delays['${key}'] must be a finite number of days.`
        );
      }
      delaysRec[key] = value;
    }
    out.commitment_delays = delaysRec;
  }

  if (
    "commitment_cancellations" in record &&
    record.commitment_cancellations != null
  ) {
    const cancelsRaw = record.commitment_cancellations;
    if (!Array.isArray(cancelsRaw)) {
      throw new Error("commitment_cancellations must be an array of ids.");
    }
    const cancels: string[] = [];
    for (const item of cancelsRaw) {
      if (typeof item !== "string") {
        throw new Error("commitment_cancellations must contain only strings.");
      }
      cancels.push(item);
    }
    out.commitment_cancellations = cancels;
  }

  return out;
}

function SimulationPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const { locale, t } = useI18n();
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

  const {
    data: history,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["simulation-history", organizationId],
    queryFn: () => simulationsAPI.history({ organizationId, limit: 10 }),
    enabled: !!organizationId,
  });

  const runMutation = useMutation({
    mutationFn: (payload: {
      scenarioName: string;
      horizonDays: number;
      overrides: SimulationOverridePayload;
    }) =>
      simulationsAPI.run({
        organizationId,
        scenarioName: payload.scenarioName,
        horizonDays: payload.horizonDays,
        overrides: payload.overrides,
      }),
    onSuccess: (result) => {
      setLatestResult(result);
      toast.success(t("pages.dashboard.simulations.toasts.completed"));
      queryClient.invalidateQueries({ queryKey: ["simulation-history"] });
    },
    onError: () => toast.error(t("pages.dashboard.simulations.toasts.failed")),
  });

  const handleRun = () => {
    let overrides: SimulationOverridePayload = {};
    try {
      overrides = parseSimulationOverridePayload(JSON.parse(overridesText));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("pages.dashboard.simulations.toasts.invalidOverrides")
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
        {t("pages.dashboard.simulations.noOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <Activity className="h-3 w-3" />
              {t("pages.dashboard.simulations.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("pages.dashboard.simulations.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("pages.dashboard.simulations.description")}
            </p>
          </div>
          <Button onClick={handleRun} size="sm">
            {runMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {t("pages.dashboard.simulations.actions.run")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("pages.dashboard.simulations.controls.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.simulations.controls.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>
                  {t("pages.dashboard.simulations.fields.scenarioName")}
                </Label>
                <Input
                  onChange={(event) => setScenarioName(event.target.value)}
                  value={scenarioName}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {t("pages.dashboard.simulations.fields.horizonDays")}
                </Label>
                <Input
                  onChange={(event) => setHorizonDays(event.target.value)}
                  type="number"
                  value={horizonDays}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("pages.dashboard.simulations.fields.overrides")}</Label>
              <Textarea
                className="min-h-[180px] font-mono text-xs"
                onChange={(event) => setOverridesText(event.target.value)}
                value={overridesText}
              />
            </div>
            <Button onClick={handleRun} variant="outline">
              <Play className="mr-2 h-4 w-4" />
              {t("pages.dashboard.simulations.actions.simulate")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              {t("pages.dashboard.simulations.latest.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.simulations.latest.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestResult ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      label: t(
                        "pages.dashboard.simulations.latest.baselineRisk"
                      ),
                      value: latestResult.baseline.risk_score,
                    },
                    {
                      label: t(
                        "pages.dashboard.simulations.latest.simulatedRisk"
                      ),
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
                      {t("pages.dashboard.simulations.latest.delta")}
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
                    value={Math.min(100, Math.abs((deltaRisk ?? 0) * 100))}
                  />
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <p className="font-medium">
                    {t("pages.dashboard.simulations.latest.narrative")}
                  </p>
                  <p className="text-muted-foreground">
                    {latestResult.narrative}
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-sm">
                    {t("pages.dashboard.simulations.latest.sensitivity")}
                  </p>
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
                        {t("pages.dashboard.simulations.latest.noSensitivity")}
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.simulations.latest.empty")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            {t("pages.dashboard.simulations.history.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.simulations.history.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <ApiErrorPanel error={error} onRetry={() => refetch()} />
          ) : (history ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              {t("pages.dashboard.simulations.history.empty")}
            </div>
          ) : (
            (Array.isArray(history) ? history : [])
              .filter((row): row is Record<string, unknown> =>
                Boolean(row && typeof row === "object" && !Array.isArray(row))
              )
              .map((run) => {
                const id = typeof run.id === "string" ? run.id : String(run.id);
                const scenarioName =
                  typeof run.scenario_name === "string"
                    ? run.scenario_name
                    : "Scenario";
                const createdAt =
                  typeof run.created_at === "string"
                    ? run.created_at
                    : new Date().toISOString();
                const outputPayload = run.output_payload;

                return (
                  <div
                    className="flex items-center justify-between rounded-lg border bg-muted/20 p-3"
                    key={id}
                  >
                    <div>
                      <p className="font-medium text-sm">{scenarioName}</p>
                      <p className="text-muted-foreground text-xs">
                        {new Date(createdAt).toLocaleString(locale)}
                      </p>
                    </div>
                    <Button
                      onClick={() => {
                        try {
                          const payload =
                            typeof outputPayload === "string"
                              ? (JSON.parse(outputPayload) as SimulationResult)
                              : (outputPayload as SimulationResult);
                          setLatestResult(payload);
                        } catch {
                          toast.error(
                            t("pages.dashboard.simulations.toasts.parseFailed")
                          );
                        }
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {t("pages.dashboard.simulations.history.view")}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                );
              })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
