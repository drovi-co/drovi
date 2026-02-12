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
import { createFileRoute } from "@tanstack/react-router";
import { useT } from "@/i18n";
import { adminAPI } from "@/lib/api";

export const Route = createFileRoute("/dashboard/connectors")({
  component: AdminConnectorsPage,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function AdminConnectorsPage() {
  const t = useT();
  const q = useQuery({
    queryKey: ["admin-connectors"],
    queryFn: () => adminAPI.listConnectors(),
    refetchInterval: 15_000,
  });

  const connectors = (q.data?.connectors ?? []).filter(isRecord);

  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm">{t("admin.connectors.title")}</CardTitle>
        <div className="text-muted-foreground text-xs">
          {t("admin.connectors.description")}
        </div>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : q.error ? (
          <div className="text-muted-foreground text-sm">
            {q.error instanceof Error
              ? q.error.message
              : t("common.messages.unknownError")}
          </div>
        ) : connectors.length ? (
          <div className="rounded-md border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.connectors.table.type")}</TableHead>
                  <TableHead>{t("admin.connectors.table.status")}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t("admin.connectors.table.capabilities")}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t("admin.connectors.table.missingEnv")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((c) => {
                  const configured = Boolean(c.configured);
                  const missing = Array.isArray(c.missing_env)
                    ? c.missing_env.filter(
                        (v): v is string => typeof v === "string"
                      )
                    : [];
                  const caps = isRecord(c.capabilities) ? c.capabilities : {};
                  const capList = [
                    caps.supports_incremental === true ? "incremental" : null,
                    caps.supports_full_refresh === true ? "full_refresh" : null,
                    caps.supports_webhooks === true ? "webhooks" : null,
                    caps.supports_real_time === true ? "realtime" : null,
                  ].filter(Boolean) as string[];

                  return (
                    <TableRow
                      key={typeof c.type === "string" ? c.type : String(c.type)}
                    >
                      <TableCell className="font-medium">
                        {typeof c.type === "string" ? c.type : String(c.type)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={configured ? "secondary" : "destructive"}
                        >
                          {configured
                            ? t("admin.connectors.badges.configured")
                            : t("admin.connectors.badges.notConfigured")}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {capList.length ? (
                            capList.map((cap) => (
                              <Badge key={cap} variant="outline">
                                {cap}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-[11px] text-muted-foreground lg:table-cell">
                        {missing.length ? missing.join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">
            {t("admin.connectors.empty")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
