import type {
  AgentDeploymentModel,
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
import { Label } from "@memorystack/ui-core/label";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import { Separator } from "@memorystack/ui-core/separator";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Loader2,
  PauseCircle,
  PlayCircle,
  Send,
  Shield,
  Zap,
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

function nextRunAction(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "running") {
    return "pause";
  }
  if (normalized === "waiting_approval") {
    return "resume";
  }
  if (normalized === "accepted") {
    return "cancel";
  }
  return null;
}

export function AgentsWorkforcesPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";
  const [selectedDeploymentId, setSelectedDeploymentId] = useState("");
  const [missionDraft, setMissionDraft] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");

  const {
    data: deployments,
    isLoading: deploymentsLoading,
    isError: deploymentsError,
    error: deploymentsErrorObj,
    refetch: refetchDeployments,
  } = useQuery({
    queryKey: ["agent-workforces-deployments", organizationId],
    queryFn: () => agentsAPI.listDeployments(organizationId),
    enabled: Boolean(organizationId),
  });

  const effectiveDeploymentId =
    selectedDeploymentId ||
    deployments?.find((deployment) => deployment.status === "active")?.id ||
    deployments?.[0]?.id ||
    "";

  const {
    data: runs,
    isLoading: runsLoading,
    isError: runsError,
    error: runsErrorObj,
    refetch: refetchRuns,
  } = useQuery({
    queryKey: ["agent-workforces-runs", organizationId, effectiveDeploymentId],
    queryFn: () =>
      agentsAPI.listRuns({
        organizationId,
        deploymentId: effectiveDeploymentId || undefined,
        limit: 120,
      }),
    enabled: Boolean(organizationId && effectiveDeploymentId),
    refetchInterval: 4000,
  });

  const selectedRun = useMemo(
    () => runs?.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const {
    data: runReplay,
    isLoading: replayLoading,
    isError: replayError,
    error: replayErrorObj,
    refetch: refetchReplay,
  } = useQuery({
    queryKey: ["agent-workforces-run-replay", selectedRun?.id],
    queryFn: () => agentsAPI.replayRun(selectedRun?.id ?? ""),
    enabled: Boolean(selectedRun?.id),
  });

  const createRunMutation = useMutation({
    mutationFn: (payload: {
      deployment: AgentDeploymentModel;
      mission: string;
    }) =>
      agentsAPI.createRun({
        organization_id: organizationId,
        deployment_id: payload.deployment.id,
        metadata: {
          source: "command_center",
          mission: payload.mission,
        },
        payload: {
          mission: payload.mission,
          initiated_from: "workforces_page",
        },
      }),
    onSuccess: async (run) => {
      setMissionDraft("");
      setSelectedRunId(run.id);
      toast.success("Agent run accepted");
      await queryClient.invalidateQueries({
        queryKey: [
          "agent-workforces-runs",
          organizationId,
          effectiveDeploymentId,
        ],
      });
    },
    onError: () => {
      toast.error("Failed to start run");
    },
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
      await queryClient.invalidateQueries({
        queryKey: [
          "agent-workforces-runs",
          organizationId,
          effectiveDeploymentId,
        ],
      });
      toast.success("Run control signal sent");
    },
    onError: () => {
      toast.error("Failed to send run control signal");
    },
  });

  const onRunUpdate = useCallback(
    (event: { id: string; status: string; updated_at: unknown }) => {
      queryClient.setQueryData<AgentRunModel[] | undefined>(
        ["agent-workforces-runs", organizationId, effectiveDeploymentId],
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
    [effectiveDeploymentId, organizationId, queryClient]
  );

  useAgentRunStream({
    organizationId,
    deploymentId: effectiveDeploymentId || null,
    enabled: Boolean(organizationId && effectiveDeploymentId),
    onRunUpdate,
  });

  const selectedDeployment = deployments?.find(
    (deployment) => deployment.id === effectiveDeploymentId
  );

  const submitMission = () => {
    if (!selectedDeployment) {
      toast.error("Select a deployment first");
      return;
    }
    const mission = missionDraft.trim();
    if (!mission) {
      toast.error("Describe the mission before sending");
      return;
    }
    createRunMutation.mutate({ deployment: selectedDeployment, mission });
  };

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
        Select an organization to open Agent Workforces.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <Bot className="h-3.5 w-3.5" />
              Agent Workforces
            </div>
            <h1 className="font-semibold text-2xl">Deploy AI coworkers</h1>
            <p className="max-w-2xl text-muted-foreground">
              Start missions, watch live run states, and keep policy signals in
              view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="border border-primary/30 bg-primary/10 text-primary">
              Live control plane
            </Badge>
            <Badge variant="outline">
              {runs?.filter((run) => run.status === "running").length ?? 0}{" "}
              running
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deployments</CardTitle>
            <CardDescription>
              Select the active workforce deployment and dispatch a mission.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {deploymentsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading deployments…
              </div>
            ) : deploymentsError ? (
              <ApiErrorPanel
                error={deploymentsErrorObj}
                onRetry={() => refetchDeployments()}
              />
            ) : (deployments ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
                No deployments yet. Create one in Agent Studio.
              </div>
            ) : (
              deployments?.map((deployment) => {
                const selected = deployment.id === effectiveDeploymentId;
                return (
                  <button
                    className={cn(
                      "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40"
                    )}
                    key={deployment.id}
                    onClick={() => setSelectedDeploymentId(deployment.id)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">
                        {deployment.id.slice(0, 12)}
                      </span>
                      <Badge
                        className={statusBadgeClass(
                          "deployment",
                          deployment.status
                        )}
                      >
                        {deployment.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">
                      Updated {formatDateTime(deployment.updated_at)}
                    </p>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.16),_transparent_58%)]" />
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4.5 w-4.5 text-primary" />
              Agent Command Center
            </CardTitle>
            <CardDescription>
              Chat-like mission dispatch with live execution updates.
            </CardDescription>
          </CardHeader>
          <CardContent className="relative space-y-3">
            <div className="space-y-2">
              <Label htmlFor="mission">Mission prompt</Label>
              <Textarea
                className="min-h-[132px]"
                id="mission"
                onChange={(event) => setMissionDraft(event.target.value)}
                placeholder="Example: Draft and send a renewal risk update for all accounts expiring in 45 days."
                value={missionDraft}
              />
            </div>
            <Button
              className="w-full"
              disabled={createRunMutation.isPending || !effectiveDeploymentId}
              onClick={submitMission}
              type="button"
            >
              {createRunMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Dispatch mission
            </Button>
            {selectedRun ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Latest run</span>
                  <Badge
                    className={statusBadgeClass("run", selectedRun.status)}
                  >
                    {selectedRun.status}
                  </Badge>
                </div>
                <p className="mt-1 text-muted-foreground text-xs">
                  {selectedRun.id} · Updated{" "}
                  {formatDateTime(selectedRun.updated_at)}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-h-0 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Live run feed</CardTitle>
            <CardDescription>
              Streamed statuses from AgentOS runtime. Select a row to inspect
              proof.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            {runsLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : runsError ? (
              <ApiErrorPanel
                error={runsErrorObj}
                onRetry={() => refetchRuns()}
              />
            ) : (runs ?? []).length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
                No runs yet for this deployment.
              </div>
            ) : (
              <ScrollArea className="h-[340px] pr-2">
                <div className="space-y-2">
                  {runs?.map((run) => {
                    const action = nextRunAction(run.status);
                    return (
                      <div
                        className={cn(
                          "rounded-lg border px-3 py-2",
                          run.id === selectedRunId &&
                            "border-primary bg-primary/5"
                        )}
                        key={run.id}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            className="space-y-0.5 text-left"
                            onClick={() => setSelectedRunId(run.id)}
                            type="button"
                          >
                            <p className="font-medium text-sm">{run.id}</p>
                            <p className="text-muted-foreground text-xs">
                              Started{" "}
                              {formatDateTime(run.started_at || run.created_at)}
                            </p>
                          </button>
                          <div className="flex items-center gap-2">
                            <Badge
                              className={statusBadgeClass("run", run.status)}
                            >
                              {run.status}
                            </Badge>
                            {action ? (
                              <Button
                                disabled={runControlMutation.isPending}
                                onClick={() =>
                                  runControlMutation.mutate({
                                    run,
                                    action,
                                  })
                                }
                                size="icon"
                                type="button"
                                variant="outline"
                              >
                                {action === "pause" ? (
                                  <PauseCircle className="h-4 w-4" />
                                ) : (
                                  <PlayCircle className="h-4 w-4" />
                                )}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4.5 w-4.5 text-primary" />
              Evidence panel
            </CardTitle>
            <CardDescription>
              Inline run-step proofs and structured outputs.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0">
            {selectedRun ? (
              replayLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading replay…
                </div>
              ) : replayError ? (
                <ApiErrorPanel
                  error={replayErrorObj}
                  onRetry={() => refetchReplay()}
                />
              ) : (
                <ScrollArea className="h-[340px] pr-2">
                  <div className="space-y-3">
                    {runReplay?.steps?.map((step) => (
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
                          {formatDateTime(step.completed_at || step.created_at)}
                        </p>
                        <Separator className="my-2" />
                        <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify(step.evidence_refs ?? {}, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )
            ) : (
              <div className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
                Select a run to view step evidence.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
