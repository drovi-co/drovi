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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/jobs")({
  component: AdminJobsPage,
});

function AdminJobsPage() {
  const qc = useQueryClient();
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
    const rows = (query.data?.jobs ?? []) as Array<any>;
    return rows;
  }, [query.data]);

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => adminAPI.cancelJob(jobId),
    onSuccess: async () => {
      toast.success("Job cancelled");
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Cancel failed"),
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => adminAPI.retryJob(jobId),
    onSuccess: async () => {
      toast.success("Job retried");
      await qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Retry failed"),
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm">Jobs</CardTitle>
          <div className="text-muted-foreground text-xs">
            Durable job queue. Refreshes every 5s.
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              placeholder="Filter org id (optional)"
              value={orgId}
              onChange={(ev) => setOrgId(ev.target.value)}
            />
            <Input
              placeholder="Filter status (queued/running/failed...)"
              value={status}
              onChange={(ev) => setStatus(ev.target.value)}
            />
            <Input
              placeholder="Filter job_type (connector.sync, ...)"
              value={jobType}
              onChange={(ev) => setJobType(ev.target.value)}
            />
          </div>

          {query.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : query.error ? (
            <div className="text-sm text-muted-foreground">
              {query.error instanceof Error ? query.error.message : "Unknown error"}
            </div>
          ) : jobs.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead className="hidden lg:table-cell">Org</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const canCancel = String(j.status) === "queued" || String(j.status) === "running";
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
                          <Badge variant="secondary" className="capitalize">
                            {String(j.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(j.attempts ?? 0)}/{Number(j.max_attempts ?? 0)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              disabled={!canCancel || cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate(String(j.id))}
                              size="sm"
                              variant="secondary"
                            >
                              Cancel
                            </Button>
                            <Button
                              disabled={!canRetry || retryMutation.isPending}
                              onClick={() => retryMutation.mutate(String(j.id))}
                              size="sm"
                            >
                              Retry
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
            <div className="text-sm text-muted-foreground">No jobs found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

