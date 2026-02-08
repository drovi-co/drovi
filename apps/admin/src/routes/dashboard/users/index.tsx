import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { adminAPI } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/dashboard/users/")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => adminAPI.listUsers({ q: q.trim() || undefined, limit: 200 }),
  });

  const rows = useMemo(() => {
    const users = (query.data?.users ?? []) as Array<any>;
    return users;
  }, [query.data]);

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-sm">Users</CardTitle>
            <div className="text-muted-foreground text-xs">
              Global user listing (internal).
            </div>
          </div>
          <div className="w-[320px] max-w-full">
            <Input
              placeholder="Search by email or id..."
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
            />
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
          ) : rows.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden lg:table-cell">ID</TableHead>
                    <TableHead className="text-right">Orgs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((u) => (
                    <TableRow
                      className={cn("cursor-pointer")}
                      key={String(u.id)}
                      onClick={() =>
                        navigate({
                          to: "/dashboard/users/$userId",
                          params: { userId: String(u.id) },
                        })
                      }
                    >
                      <TableCell className="font-medium">
                        {String(u.email)}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {String(u.id)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(u.org_count ?? 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No users found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

