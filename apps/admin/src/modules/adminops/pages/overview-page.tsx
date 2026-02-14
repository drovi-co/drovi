import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n";
import { adminAPI, type KPIBlock } from "@/lib/api";
import { cn } from "@/lib/utils";

type ConnectionsByTypeRow = {
  connector_type: string;
  count: number;
};

function parseConnectionsByType(raw: unknown): ConnectionsByTypeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ConnectionsByTypeRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    const connector_type =
      typeof row.connector_type === "string"
        ? row.connector_type
        : row.connector_type
          ? String(row.connector_type)
          : "";
    const count =
      typeof row.count === "number"
        ? row.count
        : typeof row.count === "string"
          ? Number(row.count)
          : Number.NaN;
    if (!(connector_type && Number.isFinite(count))) {
      continue;
    }
    out.push({ connector_type, count });
  }
  return out;
}

function formatValue(block: KPIBlock): string {
  if (block.unit === "ratio") {
    const pct = Math.round((block.value ?? 0) * 1000) / 10;
    return `${pct.toFixed(1)}%`;
  }
  if (block.unit === "seconds") {
    const s = Math.max(0, Math.round(block.value ?? 0));
    if (s < 60) return `${s}s`;
    const m = Math.round((s / 60) * 10) / 10;
    return `${m}m`;
  }
  const v = block.value ?? 0;
  if (Number.isFinite(v) && Math.abs(v) >= 1_000_000)
    return `${(v / 1_000_000).toFixed(1)}M`;
  if (Number.isFinite(v) && Math.abs(v) >= 10_000)
    return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function BlockCard(props: { block: KPIBlock }) {
  const t = useT();
  const value = formatValue(props.block);
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1">
        <CardTitle className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          {props.block.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between gap-3">
          <div className="font-semibold text-3xl tabular-nums tracking-tight">
            {value}
          </div>
          {typeof props.block.delta_5m === "number" ? (
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] tabular-nums",
                props.block.delta_5m >= 0
                  ? "border-success/30 bg-success/5 text-success-foreground"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              )}
              title={t("admin.overview.deltaTitle")}
            >
              {props.block.delta_5m >= 0 ? "+" : ""}
              {props.block.delta_5m.toFixed(0)}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground">
              {t("admin.overview.live")}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminOverviewPage() {
  const t = useT();
  const q = useQuery({
    queryKey: ["admin-kpis"],
    queryFn: () => adminAPI.getKpis(),
    refetchInterval: 5000,
  });

  if (q.isPending) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, idx) => (
            <Card className="border-border/70" key={idx}>
              <CardHeader>
                <Skeleton className="h-3 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (q.error) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-sm">
            {t("admin.overview.errors.failedToLoadKpis")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {q.error instanceof Error
            ? q.error.message
            : t("common.messages.unknownError")}
        </CardContent>
      </Card>
    );
  }

  const blocks = q.data.blocks ?? [];
  const breakdowns = q.data.breakdowns ?? {};
  const connectionsByType = parseConnectionsByType(
    (breakdowns as Record<string, unknown>).connections_by_type
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {blocks.map((b) => (
          <BlockCard block={b} key={b.key} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("admin.overview.sections.connectionsByType")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connectionsByType.length ? (
              <div className="space-y-2">
                {connectionsByType.slice(0, 12).map((row) => (
                  <div
                    className="flex items-center justify-between gap-3 text-sm"
                    key={row.connector_type}
                  >
                    <div className="min-w-0 flex-1 truncate text-muted-foreground">
                      {row.connector_type}
                    </div>
                    <div className="tabular-nums">{row.count}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("admin.overview.sections.noConnections")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("admin.overview.sections.notesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-muted-foreground text-sm">
            <div>{t("admin.overview.notes.kpisRefresh")}</div>
            <div>{t("admin.overview.notes.opsControls")}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
