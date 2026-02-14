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
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { adminAPI } from "@/lib/api";

export function AdminJobsPage() {
  const qc = useQueryClient();
  const t = useT();
  const [orgId, setOrgId] = useState("");
  const [status, setStatus] = useState("");
  const [jobType, setJobType] = useState("");

  const query = useQuery({
    queryKey: ["admin-jobs", orgId, status, jobType],
    queryFn: () =>
      adminAPI.listJobs({
        organization_id: orgId.trim() || undefined,
        status: status.trim() || undefined,
        job_type: jobType.trim() || undefined,
        limit: 200,
      }),
    refetchInterval: 5000,
  });

  const jobs = useMemo(() => {
    return query.data?.jobs ?? [];
  }, [query.data]);

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => adminAPI.cancelJob(jobId),
    onSuccess: async () => {
      toast.success(t("admin.jobs.toasts.cancelled"));
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t("admin.jobs.toasts.cancelFailed")
      ),
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => adminAPI.retryJob(jobId),
    onSuccess: async () => {
      toast.success(t("admin.jobs.toasts.retried"));
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t("admin.jobs.toasts.retryFailed")
      ),
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm">{t("admin.jobs.title")}</CardTitle>
          <div className="text-muted-foreground text-xs">
            {t("admin.jobs.description")}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              onChange={(ev) => setOrgId(ev.target.value)}
              placeholder={t("admin.jobs.filters.orgId")}
              value={orgId}
            />
            <Input
              onChange={(ev) => setStatus(ev.target.value)}
              placeholder={t("admin.jobs.filters.status")}
              value={status}
            />
            <Input
              onChange={(ev) => setJobType(ev.target.value)}
              placeholder={t("admin.jobs.filters.jobType")}
              value={jobType}
            />
          </div>

          {query.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : query.error ? (
            <div className="text-muted-foreground text-sm">
              {query.error instanceof Error
                ? query.error.message
                : t("common.messages.unknownError")}
            </div>
          ) : jobs.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.jobs.table.id")}</TableHead>
                    <TableHead className="hidden lg:table-cell">
                      {t("admin.jobs.table.org")}
                    </TableHead>
                    <TableHead>{t("admin.jobs.table.type")}</TableHead>
                    <TableHead>{t("admin.jobs.table.status")}</TableHead>
                    <TableHead className="text-right">
                      {t("admin.jobs.table.attempts")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("admin.jobs.table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const canCancel =
                      String(j.status) === "queued" ||
                      String(j.status) === "running";
                    const canRetry = String(j.status) === "failed";
                    return (
                      <TableRow key={String(j.id)}>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {String(j.id).slice(0, 8)}…
                        </TableCell>
                        <TableCell className="hidden font-mono text-[11px] text-muted-foreground lg:table-cell">
                          {String(j.organization_id)}
                        </TableCell>
                        <TableCell className="font-medium">
                          {String(j.job_type)}
                        </TableCell>
                        <TableCell>
                          <Badge className="capitalize" variant="secondary">
                            {String(j.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(j.attempts ?? 0)}/
                          {Number(j.max_attempts ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              disabled={!canCancel || cancelMutation.isPending}
                              onClick={() =>
                                cancelMutation.mutate(String(j.id))
                              }
                              size="sm"
                              variant="secondary"
                            >
                              {t("common.actions.cancel")}
                            </Button>
                            <Button
                              disabled={!canRetry || retryMutation.isPending}
                              onClick={() => retryMutation.mutate(String(j.id))}
                              size="sm"
                            >
                              {t("common.actions.retry")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              {t("admin.jobs.empty")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
