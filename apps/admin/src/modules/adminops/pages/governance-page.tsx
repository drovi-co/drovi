import { Badge } from "@memorystack/ui-core/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@memorystack/ui-core/table";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useT } from "@/i18n";
import {
  adminAPI,
  type GovernanceOverviewResponse,
  type GovernanceSignal,
  type KPIBlock,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type ApprovalStatusRow = {
  status: string;
  count: number;
};

function normalizeBlocks(
  data: GovernanceOverviewResponse | undefined
): KPIBlock[] {
  return data?.blocks ?? [];
}

function parseApprovalStatusRows(
  data: GovernanceOverviewResponse | undefined
): ApprovalStatusRow[] {
  if (!Array.isArray(data?.approvals_by_status)) return [];
  const rows: ApprovalStatusRow[] = [];
  for (const row of data.approvals_by_status) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const status = String(record.status ?? "").trim();
    const count = Number(record.count ?? 0);
    if (!(status && Number.isFinite(count))) {
      continue;
    }
    rows.push({ status, count });
  }
  return rows;
}

function normalizeSignals(
  data: GovernanceOverviewResponse | undefined
): GovernanceSignal[] {
  return data?.recent_signals ?? [];
}

function formatValue(block: KPIBlock): string {
  const value = Number(block.value ?? 0);
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function severityVariant(
  severity: string
): "default" | "secondary" | "destructive" | "outline" {
  if (severity === "critical") return "destructive";
  if (severity === "warning") return "default";
  if (severity === "info") return "secondary";
  return "outline";
}

function GovernanceKpiCard(props: { block: KPIBlock }) {
  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          {props.block.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="font-semibold text-3xl tabular-nums tracking-tight">
          {formatValue(props.block)}
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminGovernancePage() {
  const t = useT();
  const query = useQuery({
    queryKey: ["admin-governance-overview"],
    queryFn: () => adminAPI.getGovernanceOverview(),
    refetchInterval: 5000,
  });

  const blocks = useMemo(() => normalizeBlocks(query.data), [query.data]);
  const approvalRows = useMemo(
    () => parseApprovalStatusRows(query.data),
    [query.data]
  );
  const signals = useMemo(() => normalizeSignals(query.data), [query.data]);

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card className="border-border/70" key={idx}>
              <CardHeader>
                <Skeleton className="h-3 w-40" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (query.error) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-sm">
            {t("admin.governance.errors.failedToLoad")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {query.error instanceof Error
            ? query.error.message
            : t("common.messages.unknownError")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {blocks.map((block) => (
          <GovernanceKpiCard block={block} key={block.key} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("admin.governance.sections.approvalsByStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {approvalRows.length > 0 ? (
              <div className="rounded-md border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("admin.governance.table.status")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("admin.governance.table.count")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {approvalRows.map((row) => (
                      <TableRow key={row.status}>
                        <TableCell>
                          <Badge className="capitalize" variant="secondary">
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("admin.governance.sections.noApprovals")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">
              {t("admin.governance.sections.recentSignals")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {signals.length > 0 ? (
              signals.map((signal) => (
                <div
                  className="rounded-lg border border-border/70 px-3 py-2"
                  key={`${signal.label}-${signal.value}`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="font-medium text-xs">{signal.label}</div>
                    <Badge
                      className={cn(
                        "capitalize",
                        signal.severity === "warning" &&
                          "bg-amber-600 text-white hover:bg-amber-600"
                      )}
                      variant={severityVariant(signal.severity)}
                    >
                      {signal.severity}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {signal.value}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("admin.governance.sections.noSignals")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
