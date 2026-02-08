import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminAPI } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/dashboard/connectors")({
  component: AdminConnectorsPage,
});

function AdminConnectorsPage() {
  const q = useQuery({
    queryKey: ["admin-connectors"],
    queryFn: () => adminAPI.listConnectors(),
    refetchInterval: 15000,
  });

  const connectors = (q.data?.connectors ?? []) as Array<any>;

  return (
    <Card className="border-border/70">
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm">Connectors</CardTitle>
        <div className="text-muted-foreground text-xs">
          Configuration status and capabilities. Refreshes every 15s.
        </div>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : q.error ? (
          <div className="text-sm text-muted-foreground">
            {q.error instanceof Error ? q.error.message : "Unknown error"}
          </div>
        ) : connectors.length ? (
          <div className="rounded-md border border-border/70">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Capabilities</TableHead>
                  <TableHead className="hidden lg:table-cell">Missing Env</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((c) => {
                  const configured = Boolean(c.configured);
                  const missing = Array.isArray(c.missing_env) ? (c.missing_env as string[]) : [];
                  const caps = (c.capabilities ?? {}) as any;
                  const capList = [
                    caps.supports_incremental ? "incremental" : null,
                    caps.supports_full_refresh ? "full_refresh" : null,
                    caps.supports_webhooks ? "webhooks" : null,
                    caps.supports_real_time ? "realtime" : null,
                  ].filter(Boolean) as string[];

                  return (
                    <TableRow key={String(c.type)}>
                      <TableCell className="font-medium">{String(c.type)}</TableCell>
                      <TableCell>
                        <Badge variant={configured ? "secondary" : "destructive"}>
                          {configured ? "Configured" : "Not configured"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {capList.length ? (
                            capList.map((cap) => (
                              <Badge key={cap} variant="outline">
                                {cap}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden font-mono text-[11px] text-muted-foreground lg:table-cell">
                        {missing.length ? missing.join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No connectors found.</div>
        )}
      </CardContent>
    </Card>
  );
}

