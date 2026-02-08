import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminAPI } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/orgs/$orgId")({
  component: AdminOrgDetailPage,
});

function AdminOrgDetailPage() {
  const { orgId } = Route.useParams();

  const q = useQuery({
    queryKey: ["admin-org", orgId],
    queryFn: () => adminAPI.getOrg(orgId),
  });

  if (q.isPending) {
    return (
      <div className="space-y-4">
        <Card className="border-border/70">
          <CardHeader>
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (q.error) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-sm">Failed to load organization</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Unknown error"}
        </CardContent>
      </Card>
    );
  }

  const org = q.data as any;
  const members = Array.isArray(org.members) ? (org.members as any[]) : [];
  const connections = Array.isArray(org.connections) ? (org.connections as any[]) : [];

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight">
                {String(org.name ?? org.id)}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {String(org.id)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="capitalize" variant="secondary">
                {String(org.status ?? "unknown")}
              </Badge>
              <Button asChild size="sm" variant="secondary">
                <Link to="/dashboard/orgs">Back</Link>
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Members
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {members.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Connections
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {connections.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Default Visibility
              </div>
              <div className="text-sm font-medium capitalize">
                {String(org.default_connection_visibility ?? "org_shared")}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">Members</CardTitle>
          </CardHeader>
          <CardContent>
            {members.length ? (
              <div className="rounded-md border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={String(m.user_id)}>
                        <TableCell className="font-medium">
                          <Link
                            className="hover:underline"
                            to="/dashboard/users/$userId"
                            params={{ userId: String(m.user_id) }}
                          >
                            {String(m.email)}
                          </Link>
                        </TableCell>
                        <TableCell className="capitalize">
                          {String(m.role)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No members found.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm">Connections</CardTitle>
          </CardHeader>
          <CardContent>
            {connections.length ? (
              <div className="rounded-md border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {connections.slice(0, 30).map((c) => (
                      <TableRow key={String(c.id)}>
                        <TableCell className="font-medium">
                          {String(c.name)}
                        </TableCell>
                        <TableCell className="capitalize">
                          {String(c.connector_type)}
                        </TableCell>
                        <TableCell className="capitalize">
                          {String(c.status)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No connections found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

