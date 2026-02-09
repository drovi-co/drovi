// =============================================================================
// TRUST & AUDIT
// =============================================================================
//
// Evidence-backed trust indicators and audit ledger verification.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo } from "react";

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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import {
  auditAPI,
  intelligenceAPI,
  trustAPI,
  type TrustIndicator,
  type UIO,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

export const Route = createFileRoute("/dashboard/trust")({
  component: TrustAuditPage,
});

const TRUST_TONE: Record<string, string> = {
  high: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  low: "border-red-500/30 bg-red-500/10 text-red-600",
};

type AuditStatus = {
  valid: boolean;
  total_entries: number;
  legacy_entries: number;
  head_ok: boolean;
  invalid_entries?: string[];
};

function TrustAuditPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const {
    data: uioSamples,
    isLoading: uioLoading,
    isError: uioError,
    error: uioErrorObj,
    refetch: refetchUios,
  } = useQuery({
    queryKey: ["trust-uio-samples", organizationId],
    queryFn: async () => {
      const [commitments, decisions] = await Promise.all([
        intelligenceAPI.listUIOs({ type: "commitment", limit: 6 }),
        intelligenceAPI.listUIOs({ type: "decision", limit: 4 }),
      ]);
      return [...commitments.items, ...decisions.items];
    },
    enabled: !!organizationId,
  });

  const uioIds = useMemo(
    () => (uioSamples ?? []).map((uio) => uio.id),
    [uioSamples]
  );

  const {
    data: trustIndicators,
    isLoading: trustLoading,
    isError: trustError,
    error: trustErrorObj,
    refetch: refetchTrust,
  } = useQuery({
    queryKey: ["trust-indicators", organizationId, uioIds.join(",")],
    queryFn: () =>
      trustAPI.getIndicators({
        organizationId,
        uioIds,
        evidenceLimit: 3,
      }),
    enabled: !!organizationId && uioIds.length > 0,
  });

  const {
    data: auditStatusRaw,
    isLoading: auditLoading,
    isError: auditError,
    error: auditErrorObj,
    refetch,
  } = useQuery({
    queryKey: ["audit-ledger", organizationId],
    queryFn: () => auditAPI.verifyLedger(organizationId),
    enabled: !!organizationId,
  });

  const auditStatus = auditStatusRaw as AuditStatus | undefined;
  const invalidEntries = Array.isArray(auditStatus?.invalid_entries)
    ? auditStatus?.invalid_entries
    : [];

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
        {t("pages.dashboard.trust.selectOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              {t("pages.dashboard.trust.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("pages.dashboard.trust.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("pages.dashboard.trust.description")}
            </p>
          </div>
          <Button onClick={() => refetch()} size="sm" variant="outline">
            <BadgeCheck className="mr-2 h-4 w-4" />
            {t("pages.dashboard.trust.actions.verifyLedger")}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("pages.dashboard.trust.indicators.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.trust.indicators.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {uioLoading || trustLoading ? (
              <Skeleton className="h-64" />
            ) : uioError ? (
              <ApiErrorPanel error={uioErrorObj} onRetry={() => refetchUios()} />
            ) : trustError ? (
              <ApiErrorPanel error={trustErrorObj} onRetry={() => refetchTrust()} />
            ) : (trustIndicators ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.trust.indicators.empty")}
              </div>
            ) : (
              (trustIndicators ?? []).map((indicator) => (
                <TrustCard
                  indicator={indicator}
                  key={indicator.uio_id}
                  uio={uioSamples?.find((uio) => uio.id === indicator.uio_id)}
                />
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              {t("pages.dashboard.trust.ledger.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.trust.ledger.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {auditLoading ? (
              <Skeleton className="h-40" />
            ) : auditError ? (
              <ApiErrorPanel error={auditErrorObj} onRetry={() => refetch()} />
            ) : auditStatus ? (
              <>
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-sm">{t("pages.dashboard.trust.ledger.statusLabel")}</span>
                  <Badge
                    className={
                      auditStatus.valid
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "border-red-500/30 bg-red-500/10 text-red-600"
                    }
                    variant="outline"
                  >
                    {auditStatus.valid
                      ? t("pages.dashboard.trust.ledger.status.valid")
                      : t("pages.dashboard.trust.ledger.status.needsReview")}
                  </Badge>
                </div>
                <div className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("pages.dashboard.trust.ledger.metrics.totalEntries")}</span>
                    <span className="font-medium">
                      {auditStatus?.total_entries ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("pages.dashboard.trust.ledger.metrics.legacyEntries")}</span>
                    <span className="font-medium">
                      {auditStatus?.legacy_entries ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("pages.dashboard.trust.ledger.metrics.headCheck")}</span>
                    <span className="font-medium">
                      {auditStatus?.head_ok
                        ? t("pages.dashboard.trust.ledger.metrics.aligned")
                        : t("pages.dashboard.trust.ledger.metrics.mismatch")}
                    </span>
                  </div>
                </div>
                {invalidEntries.length > 0 && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
                    {t("pages.dashboard.trust.ledger.invalidEntries", { count: invalidEntries.length })}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.trust.ledger.empty")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrustCard({
  indicator,
  uio,
}: {
  indicator: TrustIndicator;
  uio?: UIO;
}) {
  const t = useT();
  const confidenceTier = indicator.confidence >= 0.75
    ? "high"
    : indicator.confidence >= 0.5
      ? "medium"
      : "low";

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">
            {uio?.canonicalTitle ?? uio?.title ?? t("pages.dashboard.trust.card.untitled")}
          </p>
          <p className="text-muted-foreground text-xs">
            {uio?.type?.toUpperCase()} · {t("pages.dashboard.trust.card.evidenceCount", { count: indicator.evidence_count })}
          </p>
        </div>
        <Badge
          className={cn("border text-[11px]", TRUST_TONE[confidenceTier])}
          variant="outline"
        >
          {Math.round(indicator.confidence * 100)}%
        </Badge>
      </div>
      <Separator className="my-3" />
      <div className="space-y-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{t("pages.dashboard.trust.card.beliefState")}</span>
          <span className="font-medium text-foreground">
            {indicator.belief_state ?? t("common.messages.unknown")}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t("pages.dashboard.trust.card.truthState")}</span>
          <span className="font-medium text-foreground">
            {indicator.truth_state ?? t("pages.dashboard.trust.card.unverified")}
          </span>
        </div>
      </div>
      {indicator.confidence_reasoning?.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed px-3 py-2 text-xs">
          <p className="font-medium text-foreground">{t("pages.dashboard.trust.card.confidenceReasoning")}</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {indicator.confidence_reasoning.map((reason) => (
              <li key={reason}>• {reason}</li>
            ))}
          </ul>
        </div>
      )}
      {indicator.evidence?.length > 0 && (
        <div className="mt-3 rounded-md border bg-background px-3 py-2 text-xs">
          <p className="font-medium text-foreground">{t("pages.dashboard.trust.card.evidenceSnapshot")}</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {indicator.evidence.slice(0, 3).map((item, index) => (
              <li key={index}>
                {(item.quoted_text as string) ||
                  (item.summary as string) ||
                  t("pages.dashboard.trust.card.evidenceReference")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
