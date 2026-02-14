import type {
  AgentInboxThreadRecord,
  AgentMessageEventRecord,
  AgentRunModel,
  ApprovalRequestRecord,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@memorystack/ui-core/select";
import { Separator } from "@memorystack/ui-core/separator";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const THREAD_STATUS = [
  "all",
  "open",
  "resolved",
  "blocked",
  "archived",
] as const;
const CHANNEL_FILTER = ["all", "email", "slack", "teams"] as const;

export function AgentsInboxPage() {
  const queryClient = useQueryClient();
  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const [selectedIdentityId, setSelectedIdentityId] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<(typeof THREAD_STATUS)[number]>("open");
  const [channelFilter, setChannelFilter] =
    useState<(typeof CHANNEL_FILTER)[number]>("all");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [approvalReason, setApprovalReason] = useState("");

  const [commandDeploymentId, setCommandDeploymentId] = useState("");
  const [commandDraft, setCommandDraft] = useState("");

  const identitiesQuery = useQuery({
    queryKey: ["agent-inbox-identities", organizationId],
    queryFn: () => agentsAPI.listIdentities(organizationId),
    enabled: Boolean(organizationId),
  });

  const deploymentsQuery = useQuery({
    queryKey: ["agent-inbox-deployments", organizationId],
    queryFn: () => agentsAPI.listDeployments(organizationId),
    enabled: Boolean(organizationId),
  });

  const effectiveDeploymentId =
    commandDeploymentId ||
    deploymentsQuery.data?.find((deployment) => deployment.status === "active")
      ?.id ||
    deploymentsQuery.data?.[0]?.id ||
    "";

  const threadsQuery = useQuery({
    queryKey: [
      "agent-inbox-threads",
      organizationId,
      selectedIdentityId,
      statusFilter,
      channelFilter,
    ],
    queryFn: () =>
      agentsAPI.listInboxThreads({
        organizationId,
        identityId:
          selectedIdentityId === "all" ? undefined : selectedIdentityId,
        status: statusFilter === "all" ? undefined : statusFilter,
        channelType: channelFilter === "all" ? undefined : channelFilter,
        limit: 200,
      }),
    enabled: Boolean(organizationId),
  });

  const selectedThread = useMemo(
    () =>
      threadsQuery.data?.find((thread) => thread.id === selectedThreadId) ??
      null,
    [threadsQuery.data, selectedThreadId]
  );

  const messagesQuery = useQuery({
    queryKey: ["agent-inbox-messages", organizationId, selectedThreadId],
    queryFn: () =>
      agentsAPI.listThreadMessages({
        threadId: selectedThreadId,
        organizationId,
        limit: 300,
      }),
    enabled: Boolean(organizationId && selectedThreadId),
  });

  const approvalsQuery = useQuery({
    queryKey: ["agent-inbox-approvals", organizationId],
    queryFn: () =>
      agentsAPI.listApprovals({
        organizationId,
        status: "pending",
      }),
    enabled: Boolean(organizationId),
    refetchInterval: 5000,
  });

  const commandRunsQuery = useQuery({
    queryKey: [
      "agent-inbox-command-runs",
      organizationId,
      effectiveDeploymentId,
    ],
    queryFn: () =>
      agentsAPI.listRuns({
        organizationId,
        deploymentId: effectiveDeploymentId || undefined,
        limit: 40,
      }),
    enabled: Boolean(organizationId && effectiveDeploymentId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!threadsQuery.data || threadsQuery.data.length === 0) {
      setSelectedThreadId("");
      return;
    }
    if (!selectedThreadId) {
      setSelectedThreadId(threadsQuery.data[0]?.id ?? "");
      return;
    }
    if (!threadsQuery.data.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threadsQuery.data[0]?.id ?? "");
    }
  }, [selectedThreadId, threadsQuery.data]);

  const replyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedThreadId) {
        throw new Error("Select a thread first");
      }
      return agentsAPI.replyToThread(selectedThreadId, {
        organization_id: organizationId,
        message: replyDraft.trim(),
        evidence_links: [],
        recipients: [],
      });
    },
    onSuccess: async () => {
      setReplyDraft("");
      toast.success("Reply sent");
      await Promise.all([
        messagesQuery.refetch(),
        threadsQuery.refetch(),
        queryClient.invalidateQueries({
          queryKey: ["agent-inbox-messages", organizationId, selectedThreadId],
        }),
      ]);
    },
    onError: () => {
      toast.error("Failed to send reply");
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async (params: {
      approval: ApprovalRequestRecord;
      decision: "approve" | "deny";
    }) => {
      const payload = {
        organization_id: organizationId,
        reason: approvalReason.trim() || undefined,
      };
      if (params.decision === "approve") {
        return agentsAPI.approve(params.approval.id, payload);
      }
      return agentsAPI.deny(params.approval.id, payload);
    },
    onSuccess: async (_, params) => {
      toast.success(`Approval ${params.decision}d`);
      setApprovalReason("");
      await approvalsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to submit approval decision");
    },
  });

  const commandMutation = useMutation({
    mutationFn: () =>
      agentsAPI.createRun({
        organization_id: organizationId,
        deployment_id: effectiveDeploymentId,
        metadata: {
          source: "inbox_command_center",
          command: commandDraft.trim(),
        },
        payload: {
          mission: commandDraft.trim(),
          initiated_from: "agent_inbox",
        },
      }),
    onSuccess: async () => {
      setCommandDraft("");
      toast.success("Command sent to agent");
      await commandRunsQuery.refetch();
    },
    onError: () => {
      toast.error("Failed to dispatch command");
    },
  });

  const onRunUpdate = useCallback(
    (event: { id: string; status: string; updated_at: unknown }) => {
      queryClient.setQueryData<AgentRunModel[] | undefined>(
        ["agent-inbox-command-runs", organizationId, effectiveDeploymentId],
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

  const identityLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const identity of identitiesQuery.data ?? []) {
      map.set(identity.id, identity.display_name);
    }
    return map;
  }, [identitiesQuery.data]);

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
        Select an organization to open Agent Inbox.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
            <MessageSquare className="h-3.5 w-3.5" />
            Agent Inbox
          </div>
          <h1 className="font-semibold text-2xl">
            Channel queue and approvals
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Manage live email/Slack/Teams conversations, route commands, and
            clear action approvals without leaving the app.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 gap-6 xl:grid-cols-[0.95fr_1.05fr_0.95fr]">
        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Threads</CardTitle>
            <CardDescription>
              Filter by identity, channel, and status.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Select
                onValueChange={setSelectedIdentityId}
                value={selectedIdentityId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Identity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All identities</SelectItem>
                  {(identitiesQuery.data ?? []).map((identity) => (
                    <SelectItem key={identity.id} value={identity.id}>
                      {identity.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={(value) =>
                  setChannelFilter(value as (typeof CHANNEL_FILTER)[number])
                }
                value={channelFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNEL_FILTER.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                onValueChange={(value) =>
                  setStatusFilter(value as (typeof THREAD_STATUS)[number])
                }
                value={statusFilter}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {THREAD_STATUS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {threadsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading inbox threads…
              </div>
            ) : threadsQuery.isError ? (
              <ApiErrorPanel
                error={threadsQuery.error}
                onRetry={() => threadsQuery.refetch()}
              />
            ) : (
              <ThreadList
                identityLookup={identityLookup}
                onSelect={setSelectedThreadId}
                selectedThreadId={selectedThreadId}
                threads={threadsQuery.data ?? []}
              />
            )}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader>
            <CardTitle className="text-base">Thread conversation</CardTitle>
            <CardDescription>
              Inspect messages, then reply with evidence-aware context.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 space-y-3">
            {selectedThread ? (
              <>
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">
                      {selectedThread.subject ||
                        selectedThread.external_thread_id}
                    </p>
                    <Badge
                      className={statusBadgeClass(
                        "run",
                        selectedThread.status ?? "open"
                      )}
                    >
                      {selectedThread.status ?? "open"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {selectedThread.channel_type} · Updated{" "}
                    {formatDateTime(selectedThread.updated_at)}
                  </p>
                </div>

                {messagesQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading thread messages…
                  </div>
                ) : messagesQuery.isError ? (
                  <ApiErrorPanel
                    error={messagesQuery.error}
                    onRetry={() => messagesQuery.refetch()}
                  />
                ) : (
                  <MessageTimeline messages={messagesQuery.data ?? []} />
                )}

                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="thread-reply">Reply</Label>
                  <Textarea
                    id="thread-reply"
                    onChange={(event) => setReplyDraft(event.target.value)}
                    placeholder="Reply with evidence-backed guidance…"
                    value={replyDraft}
                  />
                  <Button
                    className="w-full"
                    disabled={
                      replyMutation.isPending || replyDraft.trim().length === 0
                    }
                    onClick={() => replyMutation.mutate()}
                    type="button"
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send reply
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
                Select a thread to view messages.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-6">
          <Card className="min-h-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4.5 w-4.5 text-primary" />
                Approval inbox
              </CardTitle>
              <CardDescription>
                Pending high-risk actions waiting for human decision.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3">
              <Textarea
                className="min-h-[84px]"
                onChange={(event) => setApprovalReason(event.target.value)}
                placeholder="Optional reason applied to each decision…"
                value={approvalReason}
              />

              {approvalsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading approvals…
                </div>
              ) : approvalsQuery.isError ? (
                <ApiErrorPanel
                  error={approvalsQuery.error}
                  onRetry={() => approvalsQuery.refetch()}
                />
              ) : (
                <ApprovalsList
                  approvals={approvalsQuery.data ?? []}
                  onApprove={(approval) =>
                    approvalMutation.mutate({ approval, decision: "approve" })
                  }
                  onDeny={(approval) =>
                    approvalMutation.mutate({ approval, decision: "deny" })
                  }
                  pending={approvalMutation.isPending}
                />
              )}
            </CardContent>
          </Card>

          <Card className="min-h-0">
            <CardHeader>
              <CardTitle className="text-base">Direct command center</CardTitle>
              <CardDescription>
                Chat-style command dispatch to a selected deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3">
              <Select
                onValueChange={setCommandDeploymentId}
                value={effectiveDeploymentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select deployment" />
                </SelectTrigger>
                <SelectContent>
                  {(deploymentsQuery.data ?? []).map((deployment) => (
                    <SelectItem key={deployment.id} value={deployment.id}>
                      {deployment.id.slice(0, 14)} · {deployment.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                className="min-h-[96px]"
                onChange={(event) => setCommandDraft(event.target.value)}
                placeholder="Example: review unresolved renewal risks and draft a partner update."
                value={commandDraft}
              />
              <Button
                className="w-full"
                disabled={
                  commandMutation.isPending ||
                  !effectiveDeploymentId ||
                  !commandDraft.trim()
                }
                onClick={() => commandMutation.mutate()}
                type="button"
              >
                {commandMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="mr-2 h-4 w-4" />
                )}
                Send command
              </Button>

              <Separator />

              <p className="font-medium text-sm">Recent command runs</p>
              {commandRunsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading command runs…
                </div>
              ) : commandRunsQuery.isError ? (
                <ApiErrorPanel
                  error={commandRunsQuery.error}
                  onRetry={() => commandRunsQuery.refetch()}
                />
              ) : (
                <ScrollArea className="h-[180px] pr-2">
                  <div className="space-y-2">
                    {(commandRunsQuery.data ?? []).slice(0, 10).map((run) => (
                      <div className="rounded-lg border px-3 py-2" key={run.id}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-xs">{run.id}</p>
                          <Badge
                            className={statusBadgeClass("run", run.status)}
                          >
                            {run.status}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                          {(run.metadata?.command as string | undefined) ||
                            (run.metadata?.mission as string | undefined) ||
                            "No command payload"}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ThreadList({
  threads,
  selectedThreadId,
  identityLookup,
  onSelect,
}: {
  threads: AgentInboxThreadRecord[];
  selectedThreadId: string;
  identityLookup: Map<string, string>;
  onSelect: (threadId: string) => void;
}) {
  if (threads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
        No matching inbox threads.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[520px] pr-2">
      <div className="space-y-2">
        {threads.map((thread) => (
          <button
            className={cn(
              "w-full rounded-lg border px-3 py-2 text-left",
              selectedThreadId === thread.id && "border-primary bg-primary/5"
            )}
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium text-sm">
                {thread.subject || thread.external_thread_id}
              </p>
              <Badge
                className={statusBadgeClass("run", thread.status ?? "open")}
              >
                {thread.status ?? "open"}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {thread.channel_type} ·{" "}
              {identityLookup.get(thread.identity_id) || thread.identity_id}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatDateTime(thread.last_message_at || thread.updated_at)}
            </p>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

function MessageTimeline({
  messages,
}: {
  messages: AgentMessageEventRecord[];
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
        No messages for this thread yet.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[320px] pr-2">
      <div className="space-y-2">
        {messages.map((message) => {
          const inbound = message.direction === "inbound";
          return (
            <article
              className={cn(
                "rounded-lg border px-3 py-2",
                inbound
                  ? "border-border bg-background"
                  : "border-primary/30 bg-primary/5"
              )}
              key={message.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1 font-medium text-xs uppercase tracking-wide">
                  <User className="h-3 w-3" />
                  {inbound ? "Inbound" : "Agent"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTime(message.occurred_at || message.created_at)}
                </p>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {message.body_text || message.subject || "No body text"}
              </p>
              {message.run_id ? (
                <p className="mt-2 text-muted-foreground text-xs">
                  Run {message.run_id}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function ApprovalsList({
  approvals,
  onApprove,
  onDeny,
  pending,
}: {
  approvals: ApprovalRequestRecord[];
  onApprove: (approval: ApprovalRequestRecord) => void;
  onDeny: (approval: ApprovalRequestRecord) => void;
  pending: boolean;
}) {
  if (approvals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
        No pending approvals.
      </div>
    );
  }

  return (
    <ScrollArea className="h-[240px] pr-2">
      <div className="space-y-2">
        {approvals.map((approval) => (
          <div className="rounded-lg border px-3 py-2" key={approval.id}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{approval.tool_id}</p>
              <Badge
                className={statusBadgeClass(
                  "run",
                  approval.status ?? "pending"
                )}
              >
                {approval.status ?? "pending"}
              </Badge>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {approval.action_tier} · Run {approval.run_id || "—"}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                disabled={pending}
                onClick={() => onApprove(approval)}
                size="sm"
                type="button"
                variant="outline"
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Approve
              </Button>
              <Button
                disabled={pending}
                onClick={() => onDeny(approval)}
                size="sm"
                type="button"
                variant="destructive"
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                Deny
              </Button>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
