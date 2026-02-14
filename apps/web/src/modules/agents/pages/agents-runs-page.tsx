import type {
  ActionReceiptRecord,
  AgentRunModel,
} from "@memorystack/api-types";
import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import { Separator } from "@memorystack/ui-core/separator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleSlash2,
  Loader2,
  PauseCircle,
  PlayCircle,
  Skull,
  TextSearch,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { agentsAPI } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useAgentRunStream } from "@/modules/agents/hooks/use-agent-run-stream";
import {
  formatDateTime,
  statusBadgeClass,
} from "@/modules/agents/lib/agent-ui";

function createControlActionLabel(
  action: "pause" | "resume" | "cancel" | "kill"
) {
  if (action === "pause") return "Pause";
  if (action === "resume") return "Resume";
  if (action === "cancel") return "Cancel";
  return "Kill";
}

export function AgentsRunsPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [selectedRunId, setSelectedRunId] = useState("");
  const [finalStatusFilter, setFinalStatusFilter] = useState("all");

  const runsQuery = useQuery({
    queryKey: ["agent-runs-page-runs", organizationId],
    queryFn: () =>
      agentsAPI.listRuns({
        organizationId,
        limit: 200,
      }),
    enabled: Boolean(organizationId),
    refetchInterval: 5000,
  });

  const selectedRun = useMemo(
    () => runsQuery.data?.find((run) => run.id === selectedRunId) ?? null,
    [runsQuery.data, selectedRunId]
  );

  const replayQuery = useQuery({
    queryKey: ["agent-runs-page-replay", selectedRun?.id],
    queryFn: () => agentsAPI.replayRun(selectedRun?.id ?? ""),
    enabled: Boolean(selectedRun?.id),
  });

  const receiptsQuery = useQuery({
    queryKey: [
      "agent-runs-page-receipts",
      organizationId,
      selectedRun?.id,
      finalStatusFilter,
    ],
    queryFn: () =>
      agentsAPI.listReceipts({
        organizationId,
        runId: selectedRun?.id ?? undefined,
        finalStatus:
          finalStatusFilter === "all" ? undefined : finalStatusFilter,
      }),
    enabled: Boolean(organizationId && selectedRun?.id),
  });

  const runControlMutation = useMutation({
    mutationFn: async (params: {
      run: AgentRunModel;
      action: "pause" | "resume" | "cancel" | "kill";
    }) => {
      if (params.action === "pause") {
        return agentsAPI.pauseRun(params.run.id, organizationId);
      }
      if (params.action === "resume") {
        return agentsAPI.resumeRun(params.run.id, organizationId);
      }
      if (params.action === "cancel") {
        return agentsAPI.cancelRun(params.run.id, organizationId);
      }
      return agentsAPI.killRun(params.run.id, organizationId);
    },
    onSuccess: async () => {
      toast.success("Run control signal sent");
      await queryClient.invalidateQueries({
        queryKey: ["agent-runs-page-runs", organizationId],
      });
      await replayQuery.refetch();
      await receiptsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to send run control signal");
    },
  });

  const onRunUpdate = useCallback(
    (event: { id: string; status: string; updated_at: unknown }) => {
      queryClient.setQueryData<AgentRunModel[] | undefined>(
        ["agent-runs-page-runs", organizationId],
        (previous) => {
          if (!previous) {
            return previous;
          }
          return previous.map((run) =>
            run.id === event.id
              ? {
                  ...run,
                  status: event.status,
                  updated_at: event.updated_at,
                }
              : run
          );
        }
      );
    },
    [organizationId, queryClient]
  );

  useAgentRunStream({
    organizationId,
    enabled: Boolean(organizationId),
    onRunUpdate,
  });

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
        Select an organization to view Agent runs.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <TextSearch className="h-3.5 w-3.5" />
            Agent run diagnostics
          </div>
          <h1 className="font-semibold text-2xl">
            Trace, replay, and control run lifecycles
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Runtime traces, evidence references, receipts, and direct run
            controls.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Runs</CardTitle>
            <CardDescription>
              Select a run to inspect replay and receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            {runsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : runsQuery.isError ? (
              <ApiErrorPanel
                error={runsQuery.error}
                onRetry={() => runsQuery.refetch()}
              />
            ) : (runsQuery.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                No runs found.
              </div>
            ) : (
              <ScrollArea className="h-[480px] pr-2">
                <div className="space-y-2">
                  {runsQuery.data?.map((run) => (
                    <button
                      className={cn(
                        "w-full rounded-lg border px-3 py-2 text-left",
                        selectedRunId === run.id &&
                          "border-primary bg-primary/5"
                      )}
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-sm">{run.id}</p>
                        <Badge className={statusBadgeClass("run", run.status)}>
                          {run.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground text-xs">
                        Updated {formatDateTime(run.updated_at)}
                      </p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Replay & receipts</CardTitle>
            <CardDescription>
              Detailed run steps, evidence, and final action receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 space-y-4">
            {selectedRun ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={statusBadgeClass("run", selectedRun.status)}
                  >
                    {selectedRun.status}
                  </Badge>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "pause",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PauseCircle className="mr-2 h-4 w-4" />
                    {createControlActionLabel("pause")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "resume",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <PlayCircle className="mr-2 h-4 w-4" />
                    {createControlActionLabel("resume")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "cancel",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <CircleSlash2 className="mr-2 h-4 w-4" />
                    {createControlActionLabel("cancel")}
                  </Button>
                  <Button
                    disabled={runControlMutation.isPending}
                    onClick={() =>
                      runControlMutation.mutate({
                        run: selectedRun,
                        action: "kill",
                      })
                    }
                    size="sm"
                    type="button"
                    variant="destructive"
                  >
                    <Skull className="mr-2 h-4 w-4" />
                    {createControlActionLabel("kill")}
                  </Button>
                </div>

                <Separator />

                {replayQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading replay steps…
                  </div>
                ) : replayQuery.isError ? (
                  <ApiErrorPanel
                    error={replayQuery.error}
                    onRetry={() => replayQuery.refetch()}
                  />
                ) : (
                  <ScrollArea className="h-[220px] pr-2">
                    <div className="space-y-2">
                      {replayQuery.data?.steps?.map((step) => (
                        <div className="rounded-lg border p-3" key={step.id}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-sm">
                              {step.step_type}
                            </p>
                            <Badge
                              className={statusBadgeClass("run", step.status)}
                            >
                              {step.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground text-xs">
                            {formatDateTime(
                              step.completed_at || step.created_at
                            )}
                          </p>
                          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                            {JSON.stringify(step.evidence_refs ?? {}, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                <Separator />

                <div className="space-y-2">
                  <p className="font-medium text-sm">Receipts</p>
                  {receiptsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading receipts…
                    </div>
                  ) : receiptsQuery.isError ? (
                    <ApiErrorPanel
                      error={receiptsQuery.error}
                      onRetry={() => receiptsQuery.refetch()}
                    />
                  ) : (
                    <ReceiptsList receipts={receiptsQuery.data ?? []} />
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                Select a run from the list.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReceiptsList({ receipts }: { receipts: ActionReceiptRecord[] }) {
  if (receipts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
        No receipts recorded for this run yet.
      </div>
    );
  }
  return (
    <ScrollArea className="h-[140px] pr-2">
      <div className="space-y-2">
        {receipts.map((receipt) => (
          <div className="rounded-lg border px-3 py-2" key={receipt.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{receipt.tool_id}</p>
              <Badge className={statusBadgeClass("run", receipt.final_status)}>
                {receipt.final_status}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {formatDateTime(receipt.updated_at)}
            </p>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
