import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { adminAPI } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/dashboard/users/$userId")({
  component: AdminUserDetailPage,
});

function AdminUserDetailPage() {
  const { userId } = Route.useParams();

  const q = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => adminAPI.getUser(userId),
  });

  if (q.isPending) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (q.error) {
    return (
      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-sm">Failed to load user</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Unknown error"}
        </CardContent>
      </Card>
    );
  }

  const user = q.data as any;
  const memberships = Array.isArray(user.memberships) ? (user.memberships as any[]) : [];

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight">
                {String(user.email ?? user.id)}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {String(user.id)}
              </div>
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link to="/dashboard/users">Back</Link>
            </Button>
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Organizations
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {memberships.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Last Login
              </div>
              <div className="text-sm font-medium">
                {user.last_login_at ? String(user.last_login_at) : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-muted-foreground text-[11px] uppercase tracking-wider">
                Created
              </div>
              <div className="text-sm font-medium">
                {user.created_at ? String(user.created_at) : "—"}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-sm">Memberships</CardTitle>
        </CardHeader>
        <CardContent>
          {memberships.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.map((m) => (
                    <TableRow key={String(m.org_id)}>
                      <TableCell className="font-medium">
                        <Link
                          className="hover:underline"
                          to="/dashboard/orgs/$orgId"
                          params={{ orgId: String(m.org_id) }}
                        >
                          {String(m.org_name)}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {String(m.org_id)}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{String(m.role)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No memberships found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

