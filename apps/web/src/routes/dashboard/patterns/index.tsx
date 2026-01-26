// =============================================================================
// PATTERN MANAGEMENT PAGE
// =============================================================================
//
// Pattern recognition management using Klein's Recognition-Primed Decision model.
// Lists, filters, and manages organizational patterns for intelligence extraction.
//

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Brain,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  PatternCard,
  type Pattern,
} from "@/components/patterns/pattern-card";
import { PatternDetail } from "@/components/patterns/pattern-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/patterns/")({
  component: PatternsPage,
});

// =============================================================================
// TYPES
// =============================================================================

type ViewFilter = "all" | "active" | "inactive";
type DomainFilter = "all" | "sales" | "engineering" | "legal" | "hr" | "general";

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function PatternsPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // State
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(
    null
  );
  const [showDetailSheet, setShowDetailSheet] = useState(false);

  // Fetch patterns
  const {
    data: patternsData,
    isLoading: isLoadingPatterns,
    refetch,
  } = useQuery({
    ...trpc.intelligence.listPatterns.queryOptions({
      organizationId,
      domain: domainFilter === "all" ? undefined : domainFilter,
    }),
    enabled: !!organizationId,
  });

  // Toggle active mutation (simulated - would be implemented in backend)
  const toggleActiveMutation = useMutation({
    mutationFn: async ({
      patternId,
      active,
    }: {
      patternId: string;
      active: boolean;
    }) => {
      // This would call the actual API
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { patternId, active };
    },
    onSuccess: (data) => {
      toast.success(
        data.active ? "Pattern activated" : "Pattern deactivated"
      );
      refetch();
    },
    onError: () => {
      toast.error("Failed to update pattern");
    },
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

      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        document.getElementById("pattern-search")?.focus();
      }
      if (e.key === "r") refetch();
      if (e.key === "1") setViewFilter("all");
      if (e.key === "2") setViewFilter("active");
      if (e.key === "3") setViewFilter("inactive");
      if (e.key === "Escape") {
        setShowDetailSheet(false);
        setSelectedPatternId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refetch]);

  // Filter patterns based on view and search
  const filteredPatterns = useCallback((): Pattern[] => {
    const patterns = (patternsData?.patterns ?? []) as Pattern[];

    return patterns.filter((pattern) => {
      // View filter
      if (viewFilter === "active" && !pattern.isActive) return false;
      if (viewFilter === "inactive" && pattern.isActive) return false;

      // Search filter
      if (searchQuery.length > 0) {
        const query = searchQuery.toLowerCase();
        const matchesName = pattern.name.toLowerCase().includes(query);
        const matchesDescription = pattern.description
          .toLowerCase()
          .includes(query);
        const matchesDomain = pattern.domain.toLowerCase().includes(query);
        const matchesFeatures = pattern.salientFeatures.some((f) =>
          f.toLowerCase().includes(query)
        );
        if (!matchesName && !matchesDescription && !matchesDomain && !matchesFeatures) {
          return false;
        }
      }

      return true;
    });
  }, [patternsData, viewFilter, searchQuery]);

  // Handlers
  const handleToggleActive = useCallback(
    (patternId: string, active: boolean) => {
      toggleActiveMutation.mutate({ patternId, active });
    },
    [toggleActiveMutation]
  );

  const handleViewDetails = useCallback((patternId: string) => {
    setSelectedPatternId(patternId);
    setShowDetailSheet(true);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setShowDetailSheet(false);
    setSelectedPatternId(null);
  }, []);

  const patterns = filteredPatterns();
  const selectedPattern = patterns.find((p) => p.id === selectedPatternId);

  // Stats
  const stats = {
    total: (patternsData?.patterns ?? []).length,
    active: (patternsData?.patterns ?? []).filter(
      (p: Pattern) => p.isActive
    ).length,
    inactive: (patternsData?.patterns ?? []).filter(
      (p: Pattern) => !p.isActive
    ).length,
    avgAccuracy:
      (patternsData?.patterns ?? []).length > 0
        ? Math.round(
            ((patternsData?.patterns ?? []).reduce(
              (acc: number, p: Pattern) => acc + p.accuracyRate,
              0
            ) /
              (patternsData?.patterns ?? []).length) *
              100
          )
        : 0,
  };

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
          Select an organization to view patterns
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
            {/* View Filter Tabs */}
            <Tabs
              onValueChange={(v) => setViewFilter(v as ViewFilter)}
              value={viewFilter}
            >
              <TabsList className="h-8 gap-1 bg-transparent">
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="all"
                >
                  <Brain className="h-4 w-4" />
                  All
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.total}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="active"
                >
                  <Zap className="h-4 w-4" />
                  Active
                  <Badge
                    className="ml-1 px-1.5 py-0 text-[10px]"
                    variant="secondary"
                  >
                    {stats.active}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  className="gap-2 px-3 text-sm data-[state=active]:bg-accent"
                  value="inactive"
                >
                  Inactive
                  {stats.inactive > 0 && (
                    <Badge
                      className="ml-1 px-1.5 py-0 text-[10px]"
                      variant="secondary"
                    >
                      {stats.inactive}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Domain Filter */}
              <Select
                onValueChange={(v) => setDomainFilter(v as DomainFilter)}
                value={domainFilter}
              >
                <SelectTrigger className="h-8 w-[140px]">
                  <Filter className="mr-2 h-3.5 w-3.5" />
                  <SelectValue placeholder="Domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Domains</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="engineering">Engineering</SelectItem>
                  <SelectItem value="legal">Legal</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>

              {/* Search */}
              <div className="relative">
                <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 w-[200px] pl-8 text-sm"
                  id="pattern-search"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search patterns..."
                  value={searchQuery}
                />
              </div>

              <Button
                className="h-8 w-8"
                onClick={() => refetch()}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>

              <Button className="h-8 gap-2" size="sm">
                <Plus className="h-4 w-4" />
                New Pattern
              </Button>

              {/* Keyboard hints */}
              <div className="hidden items-center gap-2 text-muted-foreground text-xs lg:flex">
                <kbd className="rounded bg-muted px-1.5 py-0.5">/</kbd>
                <span>search</span>
                <kbd className="rounded bg-muted px-1.5 py-0.5">1-3</kbd>
                <span>tabs</span>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex items-center gap-6 border-t bg-muted/30 px-4 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Avg Accuracy:</span>
              <Badge
                className={
                  stats.avgAccuracy >= 80
                    ? "bg-green-500/10 text-green-600 border-green-500/30"
                    : stats.avgAccuracy >= 60
                      ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                      : "bg-red-500/10 text-red-600 border-red-500/30"
                }
                variant="outline"
              >
                {stats.avgAccuracy}%
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Total Patterns:</span>
              <span className="font-medium">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Active:</span>
              <span className="font-medium text-green-600">{stats.active}</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-4">
          {isLoadingPatterns ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div
                  className="h-48 animate-pulse rounded-xl bg-muted"
                  key={i}
                />
              ))}
            </div>
          ) : patterns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Brain className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">
                {searchQuery.length > 0
                  ? "No patterns match your search"
                  : viewFilter === "active"
                    ? "No active patterns"
                    : viewFilter === "inactive"
                      ? "No inactive patterns"
                      : "No patterns yet"}
              </h3>
              <p className="mt-1 text-muted-foreground text-sm">
                {searchQuery.length > 0
                  ? "Try adjusting your search query"
                  : "Patterns help recognize important situations in your communications"}
              </p>
              {searchQuery.length === 0 && viewFilter === "all" && (
                <Button className="mt-4" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Pattern
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {patterns.map((pattern) => (
                <PatternCard
                  isSelected={selectedPatternId === pattern.id}
                  key={pattern.id}
                  onDelete={() => toast.info("Delete functionality coming soon")}
                  onEdit={() => toast.info("Edit functionality coming soon")}
                  onSelect={() => handleViewDetails(pattern.id)}
                  onToggleActive={handleToggleActive}
                  onViewDetails={handleViewDetails}
                  pattern={pattern}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pattern Detail Sheet */}
      <Sheet onOpenChange={setShowDetailSheet} open={showDetailSheet}>
        <SheetContent className="w-[540px] p-0">
          {selectedPattern && (
            <PatternDetail
              matches={[]}
              onClose={handleCloseDetail}
              pattern={selectedPattern}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
