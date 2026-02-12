import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@memorystack/ui-core/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { adminAPI } from "@/lib/api";

export const Route = createFileRoute("/dashboard/exchange")({
  component: AdminExchangePage,
});

type GovernanceStatusFilter = "" | "pending" | "approved" | "rejected";

type OrgOption = {
  id: string;
  name: string;
};

function toOrgOption(row: Record<string, unknown>): OrgOption | null {
  const id = typeof row.id === "string" ? row.id : row.id ? String(row.id) : "";
  if (!id) return null;
  const name =
    typeof row.name === "string" ? row.name : row.name ? String(row.name) : id;
  return { id, name };
}

type ExchangeBundleRow = {
  id: string;
  name: string;
  version: string | null;
  visibility: string | null;
  governance_status: string | null;
};

function toExchangeBundleRow(
  row: Record<string, unknown>
): ExchangeBundleRow | null {
  const id = typeof row.id === "string" ? row.id : row.id ? String(row.id) : "";
  if (!id) return null;
  const name =
    typeof row.name === "string" ? row.name : row.name ? String(row.name) : id;
  const version =
    typeof row.version === "string"
      ? row.version
      : row.version == null
        ? null
        : String(row.version);
  const visibility =
    typeof row.visibility === "string"
      ? row.visibility
      : row.visibility == null
        ? null
        : String(row.visibility);
  const governance_status =
    typeof row.governance_status === "string"
      ? row.governance_status
      : row.governance_status == null
        ? null
        : String(row.governance_status);
  return { id, name, version, visibility, governance_status };
}

function parseGovernanceStatusFilter(value: string): GovernanceStatusFilter {
  if (value === "approved") return "approved";
  if (value === "rejected") return "rejected";
  if (value === "pending") return "pending";
  return "";
}

function AdminExchangePage() {
  const qc = useQueryClient();
  const t = useT();
  const [orgId, setOrgId] = useState("");
  const [governance, setGovernance] =
    useState<GovernanceStatusFilter>("pending");

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs-for-exchange"],
    queryFn: () => adminAPI.listOrgs({ limit: 200 }),
  });

  const bundlesQuery = useQuery({
    queryKey: ["admin-exchange-bundles", orgId, governance],
    queryFn: () =>
      adminAPI.listExchangeBundles({
        organization_id: orgId.trim(),
        governance_status: governance || undefined,
      }),
    enabled: Boolean(orgId.trim()),
  });

  const orgOptions = useMemo(() => {
    return (orgsQuery.data?.organizations ?? [])
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object" && !Array.isArray(row))
      )
      .map(toOrgOption)
      .filter((row): row is OrgOption => Boolean(row))
      .slice(0, 200);
  }, [orgsQuery.data]);

  const bundles = useMemo(() => {
    return (Array.isArray(bundlesQuery.data) ? bundlesQuery.data : [])
      .filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === "object" && !Array.isArray(row))
      )
      .map(toExchangeBundleRow)
      .filter((row): row is ExchangeBundleRow => Boolean(row));
  }, [bundlesQuery.data]);

  const governanceMutation = useMutation({
    mutationFn: (params: {
      bundleId: string;
      status: "approved" | "rejected" | "pending";
    }) =>
      adminAPI.updateBundleGovernance({
        organization_id: orgId.trim(),
        bundle_id: params.bundleId,
        governance_status: params.status,
      }),
    onSuccess: async () => {
      toast.success(t("admin.exchange.toasts.updated"));
      await qc.invalidateQueries({ queryKey: ["admin-exchange-bundles"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t("admin.exchange.toasts.updateFailed")
      ),
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm">{t("admin.exchange.title")}</CardTitle>
          <div className="text-muted-foreground text-xs">
            {t("admin.exchange.description")}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                {t("admin.exchange.fields.organization")}
              </div>
              <Input
                list="org-options"
                onChange={(ev) => setOrgId(ev.target.value)}
                placeholder={t("admin.exchange.placeholders.organization")}
                value={orgId}
              />
              <datalist id="org-options">
                {orgOptions.map((o) => (
                  <option key={String(o.id)} value={String(o.id)}>
                    {String(o.name)}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                {t("admin.exchange.fields.governance")}
              </div>
              <Input
                onChange={(ev) =>
                  setGovernance(parseGovernanceStatusFilter(ev.target.value))
                }
                placeholder={t("admin.exchange.placeholders.governance")}
                value={governance}
              />
            </div>

            <div className="flex items-end justify-end">
              <Button
                disabled={!orgId.trim()}
                onClick={() => bundlesQuery.refetch().catch(() => undefined)}
                type="button"
                variant="secondary"
              >
                {t("common.actions.retry")}
              </Button>
            </div>
          </div>

          {orgId.trim() ? (
            bundlesQuery.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : bundlesQuery.error ? (
              <div className="text-muted-foreground text-sm">
                {bundlesQuery.error instanceof Error
                  ? bundlesQuery.error.message
                  : t("common.messages.unknownError")}
              </div>
            ) : bundles.length ? (
              <div className="rounded-md border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("admin.exchange.table.name")}</TableHead>
                      <TableHead>{t("admin.exchange.table.version")}</TableHead>
                      <TableHead>
                        {t("admin.exchange.table.visibility")}
                      </TableHead>
                      <TableHead>
                        {t("admin.exchange.table.governance")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("admin.exchange.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bundles.map((b) => (
                      <TableRow key={String(b.id)}>
                        <TableCell className="font-medium">
                          {String(b.name)}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground text-xs">
                          {String(b.version ?? "—")}
                        </TableCell>
                        <TableCell>
                          <Badge className="capitalize" variant="outline">
                            {String(b.visibility ?? "private")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="capitalize" variant="secondary">
                            {String(b.governance_status ?? "pending")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              disabled={governanceMutation.isPending}
                              onClick={() =>
                                governanceMutation.mutate({
                                  bundleId: String(b.id),
                                  status: "approved",
                                })
                              }
                              size="sm"
                            >
                              {t("admin.exchange.actions.approve")}
                            </Button>
                            <Button
                              disabled={governanceMutation.isPending}
                              onClick={() =>
                                governanceMutation.mutate({
                                  bundleId: String(b.id),
                                  status: "rejected",
                                })
                              }
                              size="sm"
                              variant="secondary"
                            >
                              {t("admin.exchange.actions.reject")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                {t("admin.exchange.empty")}
              </div>
            )
          ) : (
            <div className="text-muted-foreground text-sm">
              {t("admin.exchange.selectOrg")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
