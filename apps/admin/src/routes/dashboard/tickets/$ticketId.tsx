import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CornerDownRight, Mail, MessageSquare, StickyNote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { supportAPI, type SupportTicketMessageItem } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/tickets/$ticketId")({
  component: AdminTicketDetailPage,
});

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

function statusVariant(status: string) {
  if (status === "open") return "warning";
  if (status === "pending") return "info";
  if (status === "closed") return "success";
  return "secondary";
}

function priorityVariant(priority: string) {
  if (priority === "high") return "destructive";
  if (priority === "low") return "outline";
  return "secondary";
}

function messageChrome(message: SupportTicketMessageItem) {
  const inbound = message.direction === "inbound";
  const internal = message.visibility === "internal";

  const icon = inbound ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />;
  const label = inbound ? "Inbound" : "Outbound";

  const badge = (
    <Badge variant={internal ? "outline" : "secondary"}>
      {internal ? "internal" : "external"}
    </Badge>
  );

  return { inbound, internal, icon, label, badge };
}

function AdminTicketDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { ticketId } = Route.useParams();

  const query = useQuery({
    queryKey: ["support-ticket", ticketId],
    queryFn: () => supportAPI.getTicket(ticketId),
    refetchInterval: 5000,
  });

  const ticket = query.data?.ticket ?? null;
  const messages = query.data?.messages ?? [];

  const [status, setStatus] = useState<"open" | "pending" | "closed">("open");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [assignee, setAssignee] = useState<string>("");

  const [reply, setReply] = useState("");
  const [visibility, setVisibility] = useState<"external" | "internal">("external");

  useEffect(() => {
    if (!ticket) return;
    setStatus((ticket.status as any) ?? "open");
    setPriority((ticket.priority as any) ?? "normal");
    setAssignee(ticket.assignee_email ?? "");
  }, [ticket?.assignee_email, ticket?.priority, ticket?.status]);

  const updateMutation = useMutation({
    mutationFn: async (next: { status?: any; priority?: any; assignee_email?: any }) => {
      return supportAPI.updateTicket({
        ticketId,
        status: next.status,
        priority: next.priority,
        assignee_email: next.assignee_email,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Ticket updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update ticket");
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
      await queryClient.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
      await queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success(visibility === "internal" ? "Internal note added" : "Reply sent");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
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
            variant="ghost"
            className="h-9 px-2"
            onClick={() => navigate({ to: "/dashboard/tickets" })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <div className="min-w-0">
            <div className="truncate font-semibold text-lg">
              {ticket?.subject ?? ticketId}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
            <Badge variant={statusVariant(ticket.status) as any}>{ticket.status}</Badge>
            <Badge variant={priorityVariant(ticket.priority) as any}>{ticket.priority}</Badge>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.62fr_0.38fr]">
        <Card className="border-border/70">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-sm">Conversation</CardTitle>
              <div className="text-muted-foreground text-xs">
                Messages are threaded under the ticket id. External replies email the requester.
              </div>
            </div>
            <Badge variant="secondary" className="tabular-nums">
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
              <div className="text-sm text-muted-foreground">
                {query.error instanceof Error ? query.error.message : "Unknown error"}
              </div>
            ) : sortedMessages.length ? (
              <div className="space-y-3">
                {sortedMessages.map((m) => {
                  const chrome = messageChrome(m);
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-lg border border-border/70 bg-muted/20 p-3",
                        chrome.inbound && "bg-background/30"
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5 text-foreground/80">
                            {chrome.icon}
                            <span className="font-medium">{chrome.label}</span>
                          </span>
                          {chrome.badge}
                          {m.author_email ? (
                            <span className="truncate">
                              {m.author_email}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">
                          {formatWhenLong(m.created_at)}
                        </div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {m.body_text}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No messages yet.</div>
            )}

            <Separator className="my-2" />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {visibility === "internal" ? (
                    <StickyNote className="h-4 w-4" />
                  ) : (
                    <CornerDownRight className="h-4 w-4" />
                  )}
                  <span>
                    {visibility === "internal" ? "Internal note" : "Reply to requester"}
                  </span>
                </div>
                <Select value={visibility} onValueChange={(v) => setVisibility(v as any)}>
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
                placeholder={
                  visibility === "internal"
                    ? "Add an internal note (not emailed)."
                    : "Write a reply. This will be emailed to the requester."
                }
                className="min-h-[120px] resize-y"
                value={reply}
                onChange={(ev) => setReply(ev.target.value)}
              />

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={() => setReply("")}
                  disabled={!reply.trim() || sendMutation.isPending}
                >
                  Clear
                </Button>
                <Button
                  className="h-9"
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                >
                  {sendMutation.isPending ? "Sending…" : visibility === "internal" ? "Add note" : "Send reply"}
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
              {!ticket ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <div className="grid gap-2">
                    <div className="text-xs text-muted-foreground">Status</div>
                    <Select
                      value={status}
                      onValueChange={(v) => {
                        setStatus(v as any);
                        updateMutation.mutate({ status: v });
                      }}
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
                    <div className="text-xs text-muted-foreground">Priority</div>
                    <Select
                      value={priority}
                      onValueChange={(v) => {
                        setPriority(v as any);
                        updateMutation.mutate({ priority: v });
                      }}
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
                    <div className="text-xs text-muted-foreground">Assignee</div>
                    <Input
                      placeholder="assignee@drovi.co"
                      value={assignee}
                      onChange={(ev) => setAssignee(ev.target.value)}
                      onBlur={() => updateMutation.mutate({ assignee_email: assignee.trim() || null })}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Blurs to save. Leave empty to unassign.
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Created</span>
                      <span className="tabular-nums text-foreground/80">
                        {formatWhenLong(ticket.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last message</span>
                      <span className="tabular-nums text-foreground/80">
                        {formatWhenLong(ticket.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Updated</span>
                      <span className="tabular-nums text-foreground/80">
                        {formatWhenLong(ticket.updated_at)}
                      </span>
                    </div>
                  </div>
                </>
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
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(ticketId);
                    toast.success("Ticket ID copied");
                  } catch {
                    toast.error("Failed to copy");
                  }
                }}
              >
                Copy ticket id
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => navigate({ to: "/dashboard/orgs/$orgId", params: { orgId: ticket?.organization_id ?? "internal" } })}
                disabled={!ticket?.organization_id}
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
