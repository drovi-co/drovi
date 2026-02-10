// =============================================================================
// REALITY STREAM
// =============================================================================
//
// Chronological stream of every change inside the memory graph.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format, subDays } from "date-fns";
import { Activity, Filter, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { type ChangeRecord, changesAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard/reality-stream/")({
  component: RealityStreamPage,
});

function RealityStreamPage() {
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const t = useT();
  const organizationId = activeOrg?.id ?? "";

  const [entityFilter, setEntityFilter] = useState("all");
  const [rangeDays, setRangeDays] = useState("7");

  const since = useMemo(() => {
    const days = Number(rangeDays);
    if (!Number.isFinite(days)) return undefined;
    return subDays(new Date(), days).toISOString();
  }, [rangeDays]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["reality-stream", organizationId, entityFilter, rangeDays],
    queryFn: () =>
      changesAPI.list({
        organizationId,
        since,
        entityTypes: entityFilter === "all" ? undefined : [entityFilter],
        limit: 200,
      }),
    enabled: !!organizationId,
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, ChangeRecord[]>();
    for (const change of data?.changes ?? []) {
      const day = format(new Date(change.timestamp), "yyyy-MM-dd");
      const list = groups.get(day) ?? [];
      list.push(change);
      groups.set(day, list);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

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
        {t("pages.dashboard.realityStream.selectOrg")}
      </div>
    );
  }

  const entityFilters = [
    {
      value: "all",
      label: t("pages.dashboard.realityStream.filters.entity.all"),
    },
    {
      value: "commitment",
      label: t("pages.dashboard.realityStream.filters.entity.commitment"),
    },
    {
      value: "decision",
      label: t("pages.dashboard.realityStream.filters.entity.decision"),
    },
    {
      value: "task",
      label: t("pages.dashboard.realityStream.filters.entity.task"),
    },
    {
      value: "risk",
      label: t("pages.dashboard.realityStream.filters.entity.risk"),
    },
    {
      value: "brief",
      label: t("pages.dashboard.realityStream.filters.entity.brief"),
    },
  ];

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <Activity className="h-3 w-3" />
              {t("pages.dashboard.realityStream.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("pages.dashboard.realityStream.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("pages.dashboard.realityStream.description")}
            </p>
          </div>
          <Button onClick={() => refetch()} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("pages.dashboard.realityStream.actions.refresh")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" />
            {t("pages.dashboard.realityStream.filters.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.realityStream.filters.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="font-medium text-sm">
              {t("pages.dashboard.realityStream.filters.entity.label")}
            </label>
            <Select onValueChange={setEntityFilter} value={entityFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entityFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="font-medium text-sm">
              {t("pages.dashboard.realityStream.filters.range.label")}
            </label>
            <Select onValueChange={setRangeDays} value={rangeDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">
                  {t("pages.dashboard.realityStream.filters.range.last24h")}
                </SelectItem>
                <SelectItem value="7">
                  {t("pages.dashboard.realityStream.filters.range.last7d")}
                </SelectItem>
                <SelectItem value="30">
                  {t("pages.dashboard.realityStream.filters.range.last30d")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("pages.dashboard.realityStream.timeline.title")}
          </CardTitle>
          <CardDescription>
            {t("pages.dashboard.realityStream.timeline.count", {
              count: data?.total_count ?? 0,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : isError ? (
            <ApiErrorPanel error={error} onRetry={() => refetch()} />
          ) : grouped.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
              {t("pages.dashboard.realityStream.timeline.empty")}
            </div>
          ) : (
            grouped.map(([day, changes]) => (
              <div className="space-y-3" key={day}>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {format(new Date(day), "MMM d, yyyy")}
                  </Badge>
                  <Separator className="flex-1" />
                </div>
                <div className="space-y-2">
                  {changes.map((change) => (
                    <ChangeRow
                      change={change}
                      key={change.entity_id + change.timestamp}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChangeRow({ change }: { change: ChangeRecord }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">
            {change.entity_type} · {change.change_type}
          </p>
          <p className="text-muted-foreground text-xs">
            {format(new Date(change.timestamp), "h:mm a")}
          </p>
        </div>
        <Badge variant="outline">v{change.version}</Badge>
      </div>
      {change.diff?.change_summary && (
        <p className="mt-2 text-muted-foreground text-sm">
          {change.diff.change_summary}
        </p>
      )}
      {change.diff?.changes?.length ? (
        <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
          {change.diff.changes.slice(0, 4).map((delta) => (
            <li key={delta.field_name}>
              {delta.field_name}: {String(delta.old_value ?? "—")} →{" "}
              {String(delta.new_value ?? "—")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
