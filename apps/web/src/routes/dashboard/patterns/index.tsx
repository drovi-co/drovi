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

import { PatternCard, type Pattern } from "@/components/patterns/pattern-card";
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
import { authClient } from "@/lib/auth-client";
import {
  graphAPI,
  patternsAPI,
  type PatternCandidate,
} from "@/lib/api";

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

function toPattern(raw: Record<string, unknown>): Pattern {
  return {
    id: raw.id as string,
    name: (raw.name as string) ?? "Untitled Pattern",
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
  const organizationId = activeOrg?.id ?? "";

  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null);
  const [promotionTarget, setPromotionTarget] =
    useState<PatternCandidate | null>(null);
  const [promotionName, setPromotionName] = useState("");
  const [promotionDescription, setPromotionDescription] = useState("");
  const [promotionDomain, setPromotionDomain] = useState("general");

  const { data: patternsData, isLoading: patternsLoading, refetch } = useQuery({
    queryKey: ["patterns", organizationId],
    queryFn: () => graphAPI.query({ organizationId, cypher: PATTERN_QUERY }),
    enabled: !!organizationId,
  });

  const {
    data: candidates,
    isLoading: candidatesLoading,
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
      toast.success("Pattern discovery complete");
      refetchCandidates();
    },
    onError: () => toast.error("Pattern discovery failed"),
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
      toast.success("Pattern promoted");
      setPromotionTarget(null);
      refetch();
      refetchCandidates();
    },
    onError: () => toast.error("Failed to promote pattern"),
  });

  const patterns = useMemo(() => {
    return (patternsData?.results ?? []).map((item) => toPattern(item));
  }, [patternsData]);

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
        Select an organization to manage patterns
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              <Brain className="h-3 w-3" />
              Pattern Intelligence
            </div>
            <h1 className="font-semibold text-2xl">
              Promote the patterns your organization repeats
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Cluster commitments, detect repeated playbooks, and teach Drovi to
              act faster with confidence boosts.
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
              Discover patterns
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Active Patterns
            </CardTitle>
            <CardDescription>
              Governed patterns already boosting intelligence extraction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {patternsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : patterns.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                No patterns promoted yet.
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
              Candidate Clusters
            </CardTitle>
            <CardDescription>
              Clusters discovered from the memory graph.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {candidatesLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (candidates ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
                No candidates yet. Run discovery to generate clusters.
              </div>
            ) : (
              (candidates ?? []).map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  key={candidate.id}
                  onPromote={() => {
                    setPromotionTarget(candidate);
                    setPromotionName(candidate.sample_titles?.[0] ?? "Pattern");
                    setPromotionDescription(
                      candidate.top_terms?.join(", ") ?? "Auto-promoted pattern"
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
          {selectedPattern && (
            <PatternDetail pattern={selectedPattern} />
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={(open) => !open && setPromotionTarget(null)}
        open={!!promotionTarget}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Promote Pattern</DialogTitle>
            <DialogDescription>
              Turn this candidate into a governed pattern with confidence boosts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                onChange={(event) => setPromotionName(event.target.value)}
                value={promotionName}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                onChange={(event) =>
                  setPromotionDescription(event.target.value)
                }
                value={promotionDescription}
              />
            </div>
            <div className="space-y-2">
              <Label>Domain</Label>
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
              Promote pattern
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
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-sm">
            {candidate.sample_titles?.[0] ?? "Cluster"}
          </p>
          <p className="text-muted-foreground text-xs">
            {candidate.member_count} members
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
        Promote
      </Button>
    </div>
  );
}
