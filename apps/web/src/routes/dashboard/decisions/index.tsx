// =============================================================================
// DECISIONS LOG PAGE
// =============================================================================
//
// The institutional memory for decisions. This isn't a list - it's a searchable
// decision archive with supersession chains, rationale, and evidence. Answer
// "What did we decide about X?" in seconds.
//

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { startOfMonth, subMonths } from "date-fns";
import { Download, GitBranch, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import {
  type DecisionCardData,
  type DecisionDetailData,
  DecisionDetailSheet,
} from "@/components/dashboards";
import {
  DecisionListHeader,
  DecisionRow,
  type DecisionRowData,
} from "@/components/decisions";
import { EvidenceDetailSheet } from "@/components/evidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDecisionStats, useDecisionUIOs, useUIO } from "@/hooks/use-uio";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/decisions/")({
  component: DecisionsPage,
});

// =============================================================================
// TYPES
// =============================================================================

type TimeFilter = "all" | "this_week" | "this_month" | "last_3_months";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function DecisionsPage() {
  const navigate = useNavigate();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const { locale, t } = useI18n();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [showSupersessionDialog, setShowSupersessionDialog] = useState(false);
  const [supersessionDecisionId, setSupersessionDecisionId] = useState<
    string | null
  >(null);
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false);
  const [evidenceDecisionId, setEvidenceDecisionId] = useState<string | null>(
    null
  );

  // Calculate date filters
  const getDateFilter = () => {
    const now = new Date();
    switch (timeFilter) {
      case "this_week": {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { decidedAfter: weekAgo };
      }
      case "this_month":
        return { decidedAfter: startOfMonth(now) };
      case "last_3_months":
        return { decidedAfter: subMonths(now, 3) };
      default:
        return {};
    }
  };

  // Fetch stats using UIO hook
  const { data: statsData, isLoading: isLoadingStats } = useDecisionStats({
    organizationId,
  });

  // Fetch decisions using UIO hook
  const {
    data: decisionsData,
    isLoading: isLoadingDecisions,
    isError: decisionsError,
    error: decisionsErrorObj,
    refetch,
  } = useDecisionUIOs({
    organizationId,
    limit: 50,
    enabled: !!organizationId,
  });

  // Semantic search - simplified to client-side filtering for now
  const searchResults =
    isSearching && searchQuery.length > 2
      ? {
          answer: null,
          relevantDecisions:
            decisionsData?.items?.filter(
              (d) =>
                d.canonicalTitle
                  ?.toLowerCase()
                  .includes(searchQuery.toLowerCase()) ||
                d.canonicalDescription
                  ?.toLowerCase()
                  .includes(searchQuery.toLowerCase())
            ) ?? [],
        }
      : null;
  const isLoadingSearch = false;

  // Fetch detailed decision for sheet using UIO hook
  const { data: detailData } = useUIO({
    organizationId,
    id: selectedDecision ?? "",
    enabled: !!organizationId && !!selectedDecision && detailSheetOpen,
  });

  // Supersession chain - simplified for now (not available in UIO)
  // Type the chain properly to avoid 'never' type errors
  const supersessionData = supersessionDecisionId
    ? {
        chain: [] as Array<{
          id: string;
          title: string;
          statement: string;
          decidedAt: string;
          isCurrent: boolean;
          supersededAt?: string | null;
        }>,
      }
    : null;
  const isLoadingSupersession = false;

  // Evidence detail query using UIO hook
  const { data: evidenceDecisionData } = useUIO({
    organizationId,
    id: evidenceDecisionId ?? "",
    enabled: !!organizationId && !!evidenceDecisionId && evidenceSheetOpen,
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // vim-style navigation
      if (e.key === "j") {
        const decisions = decisionsData?.items ?? [];
        const currentIndex = decisions.findIndex(
          (d) => d.id === selectedDecision
        );
        if (currentIndex < decisions.length - 1) {
          setSelectedDecision(decisions[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const decisions = decisionsData?.items ?? [];
        const currentIndex = decisions.findIndex(
          (d) => d.id === selectedDecision
        );
        if (currentIndex > 0) {
          setSelectedDecision(decisions[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "Enter" && selectedDecision) {
        e.preventDefault();
        navigate({
          to: "/dashboard/decisions/$decisionId",
          params: { decisionId: selectedDecision },
        });
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("decision-search")?.focus();
      }
      if (e.key === "r") {
        refetch();
      }
      if (e.key === "Escape") {
        setIsSearching(false);
        setSearchQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decisionsData, selectedDecision, refetch, navigate]);

  // Handlers
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.length > 2) {
      setIsSearching(true);
    } else {
      setIsSearching(false);
    }
  }, []);

  const handleThreadClick = useCallback(
    () => {
      toast.message(t("pages.dashboard.decisions.toasts.sourceViewerSoon"));
    },
    [t]
  );

  const handleContactClick = useCallback(
    (email: string) => {
      navigate({ to: "/dashboard/contacts", search: { email } });
    },
    [navigate]
  );

  const handleViewSupersession = useCallback((decisionId: string) => {
    setSupersessionDecisionId(decisionId);
    setShowSupersessionDialog(true);
  }, []);

  const handleShowEvidence = useCallback((decisionId: string) => {
    setEvidenceDecisionId(decisionId);
    setEvidenceSheetOpen(true);
  }, []);

  const handleExport = useCallback(() => {
    const uioDecisions = decisionsData?.items ?? [];
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const markdown = uioDecisions
      .map((d) => {
        const title = d.userCorrectedTitle ?? d.canonicalTitle ?? "";
        const statement =
          d.decisionDetails?.statement ?? d.canonicalDescription ?? "";
        const decidedAt = d.decisionDetails?.decidedAt ?? d.createdAt;
        const rationale = d.decisionDetails?.rationale ?? null;
        return `## ${title}\n\n**${t("pages.dashboard.decisions.export.statementLabel")}:** ${statement}\n\n**${t("pages.dashboard.decisions.export.dateLabel")}:** ${dateFormatter.format(new Date(decidedAt))}\n\n${rationale ? `**${t("pages.dashboard.decisions.export.rationaleLabel")}:** ${rationale}\n\n` : ""}---\n`;
      })
      .join("\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.download = t("pages.dashboard.decisions.export.filename", { date: dateStamp });
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("pages.dashboard.decisions.toasts.exported"));
  }, [decisionsData, locale, t]);

  // Transform UIO data for DecisionRow
  const decisions: DecisionRowData[] = (decisionsData?.items ?? []).map((d) => {
    const details = d.decisionDetails;
    // Get decision maker from UIO root level (where transformer places it)
    const decisionMaker = d.decisionMaker ?? d.owner;
    const evidenceQuotes = (d.sources ?? [])
      .map((source) => source.quotedText)
      .filter((value): value is string => Boolean(value));
    const sourceType = d.sources?.[0]?.sourceType ?? undefined;
    return {
      id: d.id,
      title: d.userCorrectedTitle ?? d.canonicalTitle ?? "",
      statement: details?.statement ?? d.canonicalDescription ?? "",
      rationale: details?.rationale ?? null,
      decidedAt: details?.decidedAt
        ? new Date(details.decidedAt)
        : new Date(d.createdAt),
      confidence: d.overallConfidence ?? 0.8,
      isUserVerified: d.isUserVerified ?? undefined,
      evidence: evidenceQuotes.length > 0 ? evidenceQuotes : undefined,
      extractedAt: new Date(d.createdAt),
      isSuperseded: !!details?.supersededByUioId,
      supersededBy: null,
      owners: decisionMaker
        ? [
            {
              id: decisionMaker.id,
              displayName: decisionMaker.displayName,
              primaryEmail: decisionMaker.primaryEmail,
            },
          ]
        : [],
      topics: undefined,
      sourceType: sourceType as DecisionRowData["sourceType"],
    };
  });

  // Legacy format for detail sheet and search results
  const decisionsLegacy: DecisionCardData[] = (decisionsData?.items ?? []).map(
    (d) => {
      const details = d.decisionDetails;
      const decisionMaker = d.decisionMaker ?? d.owner;
      const evidenceQuotes = (d.sources ?? [])
        .map((source) => source.quotedText)
        .filter((value): value is string => Boolean(value));
      return {
        id: d.id,
        title: d.userCorrectedTitle ?? d.canonicalTitle ?? "",
        statement: details?.statement ?? d.canonicalDescription ?? "",
        rationale: details?.rationale ?? null,
        decidedAt: details?.decidedAt
          ? new Date(details.decidedAt)
          : new Date(d.createdAt),
        confidence: d.overallConfidence ?? 0.8,
        isUserVerified: d.isUserVerified ?? undefined,
        isSuperseded: !!details?.supersededByUioId,
        evidence: evidenceQuotes.length > 0 ? evidenceQuotes : undefined,
        extractedAt: new Date(d.createdAt),
        owners: decisionMaker
          ? [
              {
                id: decisionMaker.id,
                displayName: decisionMaker.displayName,
                primaryEmail: decisionMaker.primaryEmail,
              },
            ]
          : [],
        sourceThread: undefined,
        alternatives: undefined,
      };
    }
  );

  const stats = {
    total: statsData?.data?.total ?? decisions.length,
  };

  const now = new Date();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthStart = startOfMonth(now);
  const threeMonthsAgo = subMonths(now, 3);

  const timeCounts = {
    thisWeek: decisions.filter((d) => d.decidedAt >= weekAgo).length,
    thisMonth: decisions.filter((d) => d.decidedAt >= monthStart).length,
    last3Months: decisions.filter((d) => d.decidedAt >= threeMonthsAgo).length,
  };

  const applyDecisionFilters = (list: DecisionRowData[]) => {
    const timeFiltered = list.filter((decision) => {
      if (timeFilter === "this_week") {
        return decision.decidedAt >= weekAgo;
      }
      if (timeFilter === "this_month") {
        return decision.decidedAt >= monthStart;
      }
      if (timeFilter === "last_3_months") {
        return decision.decidedAt >= threeMonthsAgo;
      }
      return true;
    });

    return includeSuperseded
      ? timeFiltered
      : timeFiltered.filter((decision) => !decision.isSuperseded);
  };

  // Display search results or regular list
  const filteredDecisions = applyDecisionFilters(decisions);

  const searchDecisionRows: DecisionRowData[] =
    isSearching && searchResults?.relevantDecisions
      ? searchResults.relevantDecisions.map((d) => {
          const full = decisions.find((fd) => fd.id === d.id);
          return (
            full ??
            ({
              id: d.id,
              title: d.userCorrectedTitle ?? d.canonicalTitle ?? "",
              statement:
                d.decisionDetails?.statement ?? d.canonicalDescription ?? "",
              rationale: d.decisionDetails?.rationale ?? null,
              decidedAt: d.decisionDetails?.decidedAt
                ? new Date(d.decisionDetails.decidedAt)
                : new Date(d.createdAt),
              confidence: d.overallConfidence ?? 0.8,
              isSuperseded: !!d.decisionDetails?.supersededByUioId,
              isUserVerified: d.isUserVerified ?? undefined,
              owners: d.decisionMaker
                ? [
                    {
                      id: d.decisionMaker.id,
                      displayName: d.decisionMaker.displayName,
                      primaryEmail: d.decisionMaker.primaryEmail,
                    },
                  ]
                : [],
            } as DecisionRowData)
          );
        })
      : [];

  const displayDecisions = isSearching
    ? applyDecisionFilters(searchDecisionRows)
    : filteredDecisions;

  // Selection handlers - must be defined after displayDecisions
  const handleSelectItem = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        setSelectedIds(new Set(displayDecisions.map((d) => d.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [displayDecisions]
  );

  // Transform UIO detail data for sheet
  const detailDecision: DecisionDetailData | null = detailData
    ? (() => {
        const details = detailData.decisionDetails;
        const decisionMaker = detailData.decisionMaker ?? detailData.owner;
        const evidenceQuotes = (detailData.sources ?? [])
          .map((source) => source.quotedText)
          .filter((value): value is string => Boolean(value));
        return {
          id: detailData.id,
          title:
            detailData.userCorrectedTitle ?? detailData.canonicalTitle ?? "",
          statement:
            details?.statement ?? detailData.canonicalDescription ?? "",
          rationale: details?.rationale ?? null,
          decidedAt: details?.decidedAt
            ? new Date(details.decidedAt)
            : new Date(detailData.createdAt),
          confidence: detailData.overallConfidence ?? 0.8,
          isUserVerified: detailData.isUserVerified ?? undefined,
          isSuperseded: !!details?.supersededByUioId,
          evidence: evidenceQuotes.length > 0 ? evidenceQuotes : undefined,
          owners: decisionMaker
            ? [
                {
                  id: decisionMaker.id,
                  displayName: decisionMaker.displayName,
                  primaryEmail: decisionMaker.primaryEmail,
                },
              ]
            : [],
          sourceThread: undefined,
          supersededBy: null,
          supersedes: null,
          alternatives: undefined,
          topics: undefined,
          metadata: null,
        };
      })()
    : null;

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">
          {t("pages.dashboard.decisions.noOrg")}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Header */}
        <div className="border-b bg-background">
          <div className="flex items-center justify-between px-4 py-2">
            {/* Time Filter Tabs */}
            <Tabs
              onValueChange={(v) => setTimeFilter(v as TimeFilter)}
              value={timeFilter}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="px-3 text-sm data-[state=active]:bg-accent"
                  value="all"
                >
                  {t("pages.dashboard.decisions.tabs.all")}
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.total}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="px-3 text-sm data-[state=active]:bg-accent"
                  value="this_week"
                >
                  {t("pages.dashboard.decisions.tabs.thisWeek")}
                  {timeCounts.thisWeek > 0 && (
                    <Badge
                      className="ml-1 px-1.5 py-0 text-[10px]"
                      variant="secondary"
                    >
                      {timeCounts.thisWeek}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  className="px-3 text-sm data-[state=active]:bg-accent"
                  value="this_month"
                >
                  {t("pages.dashboard.decisions.tabs.thisMonth")}
                </TabsTrigger>
                <TabsTrigger
                  className="px-3 text-sm data-[state=active]:bg-accent"
                  value="last_3_months"
                >
                  {t("pages.dashboard.decisions.tabs.last3Months")}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-[200px] pl-8 text-sm"
                  id="decision-search"
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder={t("pages.dashboard.decisions.search.placeholder")}
                  value={searchQuery}
                />
                {searchQuery && (
                  <Button
                    className="absolute top-1/2 right-0.5 h-7 w-7 -translate-y-1/2"
                    onClick={() => {
                      setSearchQuery("");
                      setIsSearching(false);
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {/* Include Superseded Toggle */}
              <Button
                className="h-8 text-sm"
                onClick={() => setIncludeSuperseded(!includeSuperseded)}
                size="sm"
                variant={includeSuperseded ? "secondary" : "ghost"}
              >
                <GitBranch className="mr-1 h-4 w-4" />
                {t("pages.dashboard.decisions.filters.superseded")}
              </Button>

              <Button
                className="h-8 w-8"
                onClick={() => refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              <Button
                className="h-8 w-8"
                onClick={handleExport}
                size="icon"
                variant="ghost"
              >
                <Download className="h-4 w-4" />
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">/</kbd>
                <span>{t("pages.dashboard.decisions.keyboard.search")}</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">j/k</kbd>
                <span>{t("pages.dashboard.decisions.keyboard.nav")}</span>
              </div>
            </div>
          </div>
        </div>

        {/* AI Summary (if searching) */}
        {isSearching && searchResults?.answer && (
          <div className="border-b bg-purple-50/50 px-4 py-3 dark:bg-purple-900/10">
            <p className="text-sm">
              <span className="font-medium text-purple-700 dark:text-purple-400">
                AI:{" "}
              </span>
              {searchResults.answer}
            </p>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingDecisions || (isSearching && isLoadingSearch) ? (
            <div>
              {/* Row skeletons - matching inbox style */}
              {[...new Array(15)].map((_, i) => (
                <div
                  className="flex h-10 items-center border-border border-b px-3"
                  key={i}
                >
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
                  </div>
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="flex w-6 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <div className="w-[120px] shrink-0 px-1">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="min-w-0 flex-1 px-2">
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <div className="flex w-[140px] shrink-0 items-center justify-end gap-1.5">
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : decisionsError ? (
            <div className="p-4">
              <ApiErrorPanel error={decisionsErrorObj} onRetry={() => refetch()} />
            </div>
          ) : displayDecisions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <GitBranch className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">
                {isSearching
                  ? t("pages.dashboard.decisions.empty.searchTitle")
                  : t("pages.dashboard.decisions.empty.title")}
              </h3>
              <p className="mt-1 text-muted-foreground text-sm">
                {t("pages.dashboard.decisions.empty.description")}
              </p>
            </div>
          ) : (
            <div>
              {/* List header */}
              <DecisionListHeader
                allSelected={
                  selectedIds.size === displayDecisions.length &&
                  displayDecisions.length > 0
                }
                onSelectAll={handleSelectAll}
                someSelected={
                  selectedIds.size > 0 &&
                  selectedIds.size < displayDecisions.length
                }
              />
              {/* Decision rows */}
              {displayDecisions.map((decision) => (
                <DecisionRow
                  decision={decision}
                  isActive={selectedDecision === decision.id}
                  isSelected={selectedIds.has(decision.id)}
                  key={decision.id}
                  onClick={() => {
                    navigate({
                      to: "/dashboard/decisions/$decisionId",
                      params: { decisionId: decision.id },
                    });
                  }}
                  onSelect={handleSelectItem}
                  onShowEvidence={() => handleShowEvidence(decision.id)}
                  onViewSupersession={() => handleViewSupersession(decision.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Supersession Chain Dialog */}
      <Dialog
        onOpenChange={setShowSupersessionDialog}
        open={showSupersessionDialog}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              {t("pages.dashboard.decisions.history.dialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.dashboard.decisions.history.dialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingSupersession ? (
              <div className="space-y-4">
                {[...new Array(3)].map((_, i) => (
                  <Skeleton className="h-20" key={i} />
                ))}
              </div>
            ) : supersessionData?.chain ? (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute top-0 bottom-0 left-4 w-0.5 bg-border" />

                {/* Chain items */}
                <div className="space-y-4">
                  {supersessionData.chain.map((item) => (
                    <div
                      className={cn(
                        "relative pl-10",
                        !item.isCurrent && "opacity-60"
                      )}
                      key={item.id}
                    >
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-2 h-4 w-4 rounded-full border-2 bg-background",
                          item.isCurrent
                            ? "border-purple-500 bg-purple-100"
                            : "border-muted-foreground"
                        )}
                      />

                      <div
                        className={cn(
                          "rounded-lg border p-4",
                          item.isCurrent &&
                            "border-purple-200 bg-purple-50 dark:bg-purple-900/10"
                        )}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <h4
                            className={cn(
                              "font-medium",
                              !item.isCurrent && "line-through"
                            )}
                          >
                            {item.title}
                          </h4>
                          {item.isCurrent && (
                            <Badge className="bg-purple-500" variant="default">
                              {t("pages.dashboard.decisions.history.current")}
                            </Badge>
                          )}
                        </div>
                        <p
                          className={cn(
                            "text-muted-foreground text-sm",
                            !item.isCurrent && "line-through"
                          )}
                        >
                          {item.statement}
                        </p>
                        <p className="mt-2 text-muted-foreground text-xs">
                          {new Intl.DateTimeFormat(locale, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          }).format(new Date(item.decidedAt))}
                          {item.supersededAt && (
                            <>
                              {" "}
                              • {t("pages.dashboard.decisions.history.superseded")}{" "}
                              {new Intl.DateTimeFormat(locale, {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              }).format(new Date(item.supersededAt))}
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground">
                {t("pages.dashboard.decisions.history.empty")}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Decision Detail Sheet */}
      <DecisionDetailSheet
        decision={detailDecision}
        onContactClick={handleContactClick}
        onOpenChange={setDetailSheetOpen}
        onThreadClick={handleThreadClick}
        onViewSupersession={(decisionId) => {
          setSupersessionDecisionId(decisionId);
          setShowSupersessionDialog(true);
        }}
        open={detailSheetOpen}
      />

      {/* Evidence Detail Sheet */}
      <EvidenceDetailSheet
        evidence={
          evidenceDecisionData
            ? {
                id: evidenceDecisionData.id,
                type: "decision",
                title:
                  evidenceDecisionData.userCorrectedTitle ??
                  evidenceDecisionData.canonicalTitle ??
                  "",
                extractedText:
                  evidenceDecisionData.decisionDetails?.statement ??
                  evidenceDecisionData.canonicalDescription ??
                  "",
                confidence: evidenceDecisionData.overallConfidence ?? 0.8,
                isUserVerified: evidenceDecisionData.isUserVerified ?? false,
                quotedText:
                  evidenceDecisionData.sources?.[0]?.quotedText ?? null,
                extractedAt: evidenceDecisionData.decisionDetails?.decidedAt
                  ? new Date(evidenceDecisionData.decisionDetails.decidedAt)
                  : new Date(evidenceDecisionData.createdAt),
                modelVersion: "llama-4-maverick",
                confidenceFactors: [
                  {
                    name: "Text Clarity",
                    score: evidenceDecisionData.overallConfidence ?? 0.8,
                    explanation: "How clear the extracted text is",
                    weight: 0.4,
                  },
                  {
                    name: "Context Relevance",
                    score: 0.8,
                    explanation: "How relevant the context is",
                    weight: 0.35,
                  },
                  {
                    name: "Historical Accuracy",
                    score: 0.85,
                    explanation: "Historical accuracy of extractions",
                    weight: 0.25,
                  },
                ],
              }
            : null
        }
        onOpenChange={setEvidenceSheetOpen}
        onThreadClick={handleThreadClick}
        open={evidenceSheetOpen}
      />
    </div>
  );
}
