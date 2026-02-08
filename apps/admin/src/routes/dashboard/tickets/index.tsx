import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Inbox, Search } from "lucide-react";

import { supportAPI, type SupportTicketListItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/tickets/")({
  component: AdminTicketsPage,
});

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
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

function AdminTicketsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "pending" | "closed">(
    "all"
  );

  const query = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => supportAPI.listTickets(),
    refetchInterval: 5000,
  });

  const tickets = useMemo(() => {
    const raw = (query.data?.tickets ?? []) as SupportTicketListItem[];
    const needle = q.trim().toLowerCase();
    const filtered = raw.filter((t) => {
      if (status !== "all" && t.status !== status) return false;
      if (!needle) return true;
      return (
        t.id.toLowerCase().includes(needle) ||
        t.subject.toLowerCase().includes(needle) ||
        t.created_by_email.toLowerCase().includes(needle) ||
        t.organization_id.toLowerCase().includes(needle)
      );
    });
    return filtered.sort((a, b) => {
      const ta = new Date(a.last_message_at ?? a.updated_at ?? a.created_at).getTime();
      const tb = new Date(b.last_message_at ?? b.updated_at ?? b.created_at).getTime();
      return tb - ta;
    });
  }, [q, query.data?.tickets, status]);

  const counts = useMemo(() => {
    const raw = (query.data?.tickets ?? []) as SupportTicketListItem[];
    return {
      all: raw.length,
      open: raw.filter((t) => t.status === "open").length,
      pending: raw.filter((t) => t.status === "pending").length,
      closed: raw.filter((t) => t.status === "closed").length,
    };
  }, [query.data?.tickets]);

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border/70 bg-muted/40">
                <Inbox className="h-4 w-4 text-foreground/80" />
              </span>
              Support tickets
              <Badge variant="secondary" className="ml-1">
                {counts.all}
              </Badge>
            </CardTitle>
            <div className="text-muted-foreground text-xs">
              Inbox for support@drovi.co and in-app reports. Auto-refreshes every 5s.
            </div>
          </div>
          <div className="flex w-[520px] max-w-full items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by subject, email, org, ticket id…"
                value={q}
                onChange={(ev) => setQ(ev.target.value)}
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as any)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({counts.all})</SelectItem>
                <SelectItem value="open">Open ({counts.open})</SelectItem>
                <SelectItem value="pending">Pending ({counts.pending})</SelectItem>
                <SelectItem value="closed">Closed ({counts.closed})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
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
          ) : tickets.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead className="hidden lg:table-cell">Org</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Priority</TableHead>
                    <TableHead className="hidden xl:table-cell">Assignee</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((t) => (
                    <TableRow
                      key={t.id}
                      className={cn("cursor-pointer")}
                      onClick={() =>
                        navigate({
                          to: "/dashboard/tickets/$ticketId",
                          params: { ticketId: t.id },
                        })
                      }
                    >
                      <TableCell className="max-w-[520px]">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-sm">
                              {t.subject}
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="font-mono">{t.id}</span>
                              <span className="truncate">{t.created_by_email}</span>
                              {t.message_count ? (
                                <span className="tabular-nums">
                                  {t.message_count} msg
                                </span>
                              ) : null}
                            </div>
                            {t.last_message_preview ? (
                              <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                {t.last_message_preview}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {t.organization_id}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status) as any}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant={priorityVariant(t.priority) as any}>
                          {t.priority}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                        {t.assignee_email ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {formatWhen(t.last_message_at ?? t.updated_at ?? t.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No tickets yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

