// =============================================================================
// PATTERN INTELLIGENCE
// =============================================================================
//
// Discover and promote recognition patterns from the memory graph.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Brain,
  Lightbulb,
  Loader2,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { type Pattern, PatternCard } from "@/components/patterns/pattern-card";
import { PatternDetail } from "@/components/patterns/pattern-detail";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { graphAPI, type PatternCandidate, patternsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/patterns/")({
  component: PatternsPage,
});

const PATTERN_QUERY = `
MATCH (p:Pattern {organizationId: $orgId})
RETURN p.id as id,
       p.name as name,
       p.description as description,
       p.domain as domain,
       p.salientFeatures as salient_features,
       p.typicalExpectations as typical_expectations,
       p.typicalAction as typical_action,
       p.plausibleGoals as plausible_goals,
       p.confidenceThreshold as confidence_threshold,
       p.confidenceBoost as confidence_boost,
       p.timesMatched as times_matched,
       p.timesConfirmed as times_confirmed,
       p.timesRejected as times_rejected,
       p.accuracyRate as accuracy_rate,
       p.isActive as is_active,
       p.createdAt as created_at,
       p.updatedAt as updated_at
ORDER BY p.updatedAt DESC
LIMIT 100
`;

function toPattern(
  raw: Record<string, unknown>,
  t: (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>
  ) => string
): Pattern {
  return {
    id: raw.id as string,
    name:
      (raw.name as string) ??
      t("pages.dashboard.patterns.fallback.untitledPattern"),
    description: (raw.description as string) ?? "",
    domain: (raw.domain as string) ?? "general",
    salientFeatures: (raw.salient_features as string[]) ?? [],
    typicalExpectations: (raw.typical_expectations as string[]) ?? [],
    typicalAction: (raw.typical_action as string) ?? "",
    plausibleGoals: (raw.plausible_goals as string[]) ?? [],
    confidenceThreshold: (raw.confidence_threshold as number) ?? 0.7,
    confidenceBoost: (raw.confidence_boost as number) ?? 0.1,
    timesMatched: (raw.times_matched as number) ?? 0,
    timesConfirmed: (raw.times_confirmed as number) ?? 0,
    timesRejected: (raw.times_rejected as number) ?? 0,
    accuracyRate: (raw.accuracy_rate as number) ?? 0,
    isActive: (raw.is_active as boolean) ?? true,
    createdAt: (raw.created_at as string) ?? new Date().toISOString(),
    updatedAt: (raw.updated_at as string) ?? new Date().toISOString(),
  };
}

function PatternsPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [promotionTarget, setPromotionTarget] =
    useState<PatternCandidate | null>(null);
  const [promotionName, setPromotionName] = useState("");
  const [promotionDescription, setPromotionDescription] = useState("");
  const [promotionDomain, setPromotionDomain] = useState("general");

  const {
    data: patternsData,
    isLoading: patternsLoading,
    isError: patternsError,
    error: patternsErrorObj,
    refetch,
  } = useQuery({
    queryKey: ["patterns", organizationId],
    queryFn: () => graphAPI.query({ organizationId, cypher: PATTERN_QUERY }),
    enabled: !!organizationId,
  });

  const {
    data: candidates,
    isLoading: candidatesLoading,
    isError: candidatesError,
    error: candidatesErrorObj,
    refetch: refetchCandidates,
  } = useQuery({
    queryKey: ["pattern-candidates", organizationId],
    queryFn: () => patternsAPI.listCandidates(organizationId),
    enabled: !!organizationId,
  });

  const discoverMutation = useMutation({
    mutationFn: () =>
      patternsAPI.discoverCandidates({
        organizationId,
        minClusterSize: 3,
        similarityThreshold: 0.85,
        maxNodes: 500,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.patterns.toasts.discoveryComplete"));
      refetchCandidates();
    },
    onError: () =>
      toast.error(t("pages.dashboard.patterns.toasts.discoveryFailed")),
  });

  const promoteMutation = useMutation({
    mutationFn: () =>
      patternsAPI.promoteCandidate({
        organizationId,
        candidateId: promotionTarget?.id ?? "",
        name: promotionName,
        description: promotionDescription,
        domain: promotionDomain,
      }),
    onSuccess: () => {
      toast.success(t("pages.dashboard.patterns.toasts.promoted"));
      setPromotionTarget(null);
      refetch();
      refetchCandidates();
    },
    onError: () =>
      toast.error(t("pages.dashboard.patterns.toasts.promoteFailed")),
  });

  const patterns = useMemo(() => {
    return (patternsData?.results ?? []).map((item) => toPattern(item, t));
  }, [patternsData, t]);

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
        {t("pages.dashboard.patterns.noOrg")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <Brain className="h-3 w-3" />
              {t("pages.dashboard.patterns.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("pages.dashboard.patterns.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("pages.dashboard.patterns.description")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => discoverMutation.mutate()}
              size="sm"
              variant="outline"
            >
              {discoverMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {t("pages.dashboard.patterns.actions.discover")}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              {t("pages.dashboard.patterns.active.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.patterns.active.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {patternsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : patternsError ? (
              <ApiErrorPanel
                error={patternsErrorObj}
                onRetry={() => refetch()}
              />
            ) : patterns.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.patterns.active.empty")}
              </div>
            ) : (
              <div className="grid gap-3">
                {patterns.map((pattern) => (
                  <PatternCard
                    key={pattern.id}
                    onSelect={() => setSelectedPattern(pattern)}
                    pattern={pattern}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              {t("pages.dashboard.patterns.candidates.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.dashboard.patterns.candidates.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidatesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : candidatesError ? (
              <ApiErrorPanel
                error={candidatesErrorObj}
                onRetry={() => refetchCandidates()}
              />
            ) : (candidates ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                {t("pages.dashboard.patterns.candidates.empty")}
              </div>
            ) : (
              (candidates ?? []).map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  key={candidate.id}
                  onPromote={() => {
                    setPromotionTarget(candidate);
                    setPromotionName(
                      candidate.sample_titles?.[0] ??
                        t("pages.dashboard.patterns.fallback.patternName")
                    );
                    setPromotionDescription(
                      candidate.top_terms?.join(", ") ??
                        t(
                          "pages.dashboard.patterns.fallback.autoPromotedDescription"
                        )
                    );
                    setPromotionDomain("general");
                  }}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet
        onOpenChange={(open) => !open && setSelectedPattern(null)}
        open={!!selectedPattern}
      >
        <SheetContent className="w-[520px] sm:max-w-[520px]">
          {selectedPattern && <PatternDetail pattern={selectedPattern} />}
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => !open && setPromotionTarget(null)}
        open={!!promotionTarget}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("pages.dashboard.patterns.dialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.patterns.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>{t("pages.dashboard.patterns.dialog.fields.name")}</Label>
              <Input
                onChange={(event) => setPromotionName(event.target.value)}
                value={promotionName}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t("pages.dashboard.patterns.dialog.fields.description")}
              </Label>
              <Textarea
                onChange={(event) =>
                  setPromotionDescription(event.target.value)
                }
                value={promotionDescription}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {t("pages.dashboard.patterns.dialog.fields.domain")}
              </Label>
              <Input
                onChange={(event) => setPromotionDomain(event.target.value)}
                value={promotionDomain}
              />
            </div>
            <Button
              disabled={promoteMutation.isPending}
              onClick={() => promoteMutation.mutate()}
            >
              {promoteMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {t("pages.dashboard.patterns.dialog.actions.promote")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidateCard({
  candidate,
  onPromote,
}: {
  candidate: PatternCandidate;
  onPromote: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">
            {candidate.sample_titles?.[0] ??
              t("pages.dashboard.patterns.fallback.cluster")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("pages.dashboard.patterns.candidates.members", {
              count: candidate.member_count,
            })}
          </p>
        </div>
        <Badge variant="secondary">+{candidate.confidence_boost}</Badge>
      </div>
      {candidate.top_terms?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidate.top_terms.slice(0, 4).map((term) => (
            <Badge key={term} variant="outline">
              {term}
            </Badge>
          ))}
        </div>
      )}
      <Button className="mt-3 w-full" onClick={onPromote} size="sm">
        {t("pages.dashboard.patterns.candidates.promote")}
      </Button>
    </div>
  );
}
