// =============================================================================
// CONSOLE PAGE - Datadog-Like Intelligence Dashboard
// =============================================================================
//
// The Console is the primary intelligence view providing:
// - Smart search/filter bar with entity autocomplete
// - Dynamic metrics cards
// - Group by / Visualize as controls
// - Data table with inline expansion
// - Detail panel slide-in drawer
//

import { Button } from "@memorystack/ui-core/button";
import { Card, CardContent } from "@memorystack/ui-core/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@memorystack/ui-core/dropdown-menu";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Grid3X3,
  LayoutList,
  LineChart,
  List,
  PieChart,
  Sparkles,
  Terminal,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConsoleSearchBarRef } from "@/components/console";
import {
  ConsoleDataTable,
  ConsoleDetailPanel,
  ConsolePieChart,
  ConsoleSearchBar,
  TimeHistogram,
  TimeseriesChart,
  TopListChart,
} from "@/components/console";
import type { ConsoleItem } from "@/hooks/use-console-query";
import { useConsoleQuery } from "@/hooks/use-console-query";
import { useT } from "@/i18n";
import { authClient } from "@/lib/auth-client";
import type {
  ParsedFilter,
  ParsedQuery,
  TimeRange,
} from "@/lib/console-parser";
import { cn } from "@/lib/utils";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/console")({
  component: ConsolePage,
});

// =============================================================================
// VISUALIZATION OPTIONS
// =============================================================================

const GROUP_BY_OPTIONS = [
  { value: null, labelKey: "pages.dashboard.console.groupBy.none", icon: List },
  {
    value: "type",
    labelKey: "pages.dashboard.console.groupBy.type",
    icon: Grid3X3,
  },
  {
    value: "status",
    labelKey: "pages.dashboard.console.groupBy.status",
    icon: CheckCircle2,
  },
  {
    value: "priority",
    labelKey: "pages.dashboard.console.groupBy.priority",
    icon: AlertTriangle,
  },
  {
    value: "owner",
    labelKey: "pages.dashboard.console.groupBy.owner",
    icon: Sparkles,
  },
  {
    value: "source",
    labelKey: "pages.dashboard.console.groupBy.source",
    icon: Zap,
  },
  {
    value: "date",
    labelKey: "pages.dashboard.console.groupBy.date",
    icon: Calendar,
  },
];

const VISUALIZATION_OPTIONS = [
  {
    value: "list",
    labelKey: "pages.dashboard.console.viz.list",
    icon: LayoutList,
  },
  {
    value: "timeseries",
    labelKey: "pages.dashboard.console.viz.timeseries",
    icon: LineChart,
  },
  {
    value: "top_list",
    labelKey: "pages.dashboard.console.viz.topList",
    icon: BarChart3,
  },
  {
    value: "table",
    labelKey: "pages.dashboard.console.viz.table",
    icon: Grid3X3,
  },
  { value: "pie", labelKey: "pages.dashboard.console.viz.pie", icon: PieChart },
];

// =============================================================================
// METRICS CARD COMPONENT
// =============================================================================

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  trend?: number;
  variant?: "default" | "success" | "warning" | "danger";
  loading?: boolean;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  variant = "default",
  loading = false,
}: MetricCardProps) {
  // Vercel-style muted semantic colors
  const variantClasses = {
    default: "text-foreground",
    success: "text-[#059669] dark:text-[#6ee7b7]",
    warning: "text-[#d97706] dark:text-[#fbbf24]",
    danger: "text-[#dc2626] dark:text-[#f87171]",
  };

  if (loading) {
    return (
      <Card className="flex-1">
        <CardContent className="p-4">
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="h-8 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex-1 transition-colors hover:bg-accent/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">
            {label}
          </span>
          <Icon className={cn("size-4", variantClasses[variant])} />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={cn("font-bold text-2xl", variantClasses[variant])}>
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {trend !== undefined && (
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs",
                trend >= 0
                  ? "text-[#059669] dark:text-[#6ee7b7]"
                  : "text-[#dc2626] dark:text-[#f87171]"
              )}
            >
              <TrendingUp className={cn("size-3", trend < 0 && "rotate-180")} />
              {Math.abs(trend)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function ConsolePage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const groupByOptions = useMemo(
    () =>
      GROUP_BY_OPTIONS.map((o) => ({
        ...o,
        label: t(o.labelKey),
      })),
    [t]
  );
  const vizOptions = useMemo(
    () =>
      VISUALIZATION_OPTIONS.map((o) => ({
        ...o,
        label: t(o.labelKey),
      })),
    [t]
  );

  // Refs
  const searchBarRef = useRef<ConsoleSearchBarRef>(null);

  // Search state
  const [searchValue, setSearchValue] = useState("");
  const [parsedQuery, setParsedQuery] = useState<ParsedQuery>({
    filters: [],
    freeText: [],
    timeRange: null,
  });

  // Visualization state
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [visualization, setVisualization] = useState("list");

  // Detail panel state
  const [selectedItem, setSelectedItem] = useState<ConsoleItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Query data
  const { data, isLoading, error } = useConsoleQuery(
    organizationId,
    parsedQuery,
    {
      groupBy,
      visualization,
      limit: 50,
      enabled: Boolean(organizationId),
    }
  );

  // Debug logging
  useEffect(() => {
    if (data) {
      console.log("[Console Debug] API Response:", {
        itemCount: data.items?.length,
        timeseriesCount: data.timeseries?.length,
        timeseries: data.timeseries?.slice(0, 3),
        firstItem: data.items?.[0],
      });
    }
  }, [data]);

  // Handle search submission
  const handleSearch = useCallback((parsed: ParsedQuery) => {
    setParsedQuery(parsed);
  }, []);

  // Handle search value change (for real-time parsing)
  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  // Handle filter completion (when user selects a value from dropdown)
  const handleFilterComplete = useCallback((filter: ParsedFilter) => {
    setParsedQuery((prev) => ({
      ...prev,
      filters: [...prev.filters, filter],
    }));
    setSearchValue(""); // Clear input after filter is added
  }, []);

  // Handle time range completion
  const handleTimeComplete = useCallback((timeRange: TimeRange) => {
    setParsedQuery((prev) => ({
      ...prev,
      timeRange,
    }));
    setSearchValue("");
  }, []);

  // Handle filter removal
  const handleFilterRemove = useCallback((index: number) => {
    setParsedQuery((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== index),
    }));
  }, []);

  // Handle time range removal
  const handleTimeRemove = useCallback(() => {
    setParsedQuery((prev) => ({
      ...prev,
      timeRange: null,
    }));
  }, []);

  // Handle opening detail panel
  const handleOpenDetail = useCallback((item: ConsoleItem) => {
    setSelectedItem(item);
    setDetailOpen(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const items = data?.items ?? [];

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        // Allow Escape to blur input
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      switch (e.key) {
        case "/":
          // Focus search bar
          e.preventDefault();
          searchBarRef.current?.focus();
          break;

        case "j":
          // Move down
          e.preventDefault();
          setFocusedIndex((prev) => Math.min(prev + 1, items.length - 1));
          break;

        case "k":
          // Move up
          e.preventDefault();
          setFocusedIndex((prev) => Math.max(prev - 1, 0));
          break;

        case "Enter":
          // Open detail panel for focused item
          if (focusedIndex >= 0 && focusedIndex < items.length) {
            e.preventDefault();
            handleOpenDetail(items[focusedIndex]);
          }
          break;

        case "Escape":
          // Close detail panel
          if (detailOpen) {
            e.preventDefault();
            setDetailOpen(false);
          }
          break;

        case "g":
          // Go to first item
          e.preventDefault();
          setFocusedIndex(0);
          break;

        case "G":
          // Go to last item
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [data?.items, focusedIndex, detailOpen, handleOpenDetail]);

  // Loading state
  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  // No organization selected
  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="inline-flex rounded-full bg-muted p-4">
            <Terminal className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="font-semibold text-xl">
            {t("pages.dashboard.console.noOrg.title")}
          </h2>
          <p className="max-w-sm text-muted-foreground">
            {t("pages.dashboard.console.noOrg.description")}
          </p>
        </div>
      </div>
    );
  }

  const metrics = data?.metrics;

  const selectedGroupBy = groupByOptions.find((o) => o.value === groupBy);
  const selectedViz = vizOptions.find((o) => o.value === visualization);

  return (
    <div className="h-full" data-no-shell-padding>
      <div className="flex h-[calc(100vh-var(--header-height))] flex-col">
        {/* Search Bar */}
        <div className="relative z-20 border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <ConsoleSearchBar
            filters={parsedQuery.filters}
            onChange={handleSearchChange}
            onFilterComplete={handleFilterComplete}
            onFilterRemove={handleFilterRemove}
            onSearch={handleSearch}
            onTimeComplete={handleTimeComplete}
            onTimeRemove={handleTimeRemove}
            organizationId={organizationId}
            ref={searchBarRef}
            timeRange={parsedQuery.timeRange}
            value={searchValue}
          />
        </div>

        {/* Metrics Cards */}
        <div className="border-b bg-muted/30 px-6 py-3">
          <div className="flex gap-3">
            <MetricCard
              icon={LayoutList}
              label={t("pages.dashboard.console.metrics.total")}
              loading={isLoading}
              value={metrics?.total_count ?? 0}
            />
            <MetricCard
              icon={CheckCircle2}
              label={t("pages.dashboard.console.metrics.active")}
              loading={isLoading}
              value={metrics?.active_count ?? 0}
              variant="success"
            />
            <MetricCard
              icon={AlertTriangle}
              label={t("pages.dashboard.console.metrics.atRisk")}
              loading={isLoading}
              value={metrics?.at_risk_count ?? 0}
              variant="warning"
            />
            <MetricCard
              icon={Clock}
              label={t("pages.dashboard.console.metrics.overdue")}
              loading={isLoading}
              value={metrics?.overdue_count ?? 0}
              variant="danger"
            />
            <MetricCard
              icon={Sparkles}
              label={t("pages.dashboard.console.metrics.avgConfidence")}
              loading={isLoading}
              value={
                metrics?.avg_confidence !== undefined
                  ? `${Math.round(metrics.avg_confidence * 100)}%`
                  : "—"
              }
            />
          </div>
        </div>

        {/* Time Histogram - Always visible */}
        <div className="border-b bg-background px-6 py-4">
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <TimeHistogram
              barColor="#dc2626"
              data={data?.timeseries ?? []}
              height={80}
            />
          )}
        </div>

        {/* Controls Bar */}
        <div className="flex items-center justify-between border-b px-6 py-2">
          <div className="flex items-center gap-2">
            {/* Group By */}
            <span className="text-muted-foreground text-sm">
              {t("pages.dashboard.console.controls.groupBy")}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2" size="sm" variant="outline">
                  {selectedGroupBy && (
                    <selectedGroupBy.icon className="size-4" />
                  )}
                  {selectedGroupBy?.label ??
                    t("pages.dashboard.console.groupBy.none")}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {groupByOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value ?? "none"}
                    onClick={() => setGroupBy(option.value)}
                  >
                    <option.icon className="mr-2 size-4" />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Visualize As */}
            <span className="ml-4 text-muted-foreground text-sm">
              {t("pages.dashboard.console.controls.visualizeAs")}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-2" size="sm" variant="outline">
                  {selectedViz && <selectedViz.icon className="size-4" />}
                  {selectedViz?.label ?? t("pages.dashboard.console.viz.list")}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {vizOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setVisualization(option.value)}
                  >
                    <option.icon className="mr-2 size-4" />
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Result count */}
          <div className="text-muted-foreground text-sm">
            {isLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span>
                {t("pages.dashboard.console.results.count", {
                  shown: data?.items?.length ?? 0,
                  total: metrics?.total_count ?? 0,
                })}
              </span>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden">
          {error ? (
            <div className="flex h-full items-center justify-center">
              <div className="space-y-2 text-center">
                <AlertTriangle className="mx-auto size-8 text-destructive" />
                <p className="text-destructive">
                  {t("pages.dashboard.console.errors.failedToLoad")}
                </p>
                <p className="text-muted-foreground text-sm">
                  {error instanceof Error
                    ? error.message
                    : t("common.messages.unknownError")}
                </p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="space-y-2 px-6 py-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton className="h-16 w-full" key={i} />
              ))}
            </div>
          ) : data?.items?.length ? (
            <div className="h-full overflow-auto px-6 py-4">
              <div>
                {/* Render based on visualization type */}
                {visualization === "list" && (
                  <ConsoleDataTable
                    focusedIndex={focusedIndex}
                    items={data.items}
                    onOpenDetail={handleOpenDetail}
                    selectedId={selectedItem?.id}
                  />
                )}

                {visualization === "timeseries" && (
                  <TimeseriesChart data={data.timeseries ?? []} height={400} />
                )}

                {visualization === "top_list" &&
                  (groupBy && data.aggregations?.[groupBy] ? (
                    <TopListChart
                      colorScheme="rainbow"
                      data={data.aggregations[groupBy].map((item) => ({
                        name: item.key,
                        value: item.count,
                      }))}
                      maxItems={15}
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center rounded-lg border bg-muted/30">
                      <p className="text-muted-foreground text-sm">
                        {t("pages.dashboard.console.emptyChart")}
                      </p>
                    </div>
                  ))}

                {visualization === "table" && (
                  <ConsoleDataTable
                    focusedIndex={focusedIndex}
                    items={data.items}
                    onOpenDetail={handleOpenDetail}
                    selectedId={selectedItem?.id}
                  />
                )}

                {visualization === "pie" &&
                  (groupBy && data.aggregations?.[groupBy] ? (
                    <ConsolePieChart
                      data={data.aggregations[groupBy].map((item) => ({
                        name: item.key,
                        value: item.count,
                      }))}
                      height={400}
                    />
                  ) : (
                    <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted/30">
                      <p className="text-muted-foreground text-sm">
                        {t("pages.dashboard.console.emptyChart")}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="space-y-4 text-center">
                <div className="inline-flex rounded-full bg-muted p-4">
                  <Terminal className="size-8 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium">
                    {t("pages.dashboard.console.empty.title")}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {t("pages.dashboard.console.empty.description")}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <ConsoleDetailPanel
          item={selectedItem}
          onOpenChange={setDetailOpen}
          open={detailOpen}
          organizationId={organizationId}
        />
      </div>
    </div>
  );
}
