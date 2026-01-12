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
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  GitBranch,
  MessageSquare,
  RefreshCw,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  DecisionCard,
  DecisionStats,
  type DecisionCardData,
} from "@/components/dashboards";
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
  const [showSupersessionDialog, setShowSupersessionDialog] = useState(false);
  const [supersessionDecisionId, setSupersessionDecisionId] = useState<string | null>(null);
  const [includeSuperseded, setIncludeSuperseded] = useState(false);

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

  // Supersession chain query
  const { data: supersessionData, isLoading: isLoadingSupersession } = useQuery({
    ...trpc.decisions.getSupersessionChain.queryOptions({
      organizationId,
      decisionId: supersessionDecisionId ?? "",
    }),
    enabled: !!organizationId && !!supersessionDecisionId,
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
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("decision-search")?.focus();
      }
      if (e.key === "r") refetch();
      if (e.key === "Escape") {
        setIsSearching(false);
        setSearchQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [decisionsData, selectedDecision, refetch]);

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

  // Transform data
  const decisions: DecisionCardData[] = (decisionsData?.decisions ?? []).map((d) => ({
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
  const displayDecisions: DecisionCardData[] = isSearching && searchResults?.relevantDecisions
    ? searchResults.relevantDecisions.map((d: { id: string; title: string; statement: string; rationale?: string | null; decidedAt: Date }) => {
        const full = decisions.find((fd) => fd.id === d.id);
        return full ?? {
          id: d.id,
          title: d.title,
          statement: d.statement,
          rationale: d.rationale ?? null,
          decidedAt: new Date(d.decidedAt),
          confidence: 0.8,
        } as DecisionCardData;
      })
    : decisions;

  const stats = statsData ?? {
    total: 0,
    thisWeek: 0,
    thisMonth: 0,
    superseded: 0,
    avgConfidence: 0,
    verifiedCount: 0,
    topTopics: [],
  };

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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Decision Log</h1>
              <p className="text-sm text-muted-foreground">
                Your institutional memory - searchable decision archive
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>

          {/* Stats */}
          {isLoadingStats ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <DecisionStats stats={stats} />
          )}
        </div>
      </div>

      {/* Search Bar - Prominent "Ask My Decisions" */}
      <div className="border-b bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 px-4 py-4">
        <div className="container">
          <div className="relative max-w-2xl mx-auto">
            <MessageSquare className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-purple-500" />
            <Input
              id="decision-search"
              placeholder="Ask a question... e.g., 'What did we decide about pricing?'"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-12 pr-10 py-6 text-lg bg-white dark:bg-background border-purple-200 dark:border-purple-800 focus-visible:ring-purple-500"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => {
                  setSearchQuery("");
                  setIsSearching(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {isSearching && searchResults?.answer && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto mt-4 p-4 bg-white dark:bg-background rounded-lg border"
            >
              <p className="text-sm font-medium text-purple-700 dark:text-purple-400 mb-2">
                AI Summary:
              </p>
              <p className="text-sm text-foreground">{searchResults.answer}</p>
            </motion.div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b bg-muted/30 px-4 py-3">
        <div className="container flex items-center gap-4">
          {/* Time Filter */}
          <Tabs value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
            <TabsList>
              <TabsTrigger value="all">All Time</TabsTrigger>
              <TabsTrigger value="this_week">This Week</TabsTrigger>
              <TabsTrigger value="this_month">This Month</TabsTrigger>
              <TabsTrigger value="last_3_months">Last 3 Months</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Include Superseded Toggle */}
          <Button
            variant={includeSuperseded ? "secondary" : "outline"}
            size="sm"
            onClick={() => setIncludeSuperseded(!includeSuperseded)}
          >
            <GitBranch className="h-4 w-4 mr-2" />
            {includeSuperseded ? "Hiding" : "Show"} Superseded
          </Button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Keyboard hints */}
          <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 rounded bg-muted">/</kbd>
            <span>search</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">j/k</kbd>
            <span>navigate</span>
            <kbd className="px-1.5 py-0.5 rounded bg-muted">esc</kbd>
            <span>clear</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="container py-6">
            {isLoadingDecisions || (isSearching && isLoadingSearch) ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                <div className="space-y-3">
                  {displayDecisions.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center py-12"
                    >
                      <p className="text-muted-foreground">
                        {isSearching ? "No decisions match your search" : "No decisions found"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Decisions are automatically extracted from your emails
                      </p>
                    </motion.div>
                  ) : (
                    displayDecisions.map((decision) => (
                      <DecisionCard
                        key={decision.id}
                        decision={decision}
                        isSelected={selectedDecision === decision.id}
                        onSelect={() => setSelectedDecision(decision.id)}
                        onThreadClick={handleThreadClick}
                        onContactClick={handleContactClick}
                        onViewSupersession={handleViewSupersession}
                      />
                    ))
                  )}
                </div>
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>
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
                  {supersessionData.chain.map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
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
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center text-muted-foreground">No supersession chain found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
