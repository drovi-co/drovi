import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Separator } from "@memorystack/ui-core/separator";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@memorystack/ui-core/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { adminAPI } from "@/lib/api";

export const Route = createFileRoute("/dashboard/orgs/$orgId")({
  component: AdminOrgDetailPage,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

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
        <CardContent className="text-muted-foreground text-sm">
          {q.error instanceof Error ? q.error.message : "Unknown error"}
        </CardContent>
      </Card>
    );
  }

  const org = q.data;
  const members = Array.isArray(org.members)
    ? org.members.filter(isRecord)
    : [];
  const connections = Array.isArray(org.connections)
    ? org.connections.filter(isRecord)
    : [];

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold text-lg tracking-tight">
                {String(org.name ?? org.id)}
              </div>
              <div className="font-mono text-muted-foreground text-xs">
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
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Members
              </div>
              <div className="font-semibold text-2xl tabular-nums">
                {members.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Connections
              </div>
              <div className="font-semibold text-2xl tabular-nums">
                {connections.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Default Visibility
              </div>
              <div className="font-medium text-sm capitalize">
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
                            params={{ userId: String(m.user_id) }}
                            to="/dashboard/users/$userId"
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
              <div className="text-muted-foreground text-sm">
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
              <div className="text-muted-foreground text-sm">
                No connections found.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
