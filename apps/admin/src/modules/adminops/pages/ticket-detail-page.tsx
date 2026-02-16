import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@memorystack/ui-core/select";
import { Separator } from "@memorystack/ui-core/separator";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import { Textarea } from "@memorystack/ui-core/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  CornerDownRight,
  Mail,
  MessageSquare,
  StickyNote,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type SupportTicketMessageItem, supportAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

type TicketStatus = "open" | "pending" | "closed";
type TicketPriority = "low" | "normal" | "high";
type TicketVisibility = "external" | "internal";

function parseTicketStatus(value: string): TicketStatus {
  if (value === "pending") return "pending";
  if (value === "closed") return "closed";
  return "open";
}

function parseTicketPriority(value: string): TicketPriority {
  if (value === "high") return "high";
  if (value === "low") return "low";
  return "normal";
}

function parseTicketVisibility(value: string): TicketVisibility {
  if (value === "internal") return "internal";
  return "external";
}

function formatWhenLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function statusVariant(status: string): BadgeVariant {
  if (status === "open") return "warning";
  if (status === "pending") return "info";
  if (status === "closed") return "success";
  return "secondary";
}

function priorityVariant(priority: string): BadgeVariant {
  if (priority === "high") return "destructive";
  if (priority === "low") return "outline";
  return "secondary";
}

function messageChrome(message: SupportTicketMessageItem) {
  const inbound = message.direction === "inbound";
  const internal = message.visibility === "internal";

  const icon = inbound ? (
    <Mail className="h-3.5 w-3.5" />
  ) : (
    <MessageSquare className="h-3.5 w-3.5" />
  );
  const label = inbound ? "Inbound" : "Outbound";

  const badge = (
    <Badge variant={internal ? "outline" : "secondary"}>
      {internal ? "internal" : "external"}
    </Badge>
  );

  return { inbound, internal, icon, label, badge };
}

export function AdminTicketDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { ticketId } = useParams({ from: "/dashboard/tickets/$ticketId" });

  const query = useQuery({
    queryKey: ["support-ticket", ticketId],
    queryFn: () => supportAPI.getTicket(ticketId),
    refetchInterval: 5000,
  });

  const ticket = query.data?.ticket ?? null;
  const messages = query.data?.messages ?? [];

  const [status, setStatus] = useState<TicketStatus>("open");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [assignee, setAssignee] = useState<string>("");

  const [reply, setReply] = useState("");
  const [visibility, setVisibility] = useState<TicketVisibility>("external");

  useEffect(() => {
    if (!ticket) return;
    setStatus(parseTicketStatus(ticket.status));
    setPriority(parseTicketPriority(ticket.priority));
    setAssignee(ticket.assignee_email ?? "");
  }, [ticket?.assignee_email, ticket?.priority, ticket?.status]);

  const updateMutation = useMutation({
    mutationFn: async (next: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assignee_email?: string | null;
    }) => {
      return supportAPI.updateTicket({
        ticketId,
        status: next.status,
        priority: next.priority,
        assignee_email: next.assignee_email,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["support-ticket", ticketId],
      });
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Ticket updated");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to update ticket"
      );
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const body = reply.trim();
      if (!body) throw new Error("Message cannot be empty.");
      return supportAPI.addMessage({
        ticketId,
        message: body,
        visibility,
        locale: "en",
      });
    },
    onSuccess: async () => {
      setReply("");
      await queryClient.invalidateQueries({
        queryKey: ["support-ticket", ticketId],
      });
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success(
        visibility === "internal" ? "Internal note added" : "Reply sent"
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to send message"
      );
    },
  });

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta - tb;
    });
  }, [messages]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            className="h-9 px-2"
            onClick={() => navigate({ to: "/dashboard/tickets" })}
            variant="ghost"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="min-w-0">
            <div className="truncate font-semibold text-lg">
              {ticket?.subject ?? ticketId}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span className="font-mono">{ticketId}</span>
              {ticket?.organization_id ? (
                <span className="font-mono">org {ticket.organization_id}</span>
              ) : null}
              {ticket?.created_by_email ? (
                <span className="truncate">from {ticket.created_by_email}</span>
              ) : null}
            </div>
          </div>
        </div>

        {ticket ? (
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(ticket.status)}>
              {ticket.status}
            </Badge>
            <Badge variant={priorityVariant(ticket.priority)}>
              {ticket.priority}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.62fr_0.38fr]">
        <Card className="border-border/70">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-sm">Conversation</CardTitle>
              <div className="text-muted-foreground text-xs">
                Messages are threaded under the ticket id. External replies
                email the requester.
              </div>
            </div>
            <Badge className="tabular-nums" variant="secondary">
              {sortedMessages.length} msg
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : query.error ? (
              <div className="text-muted-foreground text-sm">
                {query.error instanceof Error
                  ? query.error.message
                  : "Unknown error"}
              </div>
            ) : sortedMessages.length ? (
              <div className="space-y-3">
                {sortedMessages.map((m) => {
                  const chrome = messageChrome(m);
                  return (
                    <div
                      className={cn(
                        "rounded-lg border border-border/70 bg-muted/20 p-3",
                        chrome.inbound && "bg-background/30"
                      )}
                      key={m.id}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
                          <span className="flex items-center gap-1.5 text-foreground/80">
                            {chrome.icon}
                            <span className="font-medium">{chrome.label}</span>
                          </span>
                          {chrome.badge}
                          {m.author_email ? (
                            <span className="truncate">{m.author_email}</span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {formatWhenLong(m.created_at)}
                        </div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed">
                        {m.body_text}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">
                No messages yet.
              </div>
            )}

            <Separator className="my-2" />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  {visibility === "internal" ? (
                    <StickyNote className="h-4 w-4" />
                  ) : (
                    <CornerDownRight className="h-4 w-4" />
                  )}
                  <span>
                    {visibility === "internal"
                      ? "Internal note"
                      : "Reply to requester"}
                  </span>
                </div>
                <Select
                  onValueChange={(v) => setVisibility(parseTicketVisibility(v))}
                  value={visibility}
                >
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">External reply</SelectItem>
                    <SelectItem value="internal">Internal note</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                className="min-h-[120px] resize-y"
                onChange={(ev) => setReply(ev.target.value)}
                placeholder={
                  visibility === "internal"
                    ? "Add an internal note (not emailed)."
                    : "Write a reply. This will be emailed to the requester."
                }
                value={reply}
              />

              <div className="flex items-center justify-end gap-2">
                <Button
                  className="h-9"
                  disabled={!reply.trim() || sendMutation.isPending}
                  onClick={() => setReply("")}
                  variant="outline"
                >
                  Clear
                </Button>
                <Button
                  className="h-9"
                  disabled={sendMutation.isPending}
                  onClick={() => sendMutation.mutate()}
                >
                  {sendMutation.isPending
                    ? "Sending…"
                    : visibility === "internal"
                      ? "Add note"
                      : "Send reply"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-sm">Ticket settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket ? (
                <>
                  <div className="grid gap-2">
                    <div className="text-muted-foreground text-xs">Status</div>
                    <Select
                      onValueChange={(v) => {
                        const next = parseTicketStatus(v);
                        setStatus(next);
                        updateMutation.mutate({ status: next });
                      }}
                      value={status}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">open</SelectItem>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="closed">closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-muted-foreground text-xs">
                      Priority
                    </div>
                    <Select
                      onValueChange={(v) => {
                        const next = parseTicketPriority(v);
                        setPriority(next);
                        updateMutation.mutate({ priority: next });
                      }}
                      value={priority}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">low</SelectItem>
                        <SelectItem value="normal">normal</SelectItem>
                        <SelectItem value="high">high</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <div className="text-muted-foreground text-xs">
                      Assignee
                    </div>
                    <Input
                      onBlur={() =>
                        updateMutation.mutate({
                          assignee_email: assignee.trim() || null,
                        })
                      }
                      onChange={(ev) => setAssignee(ev.target.value)}
                      placeholder="assignee@drovi.co"
                      value={assignee}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Blurs to save. Leave empty to unassign.
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2 text-muted-foreground text-xs">
                    <div className="flex items-center justify-between">
                      <span>Created</span>
                      <span className="text-foreground/80 tabular-nums">
                        {formatWhenLong(ticket.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last message</span>
                      <span className="text-foreground/80 tabular-nums">
                        {formatWhenLong(ticket.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Updated</span>
                      <span className="text-foreground/80 tabular-nums">
                        {formatWhenLong(ticket.updated_at)}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader>
              <CardTitle className="text-sm">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(ticketId);
                    toast.success("Ticket ID copied");
                  } catch {
                    toast.error("Failed to copy");
                  }
                }}
                variant="outline"
              >
                Copy ticket id
              </Button>
              <Button
                className="w-full"
                disabled={!ticket?.organization_id}
                onClick={() =>
                  navigate({
                    to: "/dashboard/orgs/$orgId",
                    params: { orgId: ticket?.organization_id ?? "internal" },
                  })
                }
                variant="ghost"
              >
                View organization
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
