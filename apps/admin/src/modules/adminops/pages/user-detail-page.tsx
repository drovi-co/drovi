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
import { Link, useParams } from "@tanstack/react-router";
import { adminAPI } from "@/lib/api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function AdminUserDetailPage() {
  const { userId } = useParams({ from: "/dashboard/users/$userId" });

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
        <CardContent className="text-muted-foreground text-sm">
          {q.error instanceof Error ? q.error.message : "Unknown error"}
        </CardContent>
      </Card>
    );
  }

  const user = q.data;
  const memberships = Array.isArray(user.memberships)
    ? user.memberships.filter(isRecord)
    : [];

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-semibold text-lg tracking-tight">
                {String(user.email ?? user.id)}
              </div>
              <div className="font-mono text-muted-foreground text-xs">
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
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Organizations
              </div>
              <div className="font-semibold text-2xl tabular-nums">
                {memberships.length}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Last Login
              </div>
              <div className="font-medium text-sm">
                {user.last_login_at ? String(user.last_login_at) : "—"}
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Created
              </div>
              <div className="font-medium text-sm">
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
                          params={{ orgId: String(m.org_id) }}
                          to="/dashboard/orgs/$orgId"
                        >
                          {String(m.org_name)}
                        </Link>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {String(m.org_id)}
                        </div>
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
              No memberships found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
