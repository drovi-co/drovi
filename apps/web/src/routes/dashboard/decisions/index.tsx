// =============================================================================
// DECISIONS LOG PAGE
// =============================================================================
//
// The institutional memory for decisions. This isn't a list - it's a searchable
// decision archive with supersession chains, rationale, and evidence. Answer
// "What did we decide about X?" in seconds.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format, startOfMonth, subMonths } from "date-fns";
import {
  Download,
  GitBranch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

import {
  DecisionDetailSheet,
  type DecisionDetailData,
  DecisionStats,
  type DecisionCardData,
} from "@/components/dashboards";
import {
  DecisionRow,
  DecisionListHeader,
  type DecisionRowData,
} from "@/components/decisions";
import { EvidenceDetailSheet, type EvidenceData } from "@/components/evidence";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

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
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [showSupersessionDialog, setShowSupersessionDialog] = useState(false);
  const [supersessionDecisionId, setSupersessionDecisionId] = useState<string | null>(null);
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false);
  const [evidenceDecisionId, setEvidenceDecisionId] = useState<string | null>(null);

  // Calculate date filters
  const getDateFilter = () => {
    const now = new Date();
    switch (timeFilter) {
      case "this_week":
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { decidedAfter: weekAgo };
      case "this_month":
        return { decidedAfter: startOfMonth(now) };
      case "last_3_months":
        return { decidedAfter: subMonths(now, 3) };
      default:
        return {};
    }
  };

  // Fetch stats
  const { data: statsData, isLoading: isLoadingStats } = useQuery({
    ...trpc.decisions.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Fetch decisions
  const { data: decisionsData, isLoading: isLoadingDecisions, refetch } = useQuery({
    ...trpc.decisions.list.queryOptions({
      organizationId,
      limit: 50,
      includeSuperseded,
      ...getDateFilter(),
    }),
    enabled: !!organizationId,
  });

  // Semantic search query
  const { data: searchResults, isLoading: isLoadingSearch } = useQuery({
    ...trpc.decisions.query.queryOptions({
      organizationId,
      query: searchQuery,
      limit: 20,
    }),
    enabled: !!organizationId && isSearching && searchQuery.length > 2,
  });

  // Fetch detailed decision for sheet
  const { data: detailData } = useQuery({
    ...trpc.decisions.get.queryOptions({
      organizationId,
      decisionId: selectedDecision ?? "",
    }),
    enabled: !!organizationId && !!selectedDecision && detailSheetOpen,
  });

  // Supersession chain query
  const { data: supersessionData, isLoading: isLoadingSupersession } = useQuery({
    ...trpc.decisions.getSupersessionChain.queryOptions({
      organizationId,
      decisionId: supersessionDecisionId ?? "",
    }),
    enabled: !!organizationId && !!supersessionDecisionId,
  });

  // Evidence detail query
  const { data: evidenceDecisionData } = useQuery({
    ...trpc.decisions.get.queryOptions({
      organizationId,
      decisionId: evidenceDecisionId ?? "",
    }),
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
        const decisions = decisionsData?.decisions ?? [];
        const currentIndex = decisions.findIndex((d) => d.id === selectedDecision);
        if (currentIndex < decisions.length - 1) {
          setSelectedDecision(decisions[currentIndex + 1]?.id ?? null);
        }
      }
      if (e.key === "k") {
        const decisions = decisionsData?.decisions ?? [];
        const currentIndex = decisions.findIndex((d) => d.id === selectedDecision);
        if (currentIndex > 0) {
          setSelectedDecision(decisions[currentIndex - 1]?.id ?? null);
        }
      }
      if (e.key === "Enter" && selectedDecision && !detailSheetOpen) {
        e.preventDefault();
        setDetailSheetOpen(true);
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("decision-search")?.focus();
      }
      if (e.key === "r") refetch();
      if (e.key === "Escape") {
        if (detailSheetOpen) {
          setDetailSheetOpen(false);
        } else {
          setIsSearching(false);
          setSearchQuery("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decisionsData, selectedDecision, detailSheetOpen, refetch]);

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
    (threadId: string) => {
      navigate({ to: "/dashboard/email/thread/$threadId", params: { threadId } });
    },
    [navigate]
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
    const decisions = decisionsData?.decisions ?? [];
    const markdown = decisions
      .map((d) => {
        return `## ${d.title}\n\n**Statement:** ${d.statement}\n\n**Date:** ${format(new Date(d.decidedAt), "MMMM d, yyyy")}\n\n${d.rationale ? `**Rationale:** ${d.rationale}\n\n` : ""}---\n`;
      })
      .join("\n");

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `decisions-export-${format(new Date(), "yyyy-MM-dd")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Decisions exported");
  }, [decisionsData]);

  // Transform data for DecisionRow
  const decisions: DecisionRowData[] = (decisionsData?.decisions ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    statement: d.statement,
    rationale: d.rationale,
    decidedAt: new Date(d.decidedAt),
    confidence: d.confidence,
    isUserVerified: d.isUserVerified ?? undefined,
    isSuperseded: !!d.supersededById,
    supersededBy: null, // Will be populated from detail view if needed
    owners: d.owners as DecisionRowData["owners"],
    topics: undefined, // Topics not included in list response
    sourceType: (d as { sourceType?: string }).sourceType as DecisionRowData["sourceType"],
  }));

  // Legacy format for detail sheet and search results
  const decisionsLegacy: DecisionCardData[] = (decisionsData?.decisions ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    statement: d.statement,
    rationale: d.rationale,
    decidedAt: new Date(d.decidedAt),
    confidence: d.confidence,
    isUserVerified: d.isUserVerified ?? undefined,
    isSuperseded: !!d.supersededById,
    evidence: d.metadata?.originalText ? [d.metadata.originalText] : undefined,
    owners: d.owners as DecisionCardData["owners"],
    sourceThread: d.sourceThread,
    alternatives: d.alternatives?.map((a) => ({
      option: a.title,
      reason: a.description ?? undefined,
    })),
  }));

  // Display search results or regular list
  const displayDecisions: DecisionRowData[] = isSearching && searchResults?.relevantDecisions
    ? searchResults.relevantDecisions.map((d) => {
        const full = decisions.find((fd) => fd.id === d.id);
        return full ?? {
          id: d.id,
          title: d.title,
          statement: d.statement,
          rationale: d.rationale ?? null,
          decidedAt: new Date(d.decidedAt),
          confidence: 0.8,
        } as DecisionRowData;
      })
    : decisions;

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

  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(displayDecisions.map((d) => d.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [displayDecisions]);

  const stats = statsData ?? {
    total: 0,
    thisWeek: 0,
    thisMonth: 0,
    superseded: 0,
    avgConfidence: 0,
    verifiedCount: 0,
    topTopics: [],
  };

  // Transform detail data for sheet
  const detailDecision: DecisionDetailData | null = detailData
    ? {
        id: detailData.id,
        title: detailData.title,
        statement: detailData.statement,
        rationale: detailData.rationale,
        decidedAt: new Date(detailData.decidedAt),
        confidence: detailData.confidence,
        isUserVerified: detailData.isUserVerified ?? undefined,
        isSuperseded: !!detailData.supersededById,
        evidence: detailData.metadata?.originalText ? [detailData.metadata.originalText] : undefined,
        owners: detailData.owners as DecisionDetailData["owners"],
        sourceThread: detailData.sourceThread,
        supersededBy: detailData.supersededBy
          ? {
              id: detailData.supersededBy.id,
              title: detailData.supersededBy.title,
              decidedAt: new Date(detailData.supersededBy.decidedAt),
            }
          : null,
        supersedes: detailData.supersedes
          ? {
              id: detailData.supersedes.id,
              title: detailData.supersedes.title,
              decidedAt: new Date(detailData.supersedes.decidedAt),
            }
          : null,
        alternatives: detailData.alternatives?.map((a) => ({
          option: a.title,
          reason: a.description ?? undefined,
        })),
        topics: detailData.topics,
        metadata: detailData.metadata,
      }
    : null;

  if (orgLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select an organization to view decisions</p>
      </div>
    );
  }

  return (
    <div data-no-shell-padding className="h-full">
      <div className="flex flex-col h-[calc(100vh-var(--header-height))]">
        {/* Header */}
        <div className="border-b bg-background">
        <div className="flex items-center justify-between px-4 py-2">
          {/* Time Filter Tabs */}
          <Tabs value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
            <TabsList className="h-8 bg-transparent gap-1">
              <TabsTrigger
                value="all"
                className="text-sm px-3 data-[state=active]:bg-accent"
              >
                All
              </TabsTrigger>
              <TabsTrigger
                value="this_week"
                className="text-sm px-3 data-[state=active]:bg-accent"
              >
                This Week
                {stats.thisWeek > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
                    {stats.thisWeek}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="this_month"
                className="text-sm px-3 data-[state=active]:bg-accent"
              >
                This Month
              </TabsTrigger>
              <TabsTrigger
                value="last_3_months"
                className="text-sm px-3 data-[state=active]:bg-accent"
              >
                Last 3 Months
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="decision-search"
                placeholder="Search decisions..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-8 w-[200px] pl-8 text-sm"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => {
                    setSearchQuery("");
                    setIsSearching(false);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Include Superseded Toggle */}
            <Button
              variant={includeSuperseded ? "secondary" : "ghost"}
              size="sm"
              className="h-8 text-sm"
              onClick={() => setIncludeSuperseded(!includeSuperseded)}
            >
              <GitBranch className="h-4 w-4 mr-1" />
              Superseded
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" />
            </Button>

            {/* Keyboard hints */}
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
              <kbd className="px-1.5 py-0.5 rounded bg-muted">/</kbd>
              <span>search</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted">j/k</kbd>
              <span>nav</span>
            </div>
          </div>
        </div>
      </div>

      {/* AI Summary (if searching) */}
      {isSearching && searchResults?.answer && (
        <div className="border-b px-4 py-3 bg-purple-50/50 dark:bg-purple-900/10">
          <p className="text-sm">
            <span className="font-medium text-purple-700 dark:text-purple-400">AI: </span>
            {searchResults.answer}
          </p>
        </div>
      )}

        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingDecisions || (isSearching && isLoadingSearch) ? (
            <div>
              {/* Row skeletons - matching inbox style */}
              {[...Array(15)].map((_, i) => (
                <div key={i} className="flex items-center h-10 px-3 border-b border-[#191A23]">
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
                  </div>
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="w-6 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4" />
                  </div>
                  <div className="w-7 shrink-0 flex items-center justify-center">
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <div className="w-[120px] shrink-0 px-1">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex-1 min-w-0 px-2">
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <div className="shrink-0 w-[140px] flex items-center justify-end gap-1.5">
                    <Skeleton className="h-3 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : displayDecisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
                <GitBranch className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">
                {isSearching ? "No decisions match your search" : "No decisions found"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Decisions are automatically extracted from your emails
              </p>
            </div>
          ) : (
            <div>
              {/* List header */}
              <DecisionListHeader
                onSelectAll={handleSelectAll}
                allSelected={selectedIds.size === displayDecisions.length && displayDecisions.length > 0}
                someSelected={selectedIds.size > 0 && selectedIds.size < displayDecisions.length}
              />
              {/* Decision rows */}
              {displayDecisions.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  isSelected={selectedIds.has(decision.id)}
                  isActive={selectedDecision === decision.id}
                  onSelect={handleSelectItem}
                  onClick={() => {
                    setSelectedDecision(decision.id);
                    setDetailSheetOpen(true);
                  }}
                  onShowEvidence={() => handleShowEvidence(decision.id)}
                  onViewSupersession={() => handleViewSupersession(decision.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Supersession Chain Dialog */}
      <Dialog open={showSupersessionDialog} onOpenChange={setShowSupersessionDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Decision Evolution
            </DialogTitle>
            <DialogDescription>
              See how this decision has evolved over time
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {isLoadingSupersession ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : supersessionData?.chain ? (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

                {/* Chain items */}
                <div className="space-y-4">
                  {supersessionData.chain.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "relative pl-10",
                        !item.isCurrent && "opacity-60"
                      )}
                    >
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-2 w-4 h-4 rounded-full border-2 bg-background",
                          item.isCurrent
                            ? "border-purple-500 bg-purple-100"
                            : "border-muted-foreground"
                        )}
                      />

                      <div className={cn(
                        "p-4 rounded-lg border",
                        item.isCurrent && "border-purple-200 bg-purple-50 dark:bg-purple-900/10"
                      )}>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className={cn(
                            "font-medium",
                            !item.isCurrent && "line-through"
                          )}>
                            {item.title}
                          </h4>
                          {item.isCurrent && (
                            <Badge variant="default" className="bg-purple-500">
                              Current
                            </Badge>
                          )}
                        </div>
                        <p className={cn(
                          "text-sm text-muted-foreground",
                          !item.isCurrent && "line-through"
                        )}>
                          {item.statement}
                        </p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {format(new Date(item.decidedAt), "MMMM d, yyyy")}
                          {item.supersededAt && (
                            <> • Superseded {format(new Date(item.supersededAt), "MMMM d, yyyy")}</>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground">No supersession chain found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Decision Detail Sheet */}
      <DecisionDetailSheet
        decision={detailDecision}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onThreadClick={handleThreadClick}
        onContactClick={handleContactClick}
        onViewSupersession={(decisionId) => {
          setSupersessionDecisionId(decisionId);
          setShowSupersessionDialog(true);
        }}
      />

      {/* Evidence Detail Sheet */}
      <EvidenceDetailSheet
        open={evidenceSheetOpen}
        onOpenChange={setEvidenceSheetOpen}
        evidence={
          evidenceDecisionData
            ? {
                id: evidenceDecisionData.id,
                type: "decision",
                title: evidenceDecisionData.title,
                extractedText: evidenceDecisionData.statement,
                confidence: evidenceDecisionData.confidence,
                isUserVerified: evidenceDecisionData.isUserVerified ?? false,
                quotedText: evidenceDecisionData.metadata?.originalText ?? null,
                extractedAt: new Date(evidenceDecisionData.decidedAt),
                modelVersion: "gpt-4o",
                confidenceFactors: [
                  { name: "Text Clarity", score: evidenceDecisionData.confidence, explanation: "How clear the extracted text is", weight: 0.4 },
                  { name: "Context Relevance", score: 0.8, explanation: "How relevant the context is", weight: 0.35 },
                  { name: "Historical Accuracy", score: 0.85, explanation: "Historical accuracy of extractions", weight: 0.25 },
                ],
              }
            : null
        }
        onThreadClick={handleThreadClick}
      />
    </div>
  );
}
