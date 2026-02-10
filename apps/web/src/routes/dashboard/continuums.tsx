// =============================================================================
// CONTINUUM RUNTIME PAGE
// =============================================================================
//
// Mission-control view of Continuum definitions and live schedules.
// Orchestrates runs, previews, and version history.
//

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Rocket,
  Sparkles,
  Timer,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useT } from "@/i18n";
import {
  type ContinuumPreview,
  type ContinuumRun,
  type ContinuumSummary,
  continuumsAPI,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { formatRelativeTime } from "@/lib/intl-time";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/continuums")({
  component: ContinuumsPage,
});

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  draft: "border-slate-400/30 bg-slate-400/10 text-slate-600",
  completed: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  failed: "border-red-500/30 bg-red-500/10 text-red-600",
  escalated: "border-violet-500/30 bg-violet-500/10 text-violet-600",
  cancelled: "border-slate-400/30 bg-slate-400/10 text-slate-600",
};

function formatNextRun(
  nextRunAt: string | null,
  locale: string,
  onDemandLabel: string
) {
  if (!nextRunAt) return onDemandLabel;
  const date = new Date(nextRunAt);
  return formatRelativeTime(date, locale);
}

function formatTimestamp(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function ContinuumsPage() {
  const queryClient = useQueryClient();
  const t = useT();
  const { locale } = useI18n();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [selectedContinuum, setSelectedContinuum] =
    useState<ContinuumSummary | null>(null);
  const [previewState, setPreviewState] = useState<{
    continuum: ContinuumSummary;
    preview: ContinuumPreview;
  } | null>(null);

  const {
    data: continuums,
    isLoading,
    isError: continuumsError,
    error: continuumsErrorObj,
    refetch: refetchContinuums,
  } = useQuery({
    queryKey: ["continuums", organizationId],
    queryFn: () => continuumsAPI.list(organizationId),
    enabled: !!organizationId,
  });

  const runsQuery = useQuery({
    queryKey: ["continuum-runs", organizationId, selectedContinuum?.id],
    queryFn: () =>
      continuumsAPI.getRuns({
        continuumId: selectedContinuum?.id ?? "",
        organizationId,
      }),
    enabled: !!organizationId && !!selectedContinuum?.id,
  });

  const previewProofs =
    previewState?.preview.proof_requirements.map((proof) => ({
      type:
        typeof proof.type === "string"
          ? proof.type
          : t("pages.dashboard.continuums.preview.proofFallbackType"),
      criteria:
        typeof proof.criteria === "string"
          ? proof.criteria
          : t("pages.dashboard.continuums.preview.proofFallbackCriteria"),
    })) ?? [];

  const refreshContinuums = () => {
    queryClient.invalidateQueries({ queryKey: ["continuums"] });
  };

  const runMutation = useMutation({
    mutationFn: (continuum: ContinuumSummary) =>
      continuumsAPI.run({
        continuumId: continuum.id,
        organizationId,
        triggeredBy: "console",
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.continuums.toasts.runQueued"));
      refreshContinuums();
    },
    onError: () =>
      toast.error(t("pages.dashboard.continuums.toasts.runFailed")),
  });

  const pauseMutation = useMutation({
    mutationFn: (continuum: ContinuumSummary) =>
      continuumsAPI.pause({
        continuumId: continuum.id,
        organizationId,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.continuums.toasts.paused"));
      refreshContinuums();
    },
    onError: () =>
      toast.error(t("pages.dashboard.continuums.toasts.pauseFailed")),
  });

  const activateMutation = useMutation({
    mutationFn: (continuum: ContinuumSummary) =>
      continuumsAPI.activate({
        continuumId: continuum.id,
        organizationId,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.continuums.toasts.activated"));
      refreshContinuums();
    },
    onError: () =>
      toast.error(t("pages.dashboard.continuums.toasts.activateFailed")),
  });

  const rollbackMutation = useMutation({
    mutationFn: (continuum: ContinuumSummary) =>
      continuumsAPI.rollback({
        continuumId: continuum.id,
        organizationId,
        triggeredBy: "console",
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.continuums.toasts.rollbackQueued"));
      refreshContinuums();
    },
    onError: () =>
      toast.error(t("pages.dashboard.continuums.toasts.rollbackFailed")),
  });

  const previewMutation = useMutation({
    mutationFn: (continuum: ContinuumSummary) =>
      continuumsAPI.preview({
        continuumId: continuum.id,
        organizationId,
        horizonDays: 30,
      }),
    onSuccess: (preview, continuum) => {
      setPreviewState({ continuum, preview });
    },
    onError: () =>
      toast.error(t("pages.dashboard.continuums.toasts.previewFailed")),
  });

  const stats = useMemo(() => {
    const items = continuums ?? [];
    return {
      active: items.filter((c) => c.status === "active").length,
      paused: items.filter((c) => c.status === "paused").length,
      draft: items.filter((c) => c.status === "draft").length,
      escalated: items.filter((c) => c.status === "escalated").length,
    };
  }, [continuums]);

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("pages.dashboard.continuums.selectOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-no-shell-padding>
      <div className="relative overflow-hidden border-b bg-background">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_60%)]" />
        <div className="relative px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
                <Sparkles className="h-3 w-3" />
                {t("pages.dashboard.continuums.kicker")}
              </div>
              <h1 className="font-semibold text-2xl">
                {t("pages.dashboard.continuums.title")}
              </h1>
              <p className="max-w-2xl text-muted-foreground">
                {t("pages.dashboard.continuums.description")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => refreshContinuums()}
                size="sm"
                variant="outline"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("common.actions.refresh")}
              </Button>
              <Button asChild size="sm">
                <a href="/dashboard/builder">
                  <Rocket className="mr-2 h-4 w-4" />
                  {t("pages.dashboard.continuums.actions.create")}
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                key: "active",
                label: t("pages.dashboard.continuums.stats.active"),
                value: stats.active,
                tone: "active",
              },
              {
                key: "paused",
                label: t("pages.dashboard.continuums.stats.paused"),
                value: stats.paused,
                tone: "paused",
              },
              {
                key: "draft",
                label: t("pages.dashboard.continuums.stats.drafts"),
                value: stats.draft,
                tone: "draft",
              },
              {
                key: "escalated",
                label: t("pages.dashboard.continuums.stats.escalated"),
                value: stats.escalated,
                tone: "escalated",
              },
            ].map((stat) => (
              <Card key={stat.key}>
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-widest">
                      {stat.label}
                    </p>
                    <p className="font-semibold text-2xl">{stat.value}</p>
                  </div>
                  <Badge className={cn("border", STATUS_STYLES[stat.tone])}>
                    {stat.tone}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div className="grid flex-1 gap-6 overflow-hidden p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 overflow-auto pr-1">
          {isLoading ? (
            <div className="grid gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton className="h-32" key={i} />
              ))}
            </div>
          ) : continuumsError ? (
            <ApiErrorPanel
              error={continuumsErrorObj}
              onRetry={() => refetchContinuums()}
            />
          ) : (continuums ?? []).length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Timer className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">
                    {t("pages.dashboard.continuums.empty.title")}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t("pages.dashboard.continuums.empty.description")}
                  </p>
                </div>
                <Button asChild size="sm">
                  <a href="/dashboard/builder">
                    {t("pages.dashboard.continuums.empty.openBuilder")}
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {(continuums ?? []).map((continuum) => (
                <Card
                  className={cn(
                    "group border-l-4 transition-all",
                    continuum.status === "active"
                      ? "border-l-emerald-400"
                      : "border-l-muted"
                  )}
                  key={continuum.id}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <CardTitle className="flex items-center gap-2 text-lg">
                          {continuum.name}
                          <Badge
                            className={cn(
                              "border text-[11px]",
                              STATUS_STYLES[continuum.status] ||
                                "border-muted bg-muted text-muted-foreground"
                            )}
                            variant="outline"
                          >
                            {continuum.status}
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          {continuum.description ??
                            t("pages.dashboard.continuums.noDescription")}
                        </CardDescription>
                      </div>
                      <Button
                        onClick={() => setSelectedContinuum(continuum)}
                        size="icon"
                        variant="ghost"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-muted-foreground text-xs uppercase">
                          {t("pages.dashboard.continuums.fields.version")}
                        </p>
                        <p className="font-medium">
                          v
                          {continuum.activeVersion ??
                            continuum.currentVersion ??
                            1}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-muted-foreground text-xs uppercase">
                          {t("pages.dashboard.continuums.fields.nextRun")}
                        </p>
                        <p className="font-medium">
                          {formatNextRun(
                            continuum.nextRunAt,
                            locale,
                            t("common.labels.onDemand")
                          )}
                        </p>
                      </div>
                      <div className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-muted-foreground text-xs uppercase">
                          {t("pages.dashboard.continuums.fields.updated")}
                        </p>
                        <p className="font-medium">
                          {continuum.updatedAt
                            ? new Intl.DateTimeFormat(locale, {
                                month: "short",
                                day: "numeric",
                              }).format(new Date(continuum.updatedAt))
                            : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={runMutation.isPending}
                        onClick={() => runMutation.mutate(continuum)}
                        size="sm"
                      >
                        <Activity className="mr-2 h-4 w-4" />
                        {t("pages.dashboard.continuums.actions.runNow")}
                      </Button>
                      <Button
                        disabled={previewMutation.isPending}
                        onClick={() => previewMutation.mutate(continuum)}
                        size="sm"
                        variant="outline"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        {t("pages.dashboard.continuums.actions.preview")}
                      </Button>
                      {continuum.status === "active" ? (
                        <Button
                          disabled={pauseMutation.isPending}
                          onClick={() => pauseMutation.mutate(continuum)}
                          size="sm"
                          variant="ghost"
                        >
                          <PauseCircle className="mr-2 h-4 w-4" />
                          {t("pages.dashboard.continuums.actions.pause")}
                        </Button>
                      ) : (
                        <Button
                          disabled={activateMutation.isPending}
                          onClick={() => activateMutation.mutate(continuum)}
                          size="sm"
                          variant="ghost"
                        >
                          <PlayCircle className="mr-2 h-4 w-4" />
                          {t("pages.dashboard.continuums.actions.activate")}
                        </Button>
                      )}
                      <Button
                        disabled={rollbackMutation.isPending}
                        onClick={() => rollbackMutation.mutate(continuum)}
                        size="sm"
                        variant="ghost"
                      >
                        {t("pages.dashboard.continuums.actions.rollback")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-background/80 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-widest">
                {t("pages.dashboard.continuums.ledger.kicker")}
              </p>
              <p className="font-semibold text-lg">
                {selectedContinuum?.name ??
                  t("pages.dashboard.continuums.ledger.selectPrompt")}
              </p>
            </div>
            <Badge variant="outline">
              {t("pages.dashboard.continuums.ledger.runsCount", {
                count: runsQuery.data?.length ?? 0,
              })}
            </Badge>
          </div>
          <Separator className="my-4" />

          {selectedContinuum ? (
            runsQuery.isLoading ? (
              <Skeleton className="h-64" />
            ) : runsQuery.isError ? (
              <ApiErrorPanel
                error={runsQuery.error}
                onRetry={() => runsQuery.refetch()}
              />
            ) : (runsQuery.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.continuums.ledger.empty")}
              </div>
            ) : (
              <ScrollArea className="h-[420px] pr-2">
                <div className="space-y-3">
                  {(runsQuery.data ?? []).map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </div>
              </ScrollArea>
            )
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              {t("pages.dashboard.continuums.ledger.pickPrompt")}
            </div>
          )}
        </div>
      </div>

      <Dialog onOpenChange={() => setPreviewState(null)} open={!!previewState}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("pages.dashboard.continuums.preview.title")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.continuums.preview.description", {
                name:
                  previewState?.continuum.name ??
                  t("pages.dashboard.continuums.preview.unknownContinuum"),
                days: 30,
              })}
            </DialogDescription>
          </DialogHeader>
          {previewState ? (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {t(
                        "pages.dashboard.continuums.preview.expectedActions.title"
                      )}
                    </CardTitle>
                    <CardDescription>
                      {t(
                        "pages.dashboard.continuums.preview.expectedActions.description"
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {previewState.preview.expected_actions.map((action) => (
                        <li className="flex items-start gap-2" key={action}>
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                          <span>{action}</span>
                        </li>
                      ))}
                      {previewState.preview.expected_actions.length === 0 && (
                        <p className="text-muted-foreground">
                          {t(
                            "pages.dashboard.continuums.preview.expectedActions.empty"
                          )}
                        </p>
                      )}
                    </ul>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {t(
                        "pages.dashboard.continuums.preview.riskSnapshot.title"
                      )}
                    </CardTitle>
                    <CardDescription>
                      {t(
                        "pages.dashboard.continuums.preview.riskSnapshot.description"
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {[
                      {
                        label: t(
                          "pages.dashboard.continuums.preview.riskSnapshot.open"
                        ),
                        value:
                          previewState.preview.risk_snapshot.open_commitments,
                      },
                      {
                        label: t(
                          "pages.dashboard.continuums.preview.riskSnapshot.overdue"
                        ),
                        value:
                          previewState.preview.risk_snapshot
                            .overdue_commitments,
                      },
                      {
                        label: t(
                          "pages.dashboard.continuums.preview.riskSnapshot.atRisk"
                        ),
                        value:
                          previewState.preview.risk_snapshot
                            .at_risk_commitments,
                      },
                    ].map((item) => (
                      <div
                        className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2"
                        key={item.label}
                      >
                        <span className="text-muted-foreground text-sm">
                          {item.label}
                        </span>
                        <span className="font-semibold">{item.value}</span>
                      </div>
                    ))}
                    <div className="rounded-md border border-dashed px-3 py-2 text-sm">
                      <p className="text-muted-foreground">
                        {t(
                          "pages.dashboard.continuums.preview.riskSnapshot.outlook"
                        )}
                      </p>
                      <p className="font-medium">
                        {previewState.preview.risk_snapshot.risk_outlook}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {t("pages.dashboard.continuums.preview.proof.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("pages.dashboard.continuums.preview.proof.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {previewProofs.map((proof, index) => (
                    <div
                      className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"
                      key={`${proof.type}-${index}`}
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                      <div>
                        <p className="font-medium">{proof.type}</p>
                        <p className="text-muted-foreground">
                          {proof.criteria}
                        </p>
                      </div>
                    </div>
                  ))}
                  {previewProofs.length === 0 && (
                    <p className="text-muted-foreground text-sm">
                      {t("pages.dashboard.continuums.preview.proof.empty")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RunRow({ run }: { run: ContinuumRun }) {
  const t = useT();
  const { locale } = useI18n();
  const statusTone =
    STATUS_STYLES[run.status] ?? "border-muted bg-muted text-muted-foreground";

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-xs">
            {t("pages.dashboard.continuums.runRow.runId")}
          </p>
          <p className="font-mono text-xs">{run.id}</p>
        </div>
        <Badge
          className={cn("border text-[11px]", statusTone)}
          variant="outline"
        >
          {run.status}
        </Badge>
      </div>
      <Separator className="my-2" />
      <div className="grid gap-2 text-muted-foreground text-xs">
        <div className="flex items-center justify-between">
          <span>{t("pages.dashboard.continuums.runRow.version")}</span>
          <span className="font-medium text-foreground">v{run.version}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("pages.dashboard.continuums.runRow.started")}</span>
          <span>{formatTimestamp(run.startedAt, locale)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("pages.dashboard.continuums.runRow.completed")}</span>
          <span>{formatTimestamp(run.completedAt, locale)}</span>
        </div>
        {run.errorMessage && (
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1 text-red-600">
            {run.errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
