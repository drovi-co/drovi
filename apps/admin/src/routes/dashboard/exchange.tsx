import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { adminAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/exchange")({
  component: AdminExchangePage,
});

function AdminExchangePage() {
  const qc = useQueryClient();
  const t = useT();
  const [orgId, setOrgId] = useState("");
  const [governance, setGovernance] = useState<"pending" | "approved" | "rejected" | "">("pending");

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
    const orgs = (orgsQuery.data?.organizations ?? []) as Array<any>;
    return orgs.slice(0, 200);
  }, [orgsQuery.data]);

  const bundles = useMemo(() => {
    const rows = bundlesQuery.data ?? [];
    return rows as Array<any>;
  }, [bundlesQuery.data]);

  const governanceMutation = useMutation({
    mutationFn: (params: { bundleId: string; status: "approved" | "rejected" | "pending" }) =>
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
      toast.error(e instanceof Error ? e.message : t("admin.exchange.toasts.updateFailed")),
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
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                {t("admin.exchange.fields.organization")}
              </div>
              <Input
                list="org-options"
                placeholder={t("admin.exchange.placeholders.organization")}
                value={orgId}
                onChange={(ev) => setOrgId(ev.target.value)}
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
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                {t("admin.exchange.fields.governance")}
              </div>
              <Input
                placeholder={t("admin.exchange.placeholders.governance")}
                value={governance}
                onChange={(ev) => setGovernance(ev.target.value as any)}
              />
            </div>

            <div className="flex items-end justify-end">
              <Button
                disabled={!orgId.trim()}
                onClick={() => void bundlesQuery.refetch()}
                type="button"
                variant="secondary"
              >
                {t("common.actions.retry")}
              </Button>
            </div>
          </div>

          {!orgId.trim() ? (
            <div className="text-sm text-muted-foreground">
              {t("admin.exchange.selectOrg")}
            </div>
          ) : bundlesQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : bundlesQuery.error ? (
            <div className="text-sm text-muted-foreground">
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
                    <TableHead>{t("admin.exchange.table.visibility")}</TableHead>
                    <TableHead>{t("admin.exchange.table.governance")}</TableHead>
                    <TableHead className="text-right">{t("admin.exchange.table.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bundles.map((b) => (
                    <TableRow key={String(b.id)}>
                      <TableCell className="font-medium">{String(b.name)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {String(b.version ?? "—")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {String(b.visibility ?? "private")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
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
            <div className="text-sm text-muted-foreground">{t("admin.exchange.empty")}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
