import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
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
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { adminAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AdminUsersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["admin-users", q],
    queryFn: () => adminAPI.listUsers({ q: q.trim() || undefined, limit: 200 }),
  });

  const rows = useMemo(() => {
    return query.data?.users ?? [];
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
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="Search by email or id..."
              value={q}
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
            <div className="text-muted-foreground text-sm">
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
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
                      <TableCell className="hidden font-mono text-muted-foreground text-xs lg:table-cell">
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
            <div className="text-muted-foreground text-sm">No users found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
